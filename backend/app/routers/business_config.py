from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.schemas.business_config import (
    BusinessConfigCreate,
    BusinessConfigResponse,
    ScrapeWebsiteRequest,
    ScrapeWebsiteResponse,
)
from app.dependencies import get_current_user
from app.config import settings
from app.services.scraper import scrape_website, website_context_to_json
from app.services.seo_tools import extract_keywords_from_text
from app.routers.seo import _gemini_call, _strip_fences

router = APIRouter(prefix="/api/brand-kit", tags=["brand-kit"])

import logging
logger = logging.getLogger(__name__)


def _generate_website_summary(context: dict) -> str | None:
    """
    Send scraped website content to Gemini (Groq fallback) and return
    a concise business summary for display in the Brand Kit page.
    """
    title = context.get("title", "")
    meta = context.get("meta_description", "")
    main = context.get("main_content", "")[:1500]
    about = context.get("about_content", "")[:1000]
    services = context.get("services_content", "")[:1000]
    contact = context.get("contact_info", "")
    keywords = ", ".join(context.get("top_keywords", [])[:10])

    parts = []
    if title:        parts.append(f"Title: {title}")
    if meta:         parts.append(f"Meta description: {meta}")
    if main:         parts.append(f"Homepage content: {main}")
    if about:        parts.append(f"About page: {about}")
    if services:     parts.append(f"Services/Products: {services}")
    if contact:      parts.append(f"Contact info: {contact}")
    if keywords:     parts.append(f"Top keywords found: {keywords}")

    if not parts:
        return None

    prompt = f"""Analyse the following scraped website content and produce a concise business summary.

{chr(10).join(parts)}

Return a JSON object with exactly these fields:
{{
  "business_type": "One short phrase describing what this business does",
  "key_offerings": ["Up to 4 main products or services"],
  "target_audience": "One sentence describing who they serve",
  "location": "City/region if detectable, otherwise empty string",
  "tone": "professional | friendly | formal | casual — based on the writing style",
  "highlights": ["2-3 standout facts or unique selling points"]
}}

Rules: Only use information from the scraped content. No guessing. Return valid JSON only, no markdown fences."""

    raw = _gemini_call(prompt, max_retries=2)
    if not raw:
        logger.warning("[BRAND-KIT] LLM summary failed — no response")
        return None
    try:
        import json
        parsed = json.loads(_strip_fences(raw))
        if isinstance(parsed, dict):
            return json.dumps(parsed, ensure_ascii=False)
    except Exception as e:
        logger.warning("[BRAND-KIT] LLM summary JSON parse failed: %s", e)
    return None


@router.get("", response_model=BusinessConfigResponse | None)
def get_business_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    return config


@router.post("", response_model=BusinessConfigResponse)
def create_or_update_business_config(
    data: BusinessConfigCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    if config:
        for field, value in data.model_dump().items():
            setattr(config, field, value)
    else:
        config = BusinessConfig(user_id=current_user.id, **data.model_dump())
        db.add(config)

    db.commit()
    db.refresh(config)
    return config


@router.post("/scrape-website", response_model=ScrapeWebsiteResponse)
def scrape_website_endpoint(
    data: ScrapeWebsiteRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Scrape a website using the SEO Playwright+BS4 pipeline and store enriched
    context (title, headings, main content, top keywords, readability) for AI.
    """
    try:
        # Scrape website for business context (meta, about, services, contact)
        context = scrape_website(data.url)

        # Enrich with top keywords extracted from main content
        content_text = context.get("main_content", "")
        if content_text.strip():
            context["top_keywords"] = [
                k["keyword"]
                for k in extract_keywords_from_text(content_text, top_n=10)
            ]

        # Generate AI summary via Gemini → Groq fallback
        summary = _generate_website_summary(context)
        if summary:
            context["ai_summary"] = summary

        # NOTE: Not saving to DB here — user must press Save to persist
        return ScrapeWebsiteResponse(
            success=True,
            message="Website analyzed successfully",
            context=context,
            summary=summary,
        )
    except Exception as e:
        return ScrapeWebsiteResponse(
            success=False,
            message=str(e),
            context=None,
        )



