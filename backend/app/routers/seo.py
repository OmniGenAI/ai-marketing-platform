import json
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.dependencies import get_current_user
from app.models.seo_save import SeoSave
from app.models.user import User
from app.services.scraper import scrape_article_content, scrape_articles_batch


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
from app.services.seo_tools import (
    analyse_content_structure,
    analyse_keyword_density,
    analyse_keyword_placement,
    analyse_lsi_coverage,
    analyse_links,
    build_seo_outline,
    build_serp_preview,
    calculate_seo_score,
    count_passive_voice,
    extract_keywords_from_text,
    generate_meta_suggestions,
    generate_schema_markup,
    score_content_length,
    score_readability,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/seo", tags=["seo"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class BusinessContext(BaseModel):
    business_name: str = ""
    niche: str = ""
    location: str = ""
    target_audience: str = ""
    products: str = ""
    brand_voice: str = ""


class SEOBriefRequest(BaseModel):
    topic: str
    target_url: str = ""
    target_word_count: int = 1500
    country: str = ""          # e.g. "in" for India, "us" for US (ISO 3166-1 alpha-2)
    device: str = ""           # "desktop" | "mobile" — optional Serper param
    competitor_urls: list[str] = []
    content_draft: str = ""    # optional existing draft to score against the brief
    business_context: BusinessContext | None = None  # auto-injected from brand kit
    save_id: str | None = None  # when present, UPDATE that save instead of inserting


class MetaSuggestion(BaseModel):
    title: str
    title_length: int
    title_ok: bool
    description: str
    description_length: int
    description_ok: bool


class H2Section(BaseModel):
    heading: str
    notes: str


class KeywordVolume(BaseModel):
    keyword: str
    estimated_volume: str   # e.g. "1K–10K / mo"
    difficulty: str          # e.g. "Medium"


class CompetitorInsight(BaseModel):
    url: str
    title: str
    word_count: int
    readability_score: float
    top_keywords: list[str]
    content_summary: str = ""       # first ~1500 chars of scraped page text
    headings: list[str] = []        # H1/H2/H3 from the page


class DraftScore(BaseModel):
    overall: int
    readability: dict
    keyword_density: dict
    structure: dict


class SerpResult(BaseModel):
    title: str
    link: str
    snippet: str


class SEOBriefResponse(BaseModel):
    topic: str
    search_intent: str = ""               # informational / commercial / transactional / navigational
    primary_keyword: str
    secondary_keywords: list[str]
    nlp_terms: list[str] = []             # semantic / NLP terms for topic coverage
    keyword_data: list[KeywordVolume]
    serp_results: list[SerpResult] = []   # raw SERP titles/snippets from Serper
    competitor_insights: list[CompetitorInsight]
    content_gaps: list[str] = []          # what competitors missed
    h2_outline: list[H2Section]
    meta_suggestions: list[MetaSuggestion]
    schema_markup: dict
    serp_preview: dict
    recommendations: list[str]
    draft_score: DraftScore | None = None  # present only when content_draft was supplied
    save_id: str | None = None  # id of the row this brief was persisted to (for UPSERT)


class SEOScoreRequest(BaseModel):
    content: str
    primary_keyword: str = ""
    target_word_count: int = 1500
    # Meta tab fields
    meta_title: str = ""
    meta_description: str = ""
    related_keywords: list[str] = []


class MetaDetail(BaseModel):
    keyword_in_title: bool
    keyword_in_description: bool
    title_length: int
    title_ok: bool
    description_length: int
    description_ok: bool
    score: int


class SEOScoreResponse(BaseModel):
    overall: int
    # Component scores (each 0-100)
    keyword_score: int
    coverage_score: int
    readability_score: int
    structure_score: int
    links_score: int
    meta_score: int
    length_score: int
    meta_detail: MetaDetail
    # Detailed data
    readability: dict
    keyword_density: dict
    keyword_placement: dict
    lsi: dict
    passive_voice: dict
    links: dict
    content_length: dict
    structure: dict


# ---------------------------------------------------------------------------
# LLM helpers — Gemini (primary) → Groq (fallback)
# ---------------------------------------------------------------------------

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL = "llama-3.3-70b-versatile"  # 300K TPM, 1K RPM, supports JSON mode
_GROQ_MAX_CHARS = 25_000  # safe per-request limit


def _gemini_call_raw(prompt: str, max_retries: int = 3) -> str | None:
    """Raw Gemini call with exponential backoff on 429/5xx transient errors."""
    if not settings.GOOGLE_GEMINI_API_KEY:
        logger.warning("[LLM] Gemini API key not set — skipping")
        return None
    logger.info("[LLM] 🔵 Calling Gemini (prompt %d chars)...", len(prompt))
    t0 = time.time()
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                _GEMINI_URL.format(key=settings.GOOGLE_GEMINI_API_KEY),
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=25.0,
            )
            if resp.status_code in (429, 500, 502, 503, 504):
                wait = 2 ** (attempt + 1)
                logger.warning(
                    "[LLM] Gemini %d, retrying in %ds (attempt %d/%d)",
                    resp.status_code, wait, attempt + 1, max_retries,
                )
                time.sleep(wait)
                continue
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            logger.info("[LLM] ✅ Gemini responded in %.1fs (%d chars)", time.time() - t0, len(text))
            return text
        except httpx.HTTPStatusError as exc:
            logger.warning("[LLM] ❌ Gemini HTTP error %s: %s", exc.response.status_code, exc)
            return None
        except Exception as exc:
            logger.warning("[LLM] ❌ Gemini call failed: %s", exc)
            return None
    logger.warning("[LLM] ❌ Gemini exhausted retries after %d attempts (%.1fs)", max_retries, time.time() - t0)
    return None


_GROQ_MAX_OUTPUT_TOKENS = 8192  # enough for full-document HTML rewrites


def _groq_call(prompt: str, max_retries: int = 2, json_mode: bool = True) -> str | None:
    """Groq fallback call — used when Gemini is down.

    `json_mode=True` enables OpenAI-compatible JSON mode, which guarantees
    a valid JSON response shape (the API server enforces it) and prevents
    the model from emitting markdown fences. All our prompts request JSON,
    so the default is True.
    """
    if not settings.GROQ_API_KEY:
        logger.warning("[LLM] Groq API key not set — skipping fallback")
        return None
    logger.info("[LLM] 🟡 Calling Groq/%s (prompt %d chars)...", _GROQ_MODEL, len(prompt))
    t0 = time.time()
    payload: dict = {
        "model": _GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are an expert SEO strategist. Always respond with valid JSON only, no markdown fences."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        # Without this, Groq defaults to ~1024 tokens and truncates mid-JSON
        # on any endpoint that asks for full HTML (apply-tips, blog generate).
        # "max_tokens": _GROQ_MAX_OUTPUT_TOKENS,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                _GROQ_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=45.0,
            )
            if resp.status_code in (429, 500, 502, 503, 504):
                wait = 2 ** (attempt + 1)
                logger.warning(
                    "[LLM] Groq %d, retrying in %ds (attempt %d/%d)",
                    resp.status_code, wait, attempt + 1, max_retries,
                )
                time.sleep(wait)
                continue
            resp.raise_for_status()
            body = resp.json()
            choice = (body.get("choices") or [{}])[0]
            text = (choice.get("message") or {}).get("content") or ""
            finish_reason = choice.get("finish_reason")
            logger.info(
                "[LLM] ✅ Groq responded in %.1fs (%d chars, finish=%s)",
                time.time() - t0, len(text), finish_reason,
            )
            # Empty content with finish=stop means the model refused — retry
            # once more before giving up. Empty with finish=length means the
            # output hit max_tokens at the *start* (nothing emitted yet) —
            # also worth a retry.
            if not text.strip() and attempt + 1 < max_retries:
                logger.warning("[LLM] Groq returned empty content (finish=%s) — retrying", finish_reason)
                time.sleep(2 ** (attempt + 1))
                continue
            return text or None
        except httpx.HTTPStatusError as exc:
            logger.warning("[LLM] ❌ Groq HTTP error %s: %s", exc.response.status_code, exc)
            return None
        except Exception as exc:
            logger.warning("[LLM] ❌ Groq call failed: %s", exc)
            return None
    logger.warning("[LLM] ❌ Groq exhausted retries after %d attempts (%.1fs)", max_retries, time.time() - t0)
    return None


def _gemini_call(prompt: str, max_retries: int = 3) -> str | None:
    """Try Gemini first, fall back to Groq if Gemini fails."""
    result = _gemini_call_raw(prompt, max_retries=max_retries)
    if result:
        return result
    logger.info("[LLM] ⚠️  Gemini unavailable — falling back to Groq")
    if len(prompt) > _GROQ_MAX_CHARS:
        prompt = prompt[:_GROQ_MAX_CHARS] + "\n\n[...content truncated for fallback model...]"
        logger.warning("[LLM] Prompt truncated to %d chars for Groq fallback", _GROQ_MAX_CHARS)
    return _groq_call(prompt)


# ---------------------------------------------------------------------------
# POST /api/seo/keywords — lightweight keyword + hashtag extraction
# Used by Reel/Social to enrich captions without the full brief pipeline.
# ---------------------------------------------------------------------------


class SEOKeywordsRequest(BaseModel):
    topic: str


class SEOKeywordsResponse(BaseModel):
    primary_keyword: str
    secondary_keywords: list[str]
    hashtags: list[str]   # CamelCase, no leading '#'


def _slug_to_hashtag(term: str) -> str:
    """Convert 'content marketing tips' -> 'ContentMarketingTips' for hashtag use."""
    parts = re.findall(r"[A-Za-z0-9]+", term)
    return "".join(p.capitalize() for p in parts) if parts else ""


def extract_seo_keywords(topic: str, use_serp_grounding: bool = True) -> dict:
    """Extract primary keyword + 5 secondary keywords + 5 hashtags from a topic.

    Used by `/api/seo/keywords` and by the Reel router (before script generation).
    Always returns a populated dict thanks to rule-based fallbacks.

    When `use_serp_grounding` is True and SERPER_API_KEY is configured, we fetch
    the top-10 Google SERP titles/snippets for the topic and feed them to the
    LLM so keyword extraction is grounded in what actually ranks — instead of
    the LLM hallucinating plausible but unranked phrases. Adds ~1s and costs
    one Serper call. Falls through silently when Serper is unavailable.
    """
    topic = topic.strip()
    if not topic:
        return {"primary_keyword": "", "secondary_keywords": [], "hashtags": []}

    serp_context = ""
    if use_serp_grounding:
        try:
            serp = _serper_organic(topic, num=10)
            if serp:
                lines = [
                    f"- {s['title']}" + (f" — {s['snippet'][:120]}" if s.get("snippet") else "")
                    for s in serp[:10]
                ]
                serp_context = (
                    "\nHere are the top Google search results currently ranking for this topic.\n"
                    "Use them to ground your keyword choices in what real users click on:\n"
                    + "\n".join(lines)
                    + "\n"
                )
        except Exception as exc:
            logger.warning("[KEYWORDS] SERP grounding skipped: %s", exc)

    prompt = (
        "You extract SEO keywords from a content topic. "
        "Return JSON with EXACTLY this shape and nothing else:\n"
        '{"primary_keyword": string, "secondary_keywords": [5 short strings]}\n\n'
        "Rules:\n"
        "- primary_keyword is the single best search phrase for the topic (2-5 words).\n"
        "- secondary_keywords are 5 related long-tail search phrases (2-5 words each).\n"
        "- Lowercase, no punctuation except spaces.\n"
        "- Prefer phrases that echo the SERP titles below — those are proven to rank.\n"
        f"{serp_context}\n"
        f"Topic: {topic}"
    )

    raw = _gemini_call(prompt, max_retries=2)
    primary, secondary = "", []
    if raw:
        try:
            m = re.search(r"\{.*\}", raw, re.S)
            parsed = json.loads(m.group(0)) if m else {}
            primary = str(parsed.get("primary_keyword", "")).strip()
            sec = parsed.get("secondary_keywords", []) or []
            secondary = [str(s).strip() for s in sec if str(s).strip()][:5]
        except Exception as exc:
            logger.warning("[KEYWORDS] Parse failed: %s", exc)

    if not primary:
        primary = topic.lower()
    if not secondary:
        words = [w for w in re.findall(r"[A-Za-z0-9]+", topic.lower()) if len(w) > 2]
        base = " ".join(words[:3]) if words else topic.lower()
        secondary = [
            f"{base} tips",
            f"{base} guide",
            f"best {base}",
            f"{base} examples",
            f"{base} 2026",
        ]

    tag_pool = [primary] + secondary
    hashtags: list[str] = []
    seen = set()
    for t in tag_pool:
        tag = _slug_to_hashtag(t)
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            hashtags.append(tag)
        if len(hashtags) >= 5:
            break

    return {
        "primary_keyword": primary,
        "secondary_keywords": secondary,
        "hashtags": hashtags,
    }


@router.post("/keywords", response_model=SEOKeywordsResponse)
def generate_keywords(data: SEOKeywordsRequest):
    if not data.topic.strip():
        raise HTTPException(status_code=400, detail="Topic is required")
    result = extract_seo_keywords(data.topic)
    return SEOKeywordsResponse(**result)


# ---------------------------------------------------------------------------
# Serper.dev — Google Search API
# ---------------------------------------------------------------------------

_SERPER_URL = "https://google.serper.dev/search"


def _serper_organic(query: str, num: int = 10, country: str = "", device: str = "") -> list[dict]:
    """
    Query Serper.dev and return full organic results.
    Each item: {title, link, snippet}.
    """
    if not settings.SERPER_API_KEY:
        logger.warning("SERPER_API_KEY not set — SERP discovery disabled")
        return []
    body: dict = {"q": query, "num": num}
    if country:
        body["gl"] = country          # e.g. "in", "us"
    if device:
        body["device"] = device       # "desktop" | "mobile"
    try:
        resp = httpx.post(
            _SERPER_URL,
            headers={
                "X-API-KEY": settings.SERPER_API_KEY,
                "Content-Type": "application/json",
            },
            json=body,
            timeout=12.0,
        )
        resp.raise_for_status()
        data = resp.json()
        organic = data.get("organic", [])
        results = []
        for r in organic:
            if r.get("link"):
                results.append({
                    "title": r.get("title", ""),
                    "link": r["link"],
                    "snippet": r.get("snippet", ""),
                })
        logger.info("Serper returned %d organic results for '%s'", len(results), query)
        return results
    except Exception as exc:
        logger.warning("Serper search failed for '%s': %s", query, exc)
        return []


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    return raw.strip()


# ---------------------------------------------------------------------------
# Page scraping — Playwright + BeautifulSoup (extract headings + clean text)
# ---------------------------------------------------------------------------

def _scrape_pages(urls: list[str], limit: int = 5) -> list[dict]:
    """
    Scrape up to `limit` URLs using ONE shared Playwright browser.
    Enriches each result with readability score + top keywords.
    """
    target_urls = urls[:limit]
    raw_pages = scrape_articles_batch(target_urls, page_timeout=12_000)

    pages = []
    for scraped in raw_pages:
        content_text = scraped.get("main_content", "")
        if not content_text.strip():
            continue
        readability = score_readability(content_text)
        if readability.get("word_count", 0) < 50:
            continue
        top_kws = [k["keyword"] for k in extract_keywords_from_text(content_text, top_n=8)]
        pages.append({
            "url": scraped["url"],
            "title": scraped.get("title") or scraped["url"],
            "headings": scraped.get("headings", []),
            "content_summary": content_text[:1500],
            "word_count": readability.get("word_count", 0),
            "readability_score": readability.get("flesch_score", 0.0),
            "top_keywords": top_kws,
        })

    logger.info("Scraped %d / %d pages successfully", len(pages), len(target_urls))
    return pages


# ---------------------------------------------------------------------------
# Aggregation — cluster headings + compute stats from scraped pages
# ---------------------------------------------------------------------------

def _aggregate_scraped_data(scraped_pages: list[dict]) -> dict:
    """
    Combine scraped competitor pages into a single data bundle
    ready to send to Gemini (clean text, not raw HTML).
    """
    all_headings: list[str] = []
    all_keywords: list[str] = []
    word_counts: list[int] = []
    summaries: list[str] = []

    for page in scraped_pages:
        for h in page.get("headings", []):
            text = h.get("text", "") if isinstance(h, dict) else str(h)
            if text:
                all_headings.append(text)
        all_keywords.extend(page.get("top_keywords", []))
        word_counts.append(page.get("word_count", 0))
        summaries.append(
            f"Title: {page['title']}\n"
            f"URL: {page['url']}\n"
            f"Word count: {page['word_count']}\n"
            f"Top keywords: {', '.join(page.get('top_keywords', [])[:5])}\n"
            f"Summary: {page.get('content_summary', '')[:600]}"
        )

    # Deduplicate headings (case-insensitive)
    seen = set()
    unique_headings = []
    for h in all_headings:
        key = h.lower().strip()
        if key not in seen:
            seen.add(key)
            unique_headings.append(h)

    # Keyword frequency
    kw_freq: dict[str, int] = {}
    for kw in all_keywords:
        kw_freq[kw.lower()] = kw_freq.get(kw.lower(), 0) + 1
    common_keywords = sorted(kw_freq, key=kw_freq.get, reverse=True)[:15]  # type: ignore[arg-type]

    avg_word_count = int(sum(word_counts) / len(word_counts)) if word_counts else 0

    return {
        "headings": unique_headings[:40],       # cap for token budget
        "common_keywords": common_keywords,
        "avg_word_count": avg_word_count,
        "page_count": len(scraped_pages),
        "summaries": summaries[:8],              # top 8 pages max
    }


# ---------------------------------------------------------------------------
# Gemini — single comprehensive analysis from aggregated SERP data
# ---------------------------------------------------------------------------

def _gemini_analyse_serp(
    topic: str,
    serp_snippets: list[dict],
    aggregated: dict,
    target_word_count: int,
    business_context: dict | None = None,
) -> dict:
    """
    Send clean, aggregated SERP data (NOT raw HTML) to Gemini.
    Returns a dict with: search_intent, primary_keyword, secondary_keywords,
    nlp_terms, h2_outline, content_gaps, meta_suggestions, recommendations.
    """
    # Build the competitor summary block
    competitor_block = "\n---\n".join(aggregated.get("summaries", []))
    headings_block = "\n".join(f"- {h}" for h in aggregated.get("headings", []))
    serp_block = "\n".join(
        f"{i+1}. {s['title']}  ({s['link']})\n   {s['snippet']}"
        for i, s in enumerate(serp_snippets[:10])
    )

    # Build business context block if provided
    biz_block = ""
    if business_context:
        parts = []
        if business_context.get("business_name"):
            parts.append(f"Business: {business_context['business_name']}")
        if business_context.get("niche"):
            parts.append(f"Industry/Niche: {business_context['niche']}")
        if business_context.get("location"):
            parts.append(f"Location: {business_context['location']}")
        if business_context.get("target_audience"):
            parts.append(f"Target Audience: {business_context['target_audience']}")
        if business_context.get("products"):
            parts.append(f"Products/Services: {business_context['products']}")
        if business_context.get("brand_voice"):
            parts.append(f"Brand Voice: {business_context['brand_voice']}")
        if parts:
            biz_block = (
                "=== BUSINESS CONTEXT (tailor ALL output specifically for this business) ===\n"
                + "\n".join(parts)
                + "\n\n"
            )

    prompt = f"""You are a world-class SEO strategist. Analyse the following real Google SERP data and competitor content for the topic: "{topic}"

{biz_block}""".rstrip() + f"""

=== SERP RESULTS (from Google) ===
{serp_block}

=== COMPETITOR HEADINGS (extracted from top pages) ===
{headings_block}

=== COMMON KEYWORDS across competitors ===
{', '.join(aggregated.get('common_keywords', []))}

=== COMPETITOR PAGE SUMMARIES ===
{competitor_block}

=== STATS ===
- Pages analysed: {aggregated.get('page_count', 0)}
- Average competitor word count: {aggregated.get('avg_word_count', 0)}
- Target word count: {target_word_count}

Based on this REAL data, return ONLY a JSON object (no markdown fences, no explanation):
{{
  "search_intent": "informational | commercial | transactional | navigational",
  "primary_keyword": "best 2-4 word keyword phrase for this topic",
  "secondary_keywords": ["5-8 related keyword phrases each 2-4 words"],
  "nlp_terms": ["8-12 semantic/NLP terms that help search engines understand the topic"],
  "h2_outline": [
    {{"heading": "H2 heading text", "notes": "brief writer's note for this section"}}
  ],
  "content_gaps": ["3-5 topics that competitors missed or covered poorly"],
  "meta_suggestions": [
    {{
      "title": "SEO title tag ≤60 chars",
      "description": "Meta description ≤155 chars"
    }}
  ],
  "recommendations": ["5-7 specific actionable SEO tips based on the data"]
}}

Rules:
- Derive everything from the REAL SERP data above, not from general knowledge
- Include the primary keyword naturally in at least 2 outline headings
- Scale outline sections to hit ~{target_word_count // 300} sections minimum
- Meta suggestions: provide 3 variants
- Do NOT copy competitor headings verbatim — improve them
- Content gaps should be genuinely missing from competitors
"""
    logger.info("[ANALYSE] 🧠 Sending aggregated data to LLM for analysis...")
    t0 = time.time()
    raw = _gemini_call(prompt, max_retries=3)
    if raw:
        try:
            parsed = json.loads(_strip_fences(raw))
            if isinstance(parsed, dict):
                logger.info(
                    "[ANALYSE] ✅ LLM analysis complete in %.1fs — intent=%s, %d keywords, %d outline sections, %d gaps",
                    time.time() - t0,
                    parsed.get('search_intent', '?'),
                    len(parsed.get('secondary_keywords', [])),
                    len(parsed.get('h2_outline', [])),
                    len(parsed.get('content_gaps', [])),
                )
                return parsed
        except Exception as exc:
            logger.warning("[ANALYSE] ❌ LLM JSON parse failed: %s", exc)

    logger.warning("[ANALYSE] ⚠️  LLM analysis failed — using fallback structure")
    # Fallback — return minimal structure
    words = topic.lower().split()
    primary = " ".join(words[:3]) if len(words) >= 3 else topic.lower()
    return {
        "search_intent": "informational",
        "primary_keyword": primary,
        "secondary_keywords": [
            f"{primary} tips", f"{primary} guide", f"how to {primary}",
            f"best {primary} strategies", f"{primary} for beginners",
        ],
        "nlp_terms": [],
        "h2_outline": build_seo_outline(topic, [primary], target_word_count),
        "content_gaps": [],
        "meta_suggestions": [],
        "recommendations": [
            f"Target '{primary}' in your H1 and first 100 words.",
            "Aim for 1,500+ words to outperform top-ranking articles.",
            "Add FAQ schema to capture featured snippets.",
        ],
    }


# ---------------------------------------------------------------------------
# Keyword volume mock (no paid API)
# ---------------------------------------------------------------------------

_VOLUME_TIERS = [
    (["how to", "best ", "top ", "guide"], "10K–100K / mo", "Hard"),
    (["tips", "strategies", "ideas", "examples"], "1K–10K / mo", "Medium"),
    (["for beginners", "tutorial", "step by step"], "500–5K / mo", "Easy"),
]


def _keyword_volumes_mock(keywords: list[str]) -> list[dict]:
    """Return estimated keyword volume/difficulty without a paid API."""
    result = []
    for kw in keywords:
        volume, difficulty = "1K–10K / mo", "Medium"
        for patterns, v, d in _VOLUME_TIERS:
            if any(p in kw.lower() for p in patterns):
                volume, difficulty = v, d
                break
        result.append({"keyword": kw, "estimated_volume": volume, "difficulty": difficulty})
    return result


# ---------------------------------------------------------------------------
# POST /api/seo/brief  — Serper → Playwright+BS4 → Aggregate → Gemini
# ---------------------------------------------------------------------------

@router.post("/brief", response_model=SEOBriefResponse)
def generate_seo_brief(
    data: SEOBriefRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not data.topic.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Topic is required.")

    brief_start = time.time()
    logger.info("="*60)
    logger.info("[BRIEF] 🚀 Starting SEO brief for: '%s'", data.topic)
    logger.info("[BRIEF]    country=%s  word_count=%d  competitor_urls=%d  has_draft=%s",
                data.country or 'global', data.target_word_count,
                len(data.competitor_urls), bool(data.content_draft.strip()))
    logger.info("="*60)

    # ── Step 1: SERP fetch (Serper.dev) ──────────────────────────────────
    logger.info("[STEP 1/11] 🔍 Fetching SERP from Serper.dev...")
    t0 = time.time()
    serp_results_raw = _serper_organic(
        query=data.topic,
        num=10,
        country=data.country,
        device=data.device,
    )
    serp_results = [SerpResult(**s) for s in serp_results_raw]
    logger.info("[STEP 1/11] ✅ Serper returned %d results in %.1fs", len(serp_results), time.time() - t0)
    for i, s in enumerate(serp_results_raw[:5]):
        logger.info("[STEP 1/11]    %d. %s", i + 1, s.get('link', '?'))

    # URLs to scrape: user-provided first, else from Serper SERP
    urls_to_scrape = data.competitor_urls or [s["link"] for s in serp_results_raw]

    # ── Step 2+3: Scrape pages (Playwright) + Clean (BS4) ───────────────
    logger.info("[STEP 2/11] 🌐 Scraping %d URLs with Playwright + BS4...", min(len(urls_to_scrape), 5))
    t0 = time.time()
    scraped_pages = _scrape_pages(urls_to_scrape, limit=5)
    logger.info("[STEP 2/11] ✅ Scraped %d pages in %.1fs", len(scraped_pages), time.time() - t0)
    for p in scraped_pages:
        logger.info("[STEP 2/11]    ✓ %s — %d words, %d headings", p['url'][:80], p['word_count'], len(p.get('headings', [])))

    # Build competitor insights from scraped data
    competitor_insights = [
        CompetitorInsight(
            url=p["url"],
            title=p["title"],
            word_count=p["word_count"],
            readability_score=p["readability_score"],
            top_keywords=p["top_keywords"][:5],
            content_summary=p.get("content_summary", "")[:1500],
            headings=[h.get("text", h) if isinstance(h, dict) else h for h in p.get("headings", [])[:10]],
        )
        for p in scraped_pages
    ]

    # ── Step 4: Aggregate cleaned data ──────────────────────────────────
    logger.info("[STEP 3/11] 📊 Aggregating scraped data...")
    aggregated = _aggregate_scraped_data(scraped_pages)
    logger.info("[STEP 3/11] ✅ Aggregated: %d unique headings, %d common keywords, avg %d words",
                len(aggregated.get('headings', [])),
                len(aggregated.get('common_keywords', [])),
                aggregated.get('avg_word_count', 0))

    # ── Step 5: Gemini analysis (single call with real SERP data) ───────
    logger.info("[STEP 4/11] 🧠 Sending to LLM for comprehensive analysis...")
    t0 = time.time()
    analysis = _gemini_analyse_serp(
        topic=data.topic,
        serp_snippets=serp_results_raw,
        aggregated=aggregated,
        target_word_count=data.target_word_count,
        business_context=data.business_context.model_dump() if data.business_context else None,
    )

    logger.info("[STEP 4/11] ✅ LLM analysis done in %.1fs", time.time() - t0)

    primary_keyword: str = analysis.get("primary_keyword", data.topic)
    secondary_keywords: list[str] = analysis.get("secondary_keywords", [])
    nlp_terms: list[str] = analysis.get("nlp_terms", [])
    content_gaps: list[str] = analysis.get("content_gaps", [])
    search_intent: str = analysis.get("search_intent", "")
    recommendations: list[str] = analysis.get("recommendations", [])
    all_keywords = [primary_keyword] + secondary_keywords
    logger.info("[STEP 4/11]    intent=%s  primary='%s'  secondary=%d  gaps=%d  nlp=%d",
                search_intent, primary_keyword, len(secondary_keywords),
                len(content_gaps), len(nlp_terms))

    # H2 outline from Gemini analysis
    outline_raw = analysis.get("h2_outline", [])
    if not outline_raw:
        logger.info("[STEP 5/11] ⚠️  No outline from LLM — using template fallback")
        outline_raw = build_seo_outline(data.topic, all_keywords, data.target_word_count)
    h2_outline = [H2Section(**s) for s in outline_raw]
    logger.info("[STEP 5/11] ✅ Outline: %d H2 sections", len(h2_outline))

    # ── Step 6: Keyword volumes (mock) ──────────────────────────────────
    keyword_data = [KeywordVolume(**k) for k in _keyword_volumes_mock(all_keywords)]
    logger.info("[STEP 6/11] ✅ Keyword volumes estimated for %d keywords", len(keyword_data))

    # ── Step 7: Meta tags ───────────────────────────────────────────────
    # Prefer Gemini-generated meta, fall back to local generator
    gemini_meta = analysis.get("meta_suggestions", [])
    if gemini_meta:
        meta_suggestions = []
        for m in gemini_meta:
            t = m.get("title", "")
            d = m.get("description", "")
            meta_suggestions.append(MetaSuggestion(
                title=t,
                title_length=len(t),
                title_ok=len(t) <= 60,
                description=d,
                description_length=len(d),
                description_ok=len(d) <= 155,
            ))
    else:
        meta_raw = generate_meta_suggestions(data.topic, all_keywords)
        meta_suggestions = [MetaSuggestion(**m) for m in meta_raw]

    logger.info("[STEP 7/11] ✅ Meta tags: %d variants (source=%s)",
                len(meta_suggestions), 'LLM' if gemini_meta else 'local')

    # ── Step 8: Schema markup ───────────────────────────────────────────
    first_title = meta_suggestions[0].title if meta_suggestions else data.topic
    first_desc = meta_suggestions[0].description if meta_suggestions else ""
    schema = generate_schema_markup(
        title=first_title,
        description=first_desc,
        url=data.target_url,
    )

    logger.info("[STEP 8/11] ✅ Schema markup generated")

    # ── Step 9: SERP preview ────────────────────────────────────────────
    serp_preview = build_serp_preview(
        title=first_title,
        description=first_desc,
        url=data.target_url or "https://yourwebsite.com",
    )

    logger.info("[STEP 9/11] ✅ SERP preview built")

    # ── Step 10: Enrich recommendations with competitor stats ───────────
    if competitor_insights:
        avg_wc = int(sum(c.word_count for c in competitor_insights) / len(competitor_insights))
        recommendations.append(
            f"Competitors average {avg_wc} words — aim for at least {avg_wc + 200} words to outrank them."
        )

    logger.info("[STEP 10/11] ✅ Recommendations: %d tips", len(recommendations))

    # ── Step 11: Score existing draft (if provided) ─────────────────────
    draft_score: DraftScore | None = None
    if data.content_draft.strip():
        logger.info("[STEP 11/11] 📝 Scoring user draft (%d chars)...", len(data.content_draft))
        rd = score_readability(data.content_draft)
        kd = analyse_keyword_density(data.content_draft, primary_keyword)
        st = analyse_content_structure(data.content_draft)
        draft_score = DraftScore(
            overall=calculate_seo_score(rd, kd, st),
            readability=rd,
            keyword_density=kd,
            structure=st,
        )

    if draft_score:
        logger.info("[STEP 11/11] ✅ Draft score: %d/100", draft_score.overall)
    else:
        logger.info("[STEP 11/11] ⏭️  No draft provided — skipped")

    total = time.time() - brief_start
    logger.info("="*60)
    logger.info("[BRIEF] 🏁 SEO brief complete in %.1fs", total)
    logger.info("[BRIEF]    %d SERP results | %d competitors | %d sections | %d keywords | %d gaps",
                len(serp_results), len(competitor_insights),
                len(h2_outline), len(all_keywords), len(content_gaps))
    logger.info("="*60)

    # ── Auto-save to database ────────────────────────────────────────────
    result = SEOBriefResponse(
        topic=data.topic,
        search_intent=search_intent,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        nlp_terms=nlp_terms,
        keyword_data=keyword_data,
        serp_results=serp_results,
        competitor_insights=competitor_insights,
        content_gaps=content_gaps,
        h2_outline=h2_outline,
        meta_suggestions=meta_suggestions,
        schema_markup=schema,
        serp_preview=serp_preview,
        recommendations=recommendations,
        draft_score=draft_score,
    )
    try:
        existing = None
        if data.save_id:
            existing = (
                db.query(SeoSave)
                .filter(SeoSave.id == data.save_id,
                        SeoSave.user_id == current_user.id,
                        SeoSave.type == "brief")
                .first()
            )
        if existing:
            existing.title = data.topic.strip() or "Untitled"
            existing.data = json.dumps(result.model_dump())
            db.commit()
            db.refresh(existing)
            result.save_id = existing.id
        else:
            save = SeoSave(
                user_id=current_user.id,
                type="brief",
                title=data.topic.strip() or "Untitled",
                data=json.dumps(result.model_dump()),
            )
            db.add(save)
            db.commit()
            db.refresh(save)
            result.save_id = save.id
            # Re-serialise with save_id so the persisted payload matches the response.
            save.data = json.dumps(result.model_dump())
            db.commit()
    except Exception as exc:  # non-critical — never block the response
        logger.warning("[BRIEF] Auto-save failed: %s", exc)
        db.rollback()

    # ── Return ──────────────────────────────────────────────────────────
    return result


# ---------------------------------------------------------------------------
# POST /api/seo/score  (pure Python — no AI call, < 50ms)
# ---------------------------------------------------------------------------

@router.post("/score", response_model=SEOScoreResponse)
def score_content(
    data: SEOScoreRequest,
    current_user: User = Depends(get_current_user),
):
    readability      = score_readability(data.content)
    keyword_density  = analyse_keyword_density(data.content, data.primary_keyword)
    keyword_placement = analyse_keyword_placement(data.content, data.primary_keyword)
    # Enrich LSI with related keywords appended to content signal
    lsi_text = data.content + " " + " ".join(data.related_keywords)
    lsi              = analyse_lsi_coverage(lsi_text, data.primary_keyword)
    passive_voice    = count_passive_voice(data.content)
    links            = analyse_links(data.content)
    content_length   = score_content_length(
                           readability.get("word_count", 0),
                           data.target_word_count,
                       )
    structure        = analyse_content_structure(data.content)

    # --- component sub-scores for display ---
    from app.services.seo_tools import STOPWORDS  # already imported via tools
    kd_status = keyword_density.get("status", "missing")
    density_score = {"optimal": 100, "under": 50, "over": 40, "missing": 0}.get(kd_status, 0)
    placement_score = keyword_placement.get("placement_score", 0)
    kw_score = round((density_score * 0.5) + (placement_score * 0.5))

    cov_score = lsi.get("coverage_score", 0)

    import math as _math
    flesch = min(100, max(0, readability.get("flesch_score", 0)))
    passive_penalty = passive_voice.get("passive_percentage", 0) * 2
    r_score = max(0, round(flesch - passive_penalty))

    h1 = structure.get("h1_count", 0)
    h2 = structure.get("h2_count", 0)
    issue_count = len(structure.get("issues", []))
    s_score = min(100, max(0, (h1 > 0) * 30 + min(h2, 4) * 15 - issue_count * 10))

    l_score = links.get("score", 0)
    len_score = content_length.get("score", 0)

    # --- Real meta score from meta tab fields ---
    kw_lower = data.primary_keyword.lower()
    title_lower = data.meta_title.lower()
    desc_lower = data.meta_description.lower()
    title_len = len(data.meta_title)
    desc_len = len(data.meta_description)
    kw_in_title = bool(kw_lower and kw_lower in title_lower)
    kw_in_desc  = bool(kw_lower and kw_lower in desc_lower)
    title_ok    = 10 <= title_len <= 60
    desc_ok     = 50 <= desc_len <= 155
    # Score breakdown: title present=20, kw in title=30, desc present=20, kw in desc=20, both lengths ok=10
    m_score = (
        (20 if title_len > 0 else 0) +
        (30 if kw_in_title else 0) +
        (20 if desc_len > 0 else 0) +
        (20 if kw_in_desc else 0) +
        (10 if title_ok and desc_ok else 5 if title_ok or desc_ok else 0)
    )
    meta_detail = MetaDetail(
        keyword_in_title=kw_in_title,
        keyword_in_description=kw_in_desc,
        title_length=title_len,
        title_ok=title_ok,
        description_length=desc_len,
        description_ok=desc_ok,
        score=m_score,
    )

    overall = calculate_seo_score(
        readability=readability,
        keyword_density=keyword_density,
        structure=structure,
        meta_ok=m_score >= 50,
        keyword_placement=keyword_placement,
        lsi=lsi,
        passive_voice=passive_voice,
        links=links,
        content_length=content_length,
    )

    return SEOScoreResponse(
        overall=overall,
        keyword_score=kw_score,
        coverage_score=cov_score,
        readability_score=r_score,
        structure_score=s_score,
        links_score=l_score,
        meta_score=m_score,
        length_score=len_score,
        meta_detail=meta_detail,
        readability=readability,
        keyword_density=keyword_density,
        keyword_placement=keyword_placement,
        lsi=lsi,
        passive_voice=passive_voice,
        links=links,
        content_length=content_length,
        structure=structure,
    )

# ---------------------------------------------------------------------------
# POST /api/seo/tips  — AI tips grounded in the full live-editor analysis
# ---------------------------------------------------------------------------

# Tips endpoint — constants
_TIPS_ALLOWED_CATEGORIES = {"Keyword", "Readability", "Structure", "Meta", "Coverage", "Links", "Length", "Content"}
_TIPS_ALLOWED_PRIORITIES = {"high", "medium", "low"}
_TIPS_MAX_HTML_CHARS = 6000
_TIPS_MIN = 4
_TIPS_MAX = 8

# Sub-score weights must match frontend/src/lib/seo-analysis.ts SCORE_WEIGHTS
_SUBSCORE_WEIGHTS: dict[str, float] = {
    "Keyword": 0.25,
    "Coverage": 0.20,
    "Readability": 0.15,
    "Structure": 0.15,
    "Links": 0.10,
    "Meta": 0.10,
    "Length": 0.05,
}

# Priority thresholds expressed as max overall-score gain from fixing the category.
_PRIORITY_HIGH_MIN = 8.0
_PRIORITY_MEDIUM_MIN = 3.0

# Regex patterns — one or more per category — that identify what a tip is
# *really* targeting. Order matters inside `_detect_category`: the category
# with the most matches wins; ties keep the declared category to avoid
# thrashing on ambiguous tips.
_CATEGORY_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "Length": (
        re.compile(r"\bword count\b", re.I),
        re.compile(r"\bmore words\b", re.I),
        re.compile(r"\bexpand (?:to|the|by)\b", re.I),
        re.compile(r"\b(?:reach|hit)\s+(?:the\s+|your\s+)?(?:target|\d+\s+words?)\b", re.I),
        re.compile(r"\btotal words?\b", re.I),
        re.compile(r"\bto hit\s+\d+\s+words?\b", re.I),
        re.compile(r"\bword\s+target\b", re.I),
    ),
    "Meta": (
        re.compile(r"\bmeta title\b", re.I),
        re.compile(r"\bmeta description\b", re.I),
        re.compile(r"\btitle tag\b", re.I),
        re.compile(r"\bdescription tag\b", re.I),
        re.compile(r"\bserp snippet\b", re.I),
    ),
    "Structure": (
        re.compile(r"\badd (?:an?\s+)?(?:h[123]|heading)\b", re.I),
        re.compile(r"\bsplit into sections\b", re.I),
        re.compile(r"\bbreak (?:into|up) (?:the\s+)?paragraph", re.I),
        re.compile(r"\bsub-?heading\b", re.I),
    ),
    "Readability": (
        re.compile(r"\b(?:sentence length|long sentences?|shorten sentences?)\b", re.I),
        re.compile(r"\bpassive voice\b", re.I),
        re.compile(r"\bflesch\b", re.I),
        re.compile(r"\bavg sentence\b", re.I),
    ),
    "Links": (
        re.compile(r"\badd (?:a|more)\s+link", re.I),
        re.compile(r"\b(?:internal|external|outbound|inbound)\s+link", re.I),
        re.compile(r"\blink to\s", re.I),
    ),
    "Coverage": (
        re.compile(r"\bunique terms?\b", re.I),
        re.compile(r"\blsi\b", re.I),
        re.compile(r"\bsemantic (?:coverage|terms?)\b", re.I),
        re.compile(r"\bsupporting terms?\b", re.I),
        re.compile(r"\brelated topics?\b", re.I),
        re.compile(r"\bsubtopic", re.I),
        re.compile(r"\bentity coverage\b", re.I),
    ),
    "Keyword": (
        re.compile(r"\bkeyword density\b", re.I),
        re.compile(r"\bkeyword in (?:the\s+)?(?:h[123]|title|description|first paragraph)", re.I),
        re.compile(r"\buse the keyword\b", re.I),
        re.compile(r"\b(?:primary|focus) keyword\b", re.I),
    ),
}


class SEOTipsAnalysis(BaseModel):
    """Subset of the frontend `SEOAnalysisResult` the tips endpoint needs.

    All fields default — older clients (that send only the legacy shape)
    still work; missing data just degrades the prompt context.
    """
    overall: int = 0
    keyword_score: int = 0
    coverage_score: int = 0
    readability_score: int = 0
    structure_score: int = 0
    links_score: int = 0
    meta_score: int = 0
    length_score: int = 0
    meta_detail: dict = {}
    readability: dict = {}
    keyword_density: dict = {}
    keyword_placement: dict = {}
    lsi: dict = {}
    passive_voice: dict = {}
    links: dict = {}
    content_length: dict = {}
    structure: dict = {}


class SEOTipsRequest(BaseModel):
    # New, preferred payload
    html: str = ""
    meta_title: str = ""
    meta_description: str = ""
    primary_keyword: str = ""
    related_keywords: str = ""
    target_word_count: int = 1500
    analysis: SEOTipsAnalysis | None = None

    # Legacy fields — kept for backwards compatibility with older clients.
    # If `html` and `analysis` are absent these still produce a usable prompt.
    content: str = ""
    overall_score: int = 0
    readability_status: str = ""
    keyword_status: str = ""
    structure_issues: list[str] = []


class SEOTip(BaseModel):
    category: str   # Keyword | Readability | Structure | Meta | Coverage | Links | Length | Content
    priority: str   # high | medium | low
    tip: str        # the actionable advice


class SEOTipsResponse(BaseModel):
    tips: list[SEOTip]


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _compute_headroom(a: SEOTipsAnalysis) -> dict[str, dict]:
    """Return per-category `{current, weight_pct, max_gain}` map.

    `max_gain` is the maximum points a category can contribute to the *overall*
    score if its sub-score went from current → 100. Used to calibrate priority
    without leaving it to the LLM's instinct.
    """
    scores = {
        "Keyword": a.keyword_score,
        "Coverage": a.coverage_score,
        "Readability": a.readability_score,
        "Structure": a.structure_score,
        "Links": a.links_score,
        "Meta": a.meta_score,
        "Length": a.length_score,
    }
    return {
        cat: {
            "current": scores[cat],
            "weight_pct": int(_SUBSCORE_WEIGHTS[cat] * 100),
            "max_gain": round(_SUBSCORE_WEIGHTS[cat] * (100 - scores[cat]), 1),
        }
        for cat in _SUBSCORE_WEIGHTS
    }


def _detect_category(tip_text: str) -> str | None:
    """Return the best-matching category from tip text, else None.

    Scores each category by how many of its patterns fire, returning the
    winner only if it has strictly more matches than any other category.
    Ties → None (don't override the declared category).
    """
    scores: dict[str, int] = {}
    for cat, patterns in _CATEGORY_PATTERNS.items():
        hits = sum(1 for p in patterns if p.search(tip_text))
        if hits:
            scores[cat] = hits
    if not scores:
        return None
    top_cat, top_hits = max(scores.items(), key=lambda kv: kv[1])
    # Reject if any other category ties the top score
    if sum(1 for h in scores.values() if h == top_hits) > 1:
        return None
    return top_cat


def _enforce_priority(priority: str, category: str, headroom: dict[str, dict]) -> str:
    """Clamp priority to what the category's headroom can actually justify.

    Applies only to sub-score categories; `Content` (catch-all) keeps the
    LLM's priority since we can't attribute it to a single weight.
    """
    info = headroom.get(category)
    if info is None:
        return priority
    gain = info["max_gain"]
    if gain < _PRIORITY_MEDIUM_MIN:
        return "low"
    if gain < _PRIORITY_HIGH_MIN and priority == "high":
        return "medium"
    return priority


def _normalize_tip(item: dict, headroom: dict[str, dict] | None = None) -> SEOTip | None:
    tip_text = (item.get("tip") or "").strip()
    if not tip_text:
        return None

    category = (item.get("category") or "Content").strip()
    if category not in _TIPS_ALLOWED_CATEGORIES:
        category = "Content"

    # Reclassify if the tip text clearly targets a different category
    detected = _detect_category(tip_text)
    if detected and detected in _TIPS_ALLOWED_CATEGORIES and detected != category:
        category = detected

    priority = (item.get("priority") or "medium").strip().lower()
    if priority not in _TIPS_ALLOWED_PRIORITIES:
        priority = "medium"

    if headroom is not None:
        priority = _enforce_priority(priority, category, headroom)

    return SEOTip(category=category, priority=priority, tip=tip_text)


def _build_priority_section(headroom: dict[str, dict]) -> str:
    rows = sorted(headroom.items(), key=lambda kv: kv[1]["max_gain"], reverse=True)
    lines = ["HEADROOM (max overall-score gain if that category went to 100; higher = bigger impact):"]
    for cat, info in rows:
        lines.append(
            f"- {cat}: current {info['current']}/100, weight {info['weight_pct']}%, max +{info['max_gain']} overall"
        )
    lines.append("")
    lines.append("PRIORITY RULES — apply these literally, do not guess:")
    lines.append(f"- high:   category max_gain ≥ {_PRIORITY_HIGH_MIN}")
    lines.append(f"- medium: category max_gain between {_PRIORITY_MEDIUM_MIN} and {_PRIORITY_HIGH_MIN}")
    lines.append(f"- low:    category max_gain < {_PRIORITY_MEDIUM_MIN}")
    return "\n".join(lines)


def _build_rubric_section() -> str:
    return """SCORING RUBRIC (weights → overall score):
- Keyword (25%): density target 1–3%; placement in H1 (+40), first H2 (+35), first paragraph (+25)
- Content Coverage / LSI (20%): target 200+ unique supporting terms
- Readability (15%): 0.7 × Flesch + 0.3 × (100 − passive% × 2). Flesch ≥ 70 easy, 50–70 moderate, <50 difficult
- Structure (15%): exactly one H1, ≥ 2 H2s, paragraphs ≤ 150 words
- Links (10%): 0 = 0, else 40 + count × 15 (capped at 100)
- Meta (10%): title 10–60 chars, description 50–155 chars, keyword in each
- Length (5%): linear — word_count / target_word_count

STATUS VOCAB:
- keyword_density.status: optimal | under | over | missing
- readability.status: easy | moderate | difficult | no_content
- content_length.status: optimal | near | under | short
"""


def _build_analysis_section(req: SEOTipsRequest) -> str:
    """Serialise the structured analysis into a compact prompt section.

    Only include keys that carry signal — empty dicts fall back to the legacy
    status fields so old clients still produce meaningful tips.
    """
    a = req.analysis
    if a is None:
        return (
            f"overall_score: {req.overall_score}\n"
            f"readability_status: {req.readability_status or 'unknown'}\n"
            f"keyword_density_status: {req.keyword_status or 'unknown'}\n"
            f"structure_issues: {', '.join(req.structure_issues) or 'none'}\n"
        )

    def line(label: str, obj: dict | None) -> str:
        if not obj:
            return ""
        return f"{label}: {json.dumps(obj, separators=(',', ':'), ensure_ascii=False)}\n"

    parts = [
        f"overall_score: {a.overall}/100\n",
        (
            "sub_scores: "
            f"keyword={a.keyword_score}, coverage={a.coverage_score}, "
            f"readability={a.readability_score}, structure={a.structure_score}, "
            f"links={a.links_score}, meta={a.meta_score}, length={a.length_score}\n"
        ),
        line("keyword_density", a.keyword_density),
        line("keyword_placement", a.keyword_placement),
        line("readability", a.readability),
        line("passive_voice", a.passive_voice),
        line("structure", a.structure),
        line("links", a.links),
        line("lsi", a.lsi),
        line("content_length", a.content_length),
        line("meta_detail", a.meta_detail),
    ]
    return "".join(p for p in parts if p)


def _rule_based_tips(req: SEOTipsRequest) -> list[SEOTip]:
    """Deterministic fallback when Gemini is unavailable or returns junk.

    Reads the structured analysis when present; falls back to legacy status
    fields otherwise.
    """
    a = req.analysis
    kw = req.primary_keyword or "your keyword"
    tips: list[SEOTip] = []

    # Keyword
    kw_status = (a.keyword_density.get("status") if a else "") or req.keyword_status
    kw_density = (a.keyword_density.get("density") if a else None)
    if kw_status in ("missing", "under"):
        tips.append(SEOTip(category="Keyword", priority="high",
            tip=f'"{kw}" appears too rarely ({kw_density or "0"}%). Use it in the first paragraph, at least one H2, and 1–3% of body text.'))
    elif kw_status == "over":
        tips.append(SEOTip(category="Keyword", priority="high",
            tip=f'"{kw}" is over-used ({kw_density}%). Replace some occurrences with synonyms to avoid keyword-stuffing penalties.'))

    # Keyword placement
    if a and req.primary_keyword:
        kp = a.keyword_placement
        missing = [where for where, present in (
            ("H1", kp.get("in_h1")),
            ("first H2", kp.get("in_h2")),
            ("first paragraph", kp.get("in_first_paragraph")),
        ) if not present]
        if missing:
            tips.append(SEOTip(category="Keyword", priority="medium",
                tip=f'Add "{kw}" to: {", ".join(missing)}. Each placement is worth up to 40 points on the keyword sub-score.'))

    # Readability
    r_status = (a.readability.get("status") if a else "") or req.readability_status
    if r_status == "difficult":
        aws = a.readability.get("avg_words_per_sentence") if a else None
        tips.append(SEOTip(category="Readability", priority="high",
            tip=f"Sentences are too long ({'avg ' + str(aws) + ' words' if aws else 'very long'}). Target <20 words per sentence and split paragraphs >150 words."))

    # Structure
    issues = (a.structure.get("issues") if a else None) or req.structure_issues
    for issue in (issues or [])[:2]:
        tips.append(SEOTip(category="Structure", priority="medium", tip=issue))

    # Meta
    if a:
        m = a.meta_detail
        if not m.get("title_ok"):
            tips.append(SEOTip(category="Meta", priority="medium",
                tip=f'Meta title is {m.get("title_length", 0)} chars. Target 10–60 for full SERP display.'))
        if not m.get("description_ok"):
            tips.append(SEOTip(category="Meta", priority="medium",
                tip=f'Meta description is {m.get("description_length", 0)} chars. Target 50–155 to avoid truncation.'))
        if req.primary_keyword and not m.get("keyword_in_title"):
            tips.append(SEOTip(category="Meta", priority="high",
                tip=f'Include "{kw}" in the meta title — worth 30 points on the meta sub-score.'))

    # Coverage
    if a and a.coverage_score < 50:
        unique = a.lsi.get("unique_terms", 0)
        tips.append(SEOTip(category="Coverage", priority="medium",
            tip=f"Only {unique} supporting terms detected (target 200+). Add related subtopics and synonyms to broaden semantic coverage."))

    # Length
    if a:
        cl = a.content_length
        cl_status = cl.get("status")
        wc = cl.get("word_count", 0)
        tgt = cl.get("target", req.target_word_count)
        if cl_status == "short":
            tips.append(SEOTip(category="Length", priority="medium",
                tip=f"Content is only {wc} / {tgt} words. Add ~{max(tgt - wc, 0)} more words — expand weak sections with examples or explanations."))
        elif cl_status == "under":
            tips.append(SEOTip(category="Length", priority="low",
                tip=f"Content is {wc} / {tgt} words. Expand one or two sections to reach target."))
        elif cl_status == "near":
            tips.append(SEOTip(category="Length", priority="low",
                tip=f"You're close — {wc} / {tgt} words. Add ~{max(tgt - wc, 0)} more words to hit target."))

    # Catch-all
    if not tips:
        overall = a.overall if a else req.overall_score
        if overall < 45:
            tips.append(SEOTip(category="Content", priority="high",
                tip="Add a single H1 at the top and break sections with H2s. That alone lifts both the structure and keyword-placement sub-scores significantly."))

    return tips[:_TIPS_MAX]


@router.post("/tips", response_model=SEOTipsResponse)
def generate_seo_tips(
    data: SEOTipsRequest,
    current_user: User = Depends(get_current_user),
):
    """Return specific, rubric-aware SEO tips for the live editor.

    - Sends the full analysis + HTML + meta + related keywords to Gemini.
    - Embeds the scoring rubric so Gemini knows which lever moves which score.
    - Falls back to deterministic rule-based tips if Gemini fails.
    """
    # Prefer new `html`; fall back to legacy `content` (plain text)
    source = data.html or data.content or ""
    source_label = "HTML" if data.html else "TEXT"
    content_preview = _truncate(source, _TIPS_MAX_HTML_CHARS)

    headroom = _compute_headroom(data.analysis) if data.analysis is not None else None
    priority_section = _build_priority_section(headroom) if headroom else ""

    prompt = f"""You are an expert SEO editor. Produce {_TIPS_MIN}–{_TIPS_MAX} specific, actionable tips for this content.

PRIMARY KEYWORD: "{data.primary_keyword or 'not set'}"
RELATED KEYWORDS: {data.related_keywords or 'none'}
META TITLE ({len(data.meta_title)} chars): {data.meta_title or '(empty)'}
META DESCRIPTION ({len(data.meta_description)} chars): {data.meta_description or '(empty)'}
TARGET WORD COUNT: {data.target_word_count}

LIVE ANALYSIS:
{_build_analysis_section(data)}

{_build_rubric_section()}
{priority_section}

CONTENT ({source_label}, truncated to {_TIPS_MAX_HTML_CHARS} chars):
---
{content_preview}
---

Rules for tips:
1. Each tip MUST reference a concrete element the writer can locate — a specific heading, sentence, paragraph, meta field, or missing section. No generic advice.
2. Pick `category` from the sub-score it targets. Tips about "hitting the word count" are Length, not Coverage. Tips about unique/supporting terms are Coverage. Tips about H1/H2/H3 are Structure.
3. Do not suggest changes that are already satisfied by the analysis above.
4. Keep each tip ≤ 240 characters.

Return ONLY a JSON array, no markdown, no commentary:
[
  {{
    "category": "Keyword | Readability | Structure | Meta | Coverage | Links | Length | Content",
    "priority": "high | medium | low",
    "tip": "specific actionable advice referencing actual content"
  }}
]
"""

    tips: list[SEOTip] = []
    raw = _gemini_call(prompt)

    if raw:
        try:
            parsed = json.loads(_strip_fences(raw))
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    normalized = _normalize_tip(item, headroom)
                    if normalized is not None:
                        tips.append(normalized)
                    if len(tips) >= _TIPS_MAX:
                        break
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("SEO tips: Gemini returned non-JSON payload: %s", exc)

    if not tips:
        logger.info("SEO tips: using rule-based fallback (Gemini empty or malformed)")
        tips = _rule_based_tips(data)

    return SEOTipsResponse(tips=tips)


# ---------------------------------------------------------------------------
# POST /api/seo/apply-tips  — one-click auto-fix of AI tips
# ---------------------------------------------------------------------------

_APPLY_MAX_HTML_CHARS = 8000          # input ceiling (chars)
_APPLY_MIN_OUTPUT_RATIO = 0.5          # reject if Gemini shrinks content < 50%
_APPLY_MAX_TIPS = 10                   # cap tips sent per request


class SEOApplyTipsRequest(BaseModel):
    html: str = ""
    meta_title: str = ""
    meta_description: str = ""
    primary_keyword: str = ""
    related_keywords: str = ""
    target_word_count: int = 1500
    tips: list[SEOTip] = []
    analysis: SEOTipsAnalysis | None = None


class SEOSkippedTip(BaseModel):
    index: int
    reason: str


class SEOApplyTipsResponse(BaseModel):
    html: str
    meta_title: str
    meta_description: str
    applied: list[int]
    skipped: list[SEOSkippedTip]
    changes_summary: str


def _is_valid_apply_output(payload: dict, original_html_len: int) -> bool:
    """Shape + safety check on Gemini's apply-tips response.

    - Required keys present with correct types.
    - HTML must look like HTML (has `<` / `>`) and not shrink below 50% of input
      length. The ratio guards against accidental content destruction when the
      model returns a summary instead of a full document.
    """
    required_str_keys = ("html", "meta_title", "meta_description", "changes_summary")
    if not all(isinstance(payload.get(k), str) for k in required_str_keys):
        return False
    if not isinstance(payload.get("applied"), list) or not isinstance(payload.get("skipped"), list):
        return False

    html = payload["html"]
    if "<" not in html or ">" not in html:
        return False
    if original_html_len > 0 and len(html) < original_html_len * _APPLY_MIN_OUTPUT_RATIO:
        return False
    return True


def _coerce_skipped(raw: list) -> list[SEOSkippedTip]:
    out: list[SEOSkippedTip] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        reason = item.get("reason") or ""
        if isinstance(idx, int) and isinstance(reason, str):
            out.append(SEOSkippedTip(index=idx, reason=reason))
    return out


@router.post("/apply-tips", response_model=SEOApplyTipsResponse)
def apply_seo_tips(
    data: SEOApplyTipsRequest,
    current_user: User = Depends(get_current_user),
):
    """Apply the given AI tips to the draft in one shot.

    Returns updated HTML + meta fields plus the indices of tips that were
    applied vs. skipped (with reasons). Safe by construction:
      - Shrinkage guard: output HTML must be ≥ 50% of input size.
      - Shape guard: malformed Gemini output falls back to the original.
      - Tips requiring user-specific data (URLs, private facts) are skipped.
    """
    if not data.html.strip():
        raise HTTPException(status_code=400, detail="html is required")
    if not data.tips:
        raise HTTPException(status_code=400, detail="tips list is empty")

    tips = data.tips[:_APPLY_MAX_TIPS]
    html_in = _truncate(data.html, _APPLY_MAX_HTML_CHARS)

    tips_block = "\n".join(
        f"[{i}] ({t.category}, {t.priority}) {t.tip}" for i, t in enumerate(tips)
    )

    prompt = f"""You are an expert SEO editor applying improvements to a draft in a single pass.

PRIMARY KEYWORD: "{data.primary_keyword or 'not set'}"
RELATED KEYWORDS: {data.related_keywords or 'none'}
TARGET WORD COUNT: {data.target_word_count}
CURRENT META TITLE ({len(data.meta_title)} chars): {data.meta_title or '(empty)'}
CURRENT META DESCRIPTION ({len(data.meta_description)} chars): {data.meta_description or '(empty)'}

TIPS TO APPLY (indexed):
{tips_block}

CURRENT HTML:
---
{html_in}
---

RULES:
1. Preserve the author's voice, factual claims, existing examples, and all correct information. Do NOT invent statistics, quotes, names, or URLs.
2. Do NOT delete existing content unless a tip explicitly requires removal. Prefer adding or rewriting in place.
3. Skip (do not apply) any tip that requires data you don't have:
   - Links tips that don't include a specific URL
   - Tips that reference external facts, testimonials, or citations
   For each skipped tip, include its index and a one-line reason.
4. Output MUST be valid HTML using only these tags: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a href>, <br>. Close every tag.
5. Integrate the primary keyword naturally; keep density between 1–3%. Never keyword-stuff.
6. Meta title: 10–60 chars. Meta description: 50–155 chars. Include the primary keyword in both when a Meta tip is applied.
7. Keep headings meaningful. Exactly one <h1>. At least two <h2>s if adding structure. Break paragraphs longer than ~150 words.

Return ONLY this JSON object (no markdown, no commentary):
{{
  "html": "<h1>...</h1>...",
  "meta_title": "updated title",
  "meta_description": "updated description",
  "applied": [0, 1, 3],
  "skipped": [{{"index": 2, "reason": "requires a specific URL"}}],
  "changes_summary": "one-sentence summary of what changed"
}}
"""

    raw = _gemini_call(prompt)
    if not raw or not raw.strip():
        raise HTTPException(
            status_code=503,
            detail="AI is busy right now. Please try again in a moment.",
        )

    try:
        parsed = json.loads(_strip_fences(raw))
    except (json.JSONDecodeError, ValueError) as exc:
        # Truncated JSON (common when the fallback model hits max_tokens
        # mid-object) looks like a parse error ending at the last char.
        # Surface a clearer, actionable message instead of a generic 502.
        truncated_hint = len(raw) > 0 and str(exc).endswith(f"(char {len(raw)})")
        logger.warning(
            "Apply-tips: non-JSON payload (truncated=%s, raw=%d chars): %s",
            truncated_hint, len(raw), exc,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "AI response was cut off — try again, or shorten the content first."
                if truncated_hint
                else "AI returned an invalid response. Please try again."
            ),
        )

    if not isinstance(parsed, dict) or not _is_valid_apply_output(parsed, len(html_in)):
        logger.warning(
            "Apply-tips: shape/shrinkage guard failed (in=%d, out=%s)",
            len(html_in),
            len(parsed.get("html", "")) if isinstance(parsed, dict) else "N/A",
        )
        raise HTTPException(
            status_code=502,
            detail="AI output failed validation. Please try again.",
        )

    applied_raw = parsed.get("applied") or []
    applied = [i for i in applied_raw if isinstance(i, int) and 0 <= i < len(tips)]

    return SEOApplyTipsResponse(
        html=parsed["html"],
        meta_title=parsed.get("meta_title") or data.meta_title,
        meta_description=parsed.get("meta_description") or data.meta_description,
        applied=applied,
        skipped=_coerce_skipped(parsed.get("skipped") or []),
        changes_summary=(parsed.get("changes_summary") or "").strip(),
    )


# ---------------------------------------------------------------------------
# SEO Saves — persist briefs and editor drafts per user
# ---------------------------------------------------------------------------

class SeoSaveRequest(BaseModel):
    type: str           # "brief" | "draft"
    title: str
    data: dict


class SeoSaveItem(BaseModel):
    id: str
    type: str
    title: str
    data: dict
    created_at: str
    updated_at: str


@router.post("/saves", response_model=SeoSaveItem, status_code=status.HTTP_201_CREATED)
def create_seo_save(
    payload: SeoSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.type not in ("brief", "draft"):
        raise HTTPException(status_code=400, detail="type must be 'brief' or 'draft'")
    save = SeoSave(
        user_id=current_user.id,
        type=payload.type,
        title=payload.title.strip() or "Untitled",
        data=json.dumps(payload.data),
    )
    db.add(save)
    db.commit()
    db.refresh(save)
    return SeoSaveItem(
        id=save.id,
        type=save.type,
        title=save.title,
        data=json.loads(save.data),
        created_at=save.created_at.isoformat(),
        updated_at=save.updated_at.isoformat(),
    )


@router.get("/saves", response_model=list[SeoSaveItem])
def list_seo_saves(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saves = (
        db.query(SeoSave)
        .filter(SeoSave.user_id == current_user.id, SeoSave.type != "blog")
        .order_by(SeoSave.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        SeoSaveItem(
            id=s.id,
            type=s.type,
            title=s.title,
            data=json.loads(s.data),
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        )
        for s in saves
    ]


@router.get("/saves/{save_id}", response_model=SeoSaveItem)
def get_seo_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = db.query(SeoSave).filter(SeoSave.id == save_id, SeoSave.user_id == current_user.id).first()
    if not save:
        raise HTTPException(status_code=404, detail="Save not found")
    return SeoSaveItem(
        id=save.id,
        type=save.type,
        title=save.title,
        data=json.loads(save.data),
        created_at=save.created_at.isoformat(),
        updated_at=save.updated_at.isoformat(),
    )


@router.put("/saves/{save_id}", response_model=SeoSaveItem)
def update_seo_save(
    save_id: str,
    payload: SeoSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = db.query(SeoSave).filter(SeoSave.id == save_id, SeoSave.user_id == current_user.id).first()
    if not save:
        raise HTTPException(status_code=404, detail="Save not found")
    save.title = payload.title.strip() or save.title
    save.data = json.dumps(payload.data)
    db.commit()
    db.refresh(save)
    return SeoSaveItem(
        id=save.id,
        type=save.type,
        title=save.title,
        data=json.loads(save.data),
        created_at=save.created_at.isoformat(),
        updated_at=save.updated_at.isoformat(),
    )


@router.delete("/saves/{save_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_seo_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = db.query(SeoSave).filter(SeoSave.id == save_id, SeoSave.user_id == current_user.id).first()
    if not save:
        raise HTTPException(status_code=404, detail="Save not found")
    db.delete(save)
    db.commit()