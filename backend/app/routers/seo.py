import json
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.config import settings
from app.dependencies import get_current_user
from app.models.user import User
from app.services.scraper import scrape_website
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
    competitor_urls: list[str] = []
    content_draft: str = ""  # optional existing draft to score against the brief


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


class SEOBriefResponse(BaseModel):
    topic: str
    primary_keyword: str
    secondary_keywords: list[str]
    keyword_data: list[KeywordVolume]
    competitor_insights: list[CompetitorInsight]
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
# Gemini helper
# ---------------------------------------------------------------------------

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)


def _gemini_call(prompt: str, max_retries: int = 3) -> str | None:
    """Raw Gemini call with exponential backoff on 429 rate limits."""
    if not settings.GOOGLE_GEMINI_API_KEY:
        return None
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                _GEMINI_URL.format(key=settings.GOOGLE_GEMINI_API_KEY),
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=25.0,
            )
            if resp.status_code == 429:
                wait = 2 ** (attempt + 1)  # 2s, 4s, 8s
                logger.warning("Gemini rate limited (429), retrying in %ds (attempt %d/%d)", wait, attempt + 1, max_retries)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            logger.warning("Gemini call failed: %s", exc)
            return None
    logger.warning("Gemini call exhausted retries after %d attempts", max_retries)
    return None


def _gemini_web_search(prompt: str, max_retries: int = 3) -> tuple[str | None, list[str]]:
    """
    Gemini call with Google Search grounding + exponential backoff on 429.
    Returns (response_text, grounding_urls) where grounding_urls are
    real URLs from live Google Search results.
    """
    if not settings.GOOGLE_GEMINI_API_KEY:
        return None, []
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
    }
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                _GEMINI_URL.format(key=settings.GOOGLE_GEMINI_API_KEY),
                json=payload,
                timeout=30.0,
            )
            if resp.status_code == 429:
                wait = 2 ** (attempt + 1)  # 2s, 4s, 8s
                logger.warning("Gemini web search rate limited (429), retrying in %ds (attempt %d/%d)", wait, attempt + 1, max_retries)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            candidate = data["candidates"][0]
            text = candidate["content"]["parts"][0]["text"]

            urls: list[str] = []
            grounding_meta = candidate.get("groundingMetadata", {})
            for chunk in grounding_meta.get("groundingChunks", []):
                uri = chunk.get("web", {}).get("uri", "")
                if uri.startswith("http"):
                    urls.append(uri)
            for support in grounding_meta.get("groundingSupports", []):
                for idx in support.get("groundingChunkIndices", []):
                    try:
                        uri = grounding_meta["groundingChunks"][idx].get("web", {}).get("uri", "")
                        if uri.startswith("http") and uri not in urls:
                            urls.append(uri)
                    except (IndexError, KeyError):
                        pass
            return text, urls
        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            logger.warning("Gemini web search call failed: %s", exc)
            return None, []
    logger.warning("Gemini web search exhausted retries")
    return None, []


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    return raw.strip()


# ---------------------------------------------------------------------------
# [4+6] Combined: extract keywords AND discover competitor URLs in ONE call
# ---------------------------------------------------------------------------

def _step4_and_6_combined(topic: str) -> tuple[dict, list[str]]:
    """
    Single Gemini web search call that simultaneously:
      - Extracts the primary keyword, secondary keywords, search intent, recommendations
      - Discovers real competitor URLs via Google Search grounding

    Returns (kw_data dict, competitor_urls list).
    One API call instead of two — avoids rate limit issues.
    """
    prompt = (
        f'Search Google for top articles ranking for: "{topic}"\n\n'
        f'Also act as an SEO keyword researcher for the topic: "{topic}"\n\n'
        'Return ONLY this JSON (no markdown, no explanation):\n'
        '{\n'
        '  "primary_keyword": "best 2-4 word keyword phrase",\n'
        '  "secondary_keywords": ["5 related 2-4 word phrases"],\n'
        '  "search_intent": "informational | transactional | navigational | commercial",\n'
        '  "recommendations": ["3 specific SEO tips as plain strings"]\n'
        '}'
    )
    text, grounding_urls = _gemini_web_search(prompt)

    # Parse keyword data from the response text
    kw_data = {}
    if text:
        try:
            kw_data = json.loads(_strip_fences(text))
        except Exception:
            pass

    if not kw_data.get("primary_keyword"):
        words = topic.lower().split()
        primary = " ".join(words[:3]) if len(words) >= 3 else topic.lower()
        kw_data = {
            "primary_keyword": primary,
            "secondary_keywords": [
                f"{primary} tips", f"{primary} guide", f"how to {primary}",
                f"best {primary} strategies", f"{primary} for beginners",
            ],
            "search_intent": "informational",
            "recommendations": [
                f"Target '{primary}' in your H1 and first 100 words.",
                "Aim for 1,500+ words to outperform top-ranking articles.",
                "Add FAQ schema to capture featured snippets.",
            ],
        }

    return kw_data, grounding_urls[:5]


# ---------------------------------------------------------------------------
# [4] Extract keywords via Gemini (standalone — used as fallback)
# ---------------------------------------------------------------------------

def _step4_extract_keywords(topic: str) -> dict:
    prompt = f"""You are an expert SEO keyword researcher.
Topic: "{topic}"

Return ONLY a JSON object (no markdown, no explanation):
{{
  "primary_keyword": "the single best SEO keyword phrase (2-4 words)",
  "secondary_keywords": ["5 related keyword phrases each 2-4 words targeting same intent"],
  "search_intent": "informational | transactional | navigational | commercial",
  "recommendations": ["3 specific SEO tips for this topic as plain strings"]
}}"""
    raw = _gemini_call(prompt)
    if raw:
        try:
            return json.loads(_strip_fences(raw))
        except Exception:
            pass
    # Fallback
    words = topic.lower().split()
    primary = " ".join(words[:3]) if len(words) >= 3 else topic.lower()
    return {
        "primary_keyword": primary,
        "secondary_keywords": [
            f"{primary} tips", f"{primary} guide", f"how to {primary}",
            f"best {primary} strategies", f"{primary} for beginners",
        ],
        "search_intent": "informational",
        "recommendations": [
            f"Target '{primary}' in your H1 and first 100 words.",
            "Aim for 1,500+ words to outperform top-ranking articles.",
            "Add FAQ schema to capture featured snippets.",
        ],
    }


# ---------------------------------------------------------------------------
# [5] DataForSEO — mock (no paid API required)
# ---------------------------------------------------------------------------

_VOLUME_TIERS = [
    (["how to", "best ", "top ", "guide"], "10K–100K / mo", "Hard"),
    (["tips", "strategies", "ideas", "examples"], "1K–10K / mo", "Medium"),
    (["for beginners", "tutorial", "step by step"], "500–5K / mo", "Easy"),
]


def _step5_dataforseo_mock(keywords: list[str]) -> list[dict]:
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
# [6] Scrape competitors + [7] Score their readability
# ---------------------------------------------------------------------------

def _scrape_url_to_insight(url: str) -> dict | None:
    """Scrape a single URL and return an insight dict, or None on failure."""
    try:
        scraped = scrape_website(url)
        content_text = scraped.get("main_content", "")
        readability = score_readability(content_text)
        top_kws = [k["keyword"] for k in extract_keywords_from_text(content_text, top_n=5)]
        return {
            "url": url,
            "title": scraped.get("title") or url,
            "word_count": readability.get("word_count", 0),
            "readability_score": readability.get("flesch_score", 0.0),
            "top_keywords": top_kws,
        }
    except Exception as exc:
        logger.warning("Competitor scrape failed for %s: %s", url, exc)
        return None


def _step6_scrape_competitors(competitor_urls: list[str]) -> list[dict]:
    """
    Scrape up to 3 provided URLs.
    Gracefully skips any that fail.
    """
    insights = []
    for url in competitor_urls[:3]:
        result = _scrape_url_to_insight(url)
        if result:
            insights.append(result)
    return insights


def _step6_discover_competitor_urls(topic: str, primary_keyword: str) -> list[str]:
    """
    Use Gemini with Google Search grounding to find real URLs that rank
    for this keyword. Grounding URLs come from live Google Search results —
    not from Gemini's memory — so they are guaranteed to be real pages.
    Falls back to an empty list if web search is unavailable.
    """
    prompt = (
        f'Search Google for: "{primary_keyword}"\n'
        f"Find the top 5 articles that rank for this keyword about '{topic}'. "
        "List the URLs of those articles."
    )
    _text, urls = _gemini_web_search(prompt)

    if urls:
        logger.info("Web search grounding returned %d URLs for '%s'", len(urls), primary_keyword)
        return urls[:5]

    # Grounding gave no URLs (e.g. API plan doesn't support it) — fall back
    # to a knowledge-based search but log that it's a fallback
    logger.warning(
        "Web search grounding returned no URLs for '%s' — "
        "falling back to knowledge-based search",
        primary_keyword,
    )
    fallback_prompt = (
        f'What are 5 real article URLs that currently rank on Google for "{primary_keyword}"? '
        f'Return ONLY a JSON array of URL strings, no markdown:\n["https://...", ...]'
    )
    raw = _gemini_call(fallback_prompt)
    if not raw:
        return []
    try:
        result = json.loads(_strip_fences(raw))
        if isinstance(result, list):
            return [u for u in result if isinstance(u, str) and u.startswith("http")][:5]
    except Exception as exc:
        logger.warning("Fallback competitor URL parse failed: %s", exc)
    return []


def _step6_auto_competitors(topic: str, primary_keyword: str) -> list[dict]:
    """
    Full auto-discovery pipeline:
    1. Ask Gemini for candidate URLs
    2. Scrape each one — discard any that fail
    3. Return up to 3 verified insights
    """
    candidate_urls = _step6_discover_competitor_urls(topic, primary_keyword)
    if not candidate_urls:
        return []

    insights = []
    for url in candidate_urls:
        if len(insights) >= 3:
            break
        result = _scrape_url_to_insight(url)
        if result and result["word_count"] > 0:  # only keep pages with real content
            insights.append(result)

    logger.info(
        "Auto competitor discovery: %d candidates → %d verified",
        len(candidate_urls), len(insights)
    )
    return insights


# ---------------------------------------------------------------------------
# [10] AI-enrich H2 outline via Gemini
# ---------------------------------------------------------------------------

def _step10_ai_enrich_outline(
    topic: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    competitor_insights: list[dict],
    word_count: int,
) -> list[dict]:
    """
    Ask Gemini to generate an SEO-optimised H2 outline, enriched with
    competitor context when available. Falls back to template outline.
    """
    competitor_context = ""
    if competitor_insights:
        lines = []
        for c in competitor_insights:
            lines.append(
                f"- {c['title']} ({c['word_count']} words, "
                f"top keywords: {', '.join(c['top_keywords'][:3])})"
            )
        competitor_context = "Competitor articles found:\n" + "\n".join(lines)

    prompt = f"""You are an expert SEO content strategist.

Topic: "{topic}"
Primary keyword: "{primary_keyword}"
Secondary keywords: {secondary_keywords}
Target word count: {word_count}
{competitor_context}

Generate an SEO-optimised H2 outline. Return ONLY a JSON array (no markdown):
[
  {{"heading": "H2 heading text", "notes": "brief writer's note for this section"}},
  ...
]

Rules:
- Include the primary keyword naturally in at least 2 headings
- Scale sections to hit the target word count (~{word_count // 300} sections minimum)
- Cover: intro concept, how it works, strategies, mistakes, quick-start, FAQs
- Do NOT repeat headings from competitor articles verbatim
"""
    raw = _gemini_call(prompt)
    if raw:
        try:
            sections = json.loads(_strip_fences(raw))
            if isinstance(sections, list) and sections:
                return sections
        except Exception:
            pass
    # Fallback to template
    from app.services.seo_tools import build_seo_outline
    return build_seo_outline(topic, [primary_keyword] + secondary_keywords, word_count)


# ---------------------------------------------------------------------------
# POST /api/seo/brief  — full 14-step flow
# ---------------------------------------------------------------------------

@router.post("/brief", response_model=SEOBriefResponse)
def generate_seo_brief(
    data: SEOBriefRequest,
    current_user: User = Depends(get_current_user),
):
    if not data.topic.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Topic is required.")

    # [4+6] Combined single Gemini call: keywords + competitor URL discovery
    # This halves the number of API calls vs doing them separately.
    if not data.competitor_urls:
        kw_data, discovered_urls = _step4_and_6_combined(data.topic)
    else:
        kw_data = _step4_extract_keywords(data.topic)
        discovered_urls = []

    primary_keyword: str = kw_data.get("primary_keyword", data.topic)
    secondary_keywords: list[str] = kw_data.get("secondary_keywords", [])
    recommendations: list[str] = kw_data.get("recommendations", [])
    all_keywords = [primary_keyword] + secondary_keywords

    # [5] DataForSEO mock — keyword volume + difficulty
    keyword_data = [KeywordVolume(**k) for k in _step5_dataforseo_mock(all_keywords)]

    # [6] Scrape + verify competitors
    # Use provided URLs, or URLs discovered by the combined call above
    urls_to_scrape = data.competitor_urls or discovered_urls
    if urls_to_scrape:
        raw_insights = _step6_scrape_competitors(urls_to_scrape)
    else:
        # Grounding returned no URLs — try dedicated auto-discovery as last resort
        raw_insights = _step6_auto_competitors(data.topic, primary_keyword)
    competitor_insights = [CompetitorInsight(**c) for c in raw_insights]

    # [8] Generate meta tags
    meta_raw = generate_meta_suggestions(data.topic, all_keywords)
    meta_suggestions = [MetaSuggestion(**m) for m in meta_raw]

    # [9] Schema markup
    first_meta = meta_raw[0]
    schema = generate_schema_markup(
        title=first_meta["title"],
        description=first_meta["description"],
        url=data.target_url,
    )

    # [10] AI-enrich H2 outline
    outline_raw = _step10_ai_enrich_outline(
        topic=data.topic,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        competitor_insights=raw_insights,
        word_count=data.target_word_count,
    )
    h2_outline = [H2Section(**s) for s in outline_raw]

    # [11] SERP preview
    serp = build_serp_preview(
        title=first_meta["title"],
        description=first_meta["description"],
        url=data.target_url or "https://yourwebsite.com",
    )

    # [12] Build recommendations (already returned from Gemini in step 4)
    # Append competitor-derived tip if insights available
    if competitor_insights:
        avg_wc = int(sum(c.word_count for c in competitor_insights) / len(competitor_insights))
        recommendations.append(
            f"Competitors average {avg_wc} words — aim for at least {avg_wc + 200} words to outrank them."
        )

    # [13] Score existing draft against the brief's primary keyword (if provided)
    draft_score: DraftScore | None = None
    if data.content_draft.strip():
        rd = score_readability(data.content_draft)
        kd = analyse_keyword_density(data.content_draft, primary_keyword)
        st = analyse_content_structure(data.content_draft)
        draft_score = DraftScore(
            overall=calculate_seo_score(rd, kd, st),
            readability=rd,
            keyword_density=kd,
            structure=st,
        )

    # [14] Return full JSON → consumed by frontend tabs
    return SEOBriefResponse(
        topic=data.topic,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        keyword_data=keyword_data,
        competitor_insights=competitor_insights,
        h2_outline=h2_outline,
        meta_suggestions=meta_suggestions,
        schema_markup=schema,
        serp_preview=serp,
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