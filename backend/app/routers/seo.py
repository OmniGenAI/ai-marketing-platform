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

class SEOBriefRequest(BaseModel):
    topic: str
    target_url: str = ""
    target_word_count: int = 1500
    country: str = ""          # e.g. "in" for India, "us" for US (ISO 3166-1 alpha-2)
    device: str = ""           # "desktop" | "mobile" — optional Serper param
    competitor_urls: list[str] = []
    content_draft: str = ""    # optional existing draft to score against the brief


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
_GROQ_MODEL = "openai/gpt-oss-120b"


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


def _groq_call(prompt: str, max_retries: int = 2) -> str | None:
    """Groq fallback call — used when Gemini is down."""
    if not settings.GROQ_API_KEY:
        logger.warning("[LLM] Groq API key not set — skipping fallback")
        return None
    logger.info("[LLM] 🟡 Calling Groq/%s (prompt %d chars)...", _GROQ_MODEL, len(prompt))
    t0 = time.time()
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                _GROQ_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are an expert SEO strategist. Always respond with valid JSON only, no markdown fences."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.4,
                },
                timeout=30.0,
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
            text = resp.json()["choices"][0]["message"]["content"]
            logger.info("[LLM] ✅ Groq responded in %.1fs (%d chars)", time.time() - t0, len(text))
            return text
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
    return _groq_call(prompt)


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

    prompt = f"""You are a world-class SEO strategist. Analyse the following real Google SERP data and competitor content for the topic: "{topic}"

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

    # ── Return ──────────────────────────────────────────────────────────
    return SEOBriefResponse(
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
# POST /api/seo/tips  — AI tips based on actual content + score
# ---------------------------------------------------------------------------

class SEOTipsRequest(BaseModel):
    content: str
    primary_keyword: str = ""
    overall_score: int = 0
    readability_status: str = ""
    keyword_status: str = ""
    structure_issues: list[str] = []


class SEOTip(BaseModel):
    category: str   # e.g. "Keyword", "Readability", "Structure"
    priority: str   # "high" | "medium" | "low"
    tip: str        # the actionable advice


class SEOTipsResponse(BaseModel):
    tips: list[SEOTip]


@router.post("/tips", response_model=SEOTipsResponse)
def generate_seo_tips(
    data: SEOTipsRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Analyse the actual content + score data with Gemini and return
    specific, non-generic, actionable tips.
    Falls back to rule-based tips if Gemini is unavailable.
    """
    # Truncate content to ~1500 chars for the prompt (avoid token waste)
    content_preview = data.content[:1500] + ("…" if len(data.content) > 1500 else "")

    prompt = f"""You are an expert SEO editor. Analyse this content and give specific, actionable improvement tips.

PRIMARY KEYWORD: "{data.primary_keyword or 'not set'}"
OVERALL SEO SCORE: {data.overall_score}/100
READABILITY STATUS: {data.readability_status}
KEYWORD DENSITY STATUS: {data.keyword_status}
STRUCTURE ISSUES: {", ".join(data.structure_issues) if data.structure_issues else "none"}

CONTENT (first 1500 chars):
---
{content_preview}
---

Give exactly 4-6 specific tips based on what you actually see in this content.
Each tip must reference something concrete in the text — not generic advice.

Return ONLY a JSON array (no markdown):
[
  {{
    "category": "Keyword | Readability | Structure | Meta | Content",
    "priority": "high | medium | low",
    "tip": "specific actionable advice referencing actual content"
  }}
]

Priority rules:
- high: fixes that will raise score by 10+ points
- medium: meaningful improvements
- low: polish and optimisation
"""
    raw = _gemini_call(prompt)
    tips: list[SEOTip] = []

    if raw:
        try:
            parsed = json.loads(_strip_fences(raw))
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict) and "tip" in item:
                        tips.append(SEOTip(
                            category=item.get("category", "General"),
                            priority=item.get("priority", "medium"),
                            tip=item["tip"],
                        ))
        except Exception:
            pass

    # Rule-based fallback if Gemini failed or returned nothing
    if not tips:
        if data.keyword_status in ("missing", "under"):
            tips.append(SEOTip(category="Keyword", priority="high",
                tip=f'Your keyword "{data.primary_keyword}" appears too rarely. Use it naturally in the first paragraph, at least one H2, and 1–3% of your word count.'))
        if data.keyword_status == "over":
            tips.append(SEOTip(category="Keyword", priority="high",
                tip=f'"{data.primary_keyword}" is over-used (>{3}%). Replace some occurrences with synonyms to avoid keyword stuffing penalties.'))
        if data.readability_status in ("difficult",):
            tips.append(SEOTip(category="Readability", priority="high",
                tip="Your sentences are too long and complex. Aim for sentences under 20 words. Split long paragraphs into 2–3 shorter ones."))
        if data.structure_issues:
            for issue in data.structure_issues[:2]:
                tips.append(SEOTip(category="Structure", priority="medium", tip=issue))
        if data.overall_score < 45:
            tips.append(SEOTip(category="Content", priority="high",
                tip="Add a clear H1 heading at the top, then use H2s to break up each main section. This alone will significantly improve your score."))

    return SEOTipsResponse(tips=tips)


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
        .filter(SeoSave.user_id == current_user.id)
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