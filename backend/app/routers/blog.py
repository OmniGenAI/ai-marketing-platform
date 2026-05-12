import json
import logging
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.dependencies import get_current_user
from app.models.seo_save import SeoSave
from app.models.user import User
from app.models.wallet import Wallet
from app.routers.seo import _llm_call, _strip_fences
from app.services.credits import COST_BLOG_GENERATE, charge_credits, require_credits

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/blog", tags=["blog"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class H2Section(BaseModel):
    heading: str
    notes: str = ""


class BusinessContext(BaseModel):
    business_name: str = ""
    niche: str = ""
    location: str = ""
    target_audience: str = ""
    products: str = ""
    brand_voice: str = ""


class SerpResult(BaseModel):
    title: str
    link: str
    snippet: str


class CompetitorInsight(BaseModel):
    url: str
    title: str
    top_keywords: list[str] = []
    content_summary: str = ""
    headings: list[str] = []


class MetaSuggestionInput(BaseModel):
    title: str = ""
    description: str = ""


class BlogGenerateRequest(BaseModel):
    topic: str
    primary_keyword: str = ""
    secondary_keywords: list[str] = []
    nlp_terms: list[str] = []
    h2_outline: list[H2Section] = []
    content_gaps: list[str] = []
    seo_recommendations: list[str] = []
    serp_results: list[SerpResult] = []
    competitor_insights: list[CompetitorInsight] = []
    # Optional fields carried over from a fully-rendered SEO brief — give the
    # writer LLM extra context so the blog matches the search intent and
    # mirrors the brief's preferred meta tags.
    search_intent: str = ""  # informational / commercial / transactional / navigational
    meta_suggestions: list[MetaSuggestionInput] = []
    word_count: int = 1500
    tone: str = "professional"
    business_context: BusinessContext | None = None
    # If provided, the existing save is updated in place (UPSERT semantics).
    # Regenerating a blog no longer creates duplicate rows in the library.
    save_id: str | None = None


class BlogGenerateResponse(BaseModel):
    title: str
    content: str          # full markdown blog post
    word_count: int
    primary_keyword: str
    meta_title: str
    meta_description: str
    schema_markup: dict
    save_id: str | None = None
    # ``status`` is "generating" while a background task is still rendering
    # the blog. The frontend polls /api/blog/saves/{save_id} until the
    # status disappears (= ready) or becomes "failed". On the completed
    # /api/blog/saves/{id} response the value is read out of ``data.status``.
    status: str | None = None


# ---------------------------------------------------------------------------
# Blog generation — Gemini → Groq fallback
# ---------------------------------------------------------------------------

def _extract_clean_dict(text: str) -> dict | None:
    """Try json.loads on text, return dict only if it has a non-empty content field."""
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            return None
        content = parsed.get("content", "")
        # If content itself looks like nested JSON, unwrap it
        if isinstance(content, str) and content.strip().startswith("{"):
            try:
                inner = json.loads(content)
                if isinstance(inner, dict) and inner.get("content"):
                    return inner
            except Exception:
                pass
        if content:
            return parsed
    except Exception:
        pass
    return None


def _parse_blog_response(raw: str, topic: str) -> dict | None:
    """
    Robustly extract blog JSON from LLM response.
    Handles: markdown fences, nested JSON, extra surrounding text,
    and plain markdown responses.
    """
    cleaned = _strip_fences(raw.strip())

    # 1. Direct parse
    result = _extract_clean_dict(cleaned)
    if result:
        return result

    # 2. Extract outermost {...} block (model may have added preamble/suffix)
    # Use non-greedy inner match to avoid catastrophic backtracking on large strings
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', cleaned, re.DOTALL)
    if match:
        result = _extract_clean_dict(match.group(0))
        if result:
            return result

    # 3. Fallback: last-resort greedy match
    match2 = re.search(r'\{[\s\S]+\}', cleaned)
    if match2:
        result = _extract_clean_dict(match2.group(0))
        if result:
            return result

    # 4. Plain markdown — model ignored JSON instruction entirely
    if cleaned and (cleaned.startswith("#") or len(cleaned) > 300):
        logger.warning("[BLOG] Wrapping plain-text response as content")
        lines = cleaned.splitlines()
        title = topic
        for line in lines[:5]:
            stripped = line.lstrip("#").strip()
            if stripped and len(stripped) > 10:
                title = stripped[:70]
                break
        return {
            "title": title,
            "content": cleaned,
            "meta_title": title[:60],
            "meta_description": f"Learn about {topic}.",
        }

    logger.warning("[BLOG] Could not parse response (%d chars): %s...", len(raw), raw[:300])
    return None


def _build_blog_prompt(data: BlogGenerateRequest) -> str:
    # Business context block
    biz_block = ""
    if data.business_context:
        parts = []
        bc = data.business_context
        if bc.business_name: parts.append(f"Business: {bc.business_name}")
        if bc.niche:         parts.append(f"Industry: {bc.niche}")
        if bc.location:      parts.append(f"Location: {bc.location}")
        if bc.target_audience: parts.append(f"Target Audience: {bc.target_audience}")
        if bc.products:      parts.append(f"Products/Services: {bc.products}")
        if bc.brand_voice:   parts.append(f"Brand Voice: {bc.brand_voice}")
        if parts:
            biz_block = "=== BUSINESS CONTEXT (tailor ALL content for this business) ===\n" + "\n".join(parts) + "\n\n"

    # SERP data block — real Google results from the brief
    serp_block = ""
    if data.serp_results:
        serp_lines = "\n".join(
            f"{i+1}. {s.title} ({s.link})\n   {s.snippet}"
            for i, s in enumerate(data.serp_results[:6])
        )
        serp_block = f"=== REAL GOOGLE SERP DATA (use this to understand what already ranks) ===\n{serp_lines}\n\n"

    # Competitor insights block — includes full scraped content
    comp_block = ""
    if data.competitor_insights:
        comp_parts = []
        for c in data.competitor_insights[:4]:
            entry = f"URL: {c.url}\nTitle: {c.title}\nTop keywords: {', '.join(c.top_keywords[:5])}"
            if c.headings:
                entry += f"\nHeadings: {' | '.join(c.headings[:8])}"
            if c.content_summary:
                entry += f"\nContent excerpt:\n{c.content_summary[:800]}"
            comp_parts.append(entry)
        comp_block = "=== SCRAPED COMPETITOR PAGES (real content from top-ranking pages — do NOT copy, surpass them) ===\n" + "\n---\n".join(comp_parts) + "\n\n"

    # NLP terms block
    nlp_block = ""
    if data.nlp_terms:
        nlp_block = f"=== SEMANTIC/NLP TERMS (weave these in naturally for topic coverage) ===\n{', '.join(data.nlp_terms[:12])}\n\n"

    # Content gaps block
    gaps_block = ""
    if data.content_gaps:
        gaps_block = "=== CONTENT GAPS (topics competitors missed — weave these in naturally) ===\n"
        gaps_block += "\n".join(f"- {g}" for g in data.content_gaps[:5]) + "\n\n"

    # SEO recommendations block
    recs_block = ""
    if data.seo_recommendations:
        recs_block = "=== SEO RECOMMENDATIONS (apply these while writing) ===\n"
        recs_block += "\n".join(f"- {r}" for r in data.seo_recommendations[:6]) + "\n\n"

    # H2 outline block
    outline_block = ""
    if data.h2_outline:
        outline_lines = []
        for i, section in enumerate(data.h2_outline, 1):
            line = f"{i}. {section.heading}"
            if section.notes:
                line += f" — {section.notes}"
            outline_lines.append(line)
        outline_block = "=== H2 OUTLINE TO FOLLOW ===\n" + "\n".join(outline_lines) + "\n\n"

    # Keywords block
    kw_block = ""
    if data.primary_keyword:
        kw_block = f"Primary Keyword: {data.primary_keyword}\n"
        if data.secondary_keywords:
            kw_block += f"Secondary Keywords: {', '.join(data.secondary_keywords[:6])}\n"
        kw_block += "\n"

    # Search intent block — when carried in from an SEO brief this drives
    # angle / tone (e.g. "commercial" implies CTA-heavy, "informational"
    # implies how-to / explainer).
    intent_block = ""
    if data.search_intent:
        intent_block = (
            "=== SEARCH INTENT ===\n"
            f"Resolve content for the **{data.search_intent}** search intent.\n\n"
        )

    # Meta suggestions block — example title / description pairs from the
    # brief LLM. Helps the writer LLM align meta tags with the brief.
    meta_block = ""
    if data.meta_suggestions:
        meta_lines = []
        for i, m in enumerate(data.meta_suggestions[:3], 1):
            t = (m.title or "").strip()
            d = (m.description or "").strip()
            if t or d:
                meta_lines.append(f"{i}. Title: {t}\n   Description: {d}")
        if meta_lines:
            meta_block = (
                "=== META TAG SUGGESTIONS FROM SEO BRIEF (align tone, do not copy verbatim) ===\n"
                + "\n".join(meta_lines) + "\n\n"
            )

    target_sections = max(3, data.word_count // 300)
    words_per_section = data.word_count // max(1, len(data.h2_outline) or target_sections)

    prompt = f"""You are an expert SEO content writer. Write a complete, publish-ready blog post.

{biz_block}{kw_block}{intent_block}{serp_block}{comp_block}{nlp_block}{gaps_block}{recs_block}{meta_block}{outline_block}Topic: {data.topic}
Target word count: {data.word_count} words
Tone: {data.tone}
Minimum H2 sections: {target_sections}
Words per section: approximately {words_per_section}

ACCURACY RULES (most important):
- Do NOT hallucinate. Only write facts you are confident are true.
- Do NOT invent statistics, studies, percentages, or quotes — if you want to cite data, use only well-known, verifiable facts or omit the claim entirely.
- Do NOT fabricate tool names, product names, company names, or URLs.
- If you are unsure about a specific fact, write around it with general, accurate statements instead of guessing.

WRITING RULES:
- Write the full blog post, not an outline
- ALWAYS start with an introduction paragraph (100-150 words) BEFORE the first ## heading — hook the reader, state the problem, mention the primary keyword naturally
- Use the provided H2 outline as section headings (improve the wording if needed)
- Include the primary keyword naturally in: the title, the introduction, and at least 2 H2 headings
- Use secondary keywords naturally throughout — never force them
- Each H2 section must have substantial content (~{words_per_section} words)
- End with a ## Conclusion section followed by a strong CTA paragraph relevant to the business
- Write in {data.tone} tone
- Use markdown formatting: ## for H2 headings, **bold** for key terms, bullet lists where appropriate
- Do NOT add H1 — the title field covers that
- STRUCTURE: Introduction → ## Section 1 → ## Section 2 → ... → ## Conclusion

Return ONLY a JSON object (no markdown fences):
{{
  "title": "SEO-optimised blog title (include primary keyword, max 70 chars)",
  "content": "Full blog post in markdown (H2s, paragraphs, lists)",
  "meta_title": "Meta title tag (50-60 chars, include primary keyword)",
  "meta_description": "Meta description (140-155 chars, include primary keyword, compelling CTA)",
  "schema_type": "Article"
}}"""

    return prompt


def _build_article_schema(
    *,
    title: str,
    meta_description: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    business_context: BusinessContext | None,
    author_fallback: str,
) -> dict:
    """Construct the Schema.org Article JSON for the blog."""
    now_iso = datetime.now(timezone.utc).isoformat()
    author_name = (
        business_context.business_name
        if business_context and business_context.business_name
        else author_fallback
    )
    schema_markup: dict = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title[:110],
        "description": meta_description,
        "keywords": ", ".join(k for k in ([primary_keyword] + secondary_keywords[:5]) if k),
        "datePublished": now_iso,
        "dateModified": now_iso,
        "author": {
            "@type": "Person" if not (business_context and business_context.business_name) else "Organization",
            "name": author_name,
        },
        "image": None,
        "mainEntityOfPage": {"@type": "WebPage", "@id": ""},
        "articleSection": business_context.niche if business_context and business_context.niche else None,
    }
    return {k: v for k, v in schema_markup.items() if v is not None}


def _generate_blog_in_background(
    save_id: str,
    user_id: str,
    request_dict: dict,
    author_fallback: str,
) -> None:
    """Run LLM blog generation off the request thread.

    Updates the ``SeoSave`` row's ``data`` JSON with the final blog content
    when complete, or with ``status="failed"`` + ``error`` on hard failure.
    The HTTP request returns the placeholder ``save_id`` immediately, and the
    frontend polls /api/blog/saves/{save_id} to pick up the result.
    """
    db = SessionLocal()
    try:
        # Reconstruct the typed request from the dict snapshot. Pydantic's
        # model_validate walks nested models for us.
        try:
            data = BlogGenerateRequest.model_validate(request_dict)
        except Exception as e:
            logger.error(f"[BLOG-BG] could not rehydrate request for save {save_id}: {e}")
            _mark_blog_failed(db, save_id, "Internal validation error.")
            return

        t0 = time.time()
        try:
            prompt = _build_blog_prompt(data)
            raw = _llm_call(prompt, max_retries=3)
        except Exception as e:
            logger.error(f"[BLOG-BG] LLM call failed for save {save_id}: {e}", exc_info=True)
            _mark_blog_failed(db, save_id, "AI generation failed. Please try again.")
            return

        if not raw:
            _mark_blog_failed(db, save_id, "AI generation returned no content.")
            return

        parsed = _parse_blog_response(raw, data.topic)
        if not parsed:
            _mark_blog_failed(db, save_id, "Failed to parse AI response.")
            return

        content: str = parsed.get("content", "")
        title: str = parsed.get("title", data.topic)
        meta_title: str = parsed.get("meta_title", title[:60])
        meta_description: str = parsed.get("meta_description", "")
        word_count = len(content.split())

        schema_markup = _build_article_schema(
            title=title,
            meta_description=meta_description,
            primary_keyword=data.primary_keyword or data.topic,
            secondary_keywords=data.secondary_keywords,
            business_context=data.business_context,
            author_fallback=author_fallback,
        )

        payload = {
            "title": title,
            "content": content,
            "word_count": word_count,
            "primary_keyword": data.primary_keyword or data.topic,
            "meta_title": meta_title,
            "meta_description": meta_description,
            "schema_markup": schema_markup,
            "topic": data.topic,
            "secondary_keywords": data.secondary_keywords,
            "tone": data.tone,
            # status absent ⇒ ready. We deliberately don't write status="ready"
            # so existing readers that ignore the field continue to work.
        }

        save = (
            db.query(SeoSave)
            .filter(SeoSave.id == save_id, SeoSave.user_id == user_id)
            .first()
        )
        if not save:
            logger.warning(f"[BLOG-BG] save row {save_id} disappeared mid-task")
            return

        save.title = title
        save.data = json.dumps(payload)
        try:
            db.commit()
            logger.info(
                "[BLOG-BG] save=%s ready in %.1fs — %d words, title=%r",
                save_id, time.time() - t0, word_count, title[:50],
            )
        except Exception as e:
            db.rollback()
            logger.error(f"[BLOG-BG] persist failed for save {save_id}: {e}", exc_info=True)
            return  # don't charge if persist failed

        # Deduct credits ONLY after successful persist so a failed render
        # doesn't bill the user. Re-fetch wallet inside this DB session.
        try:
            wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
            if wallet:
                charge_credits(
                    db,
                    wallet,
                    action="blog_generate",
                    cost=COST_BLOG_GENERATE,
                    description=f"Blog: {title[:80]} ({word_count} words)",
                )
        except Exception as e:
            logger.error(f"[BLOG-BG] credit deduct failed for save {save_id}: {e}")
    finally:
        db.close()


def _mark_blog_failed(db: Session, save_id: str, message: str) -> None:
    """Patch a generating blog save row with status=failed + error message."""
    save = db.query(SeoSave).filter(SeoSave.id == save_id).first()
    if not save:
        return
    try:
        existing = json.loads(save.data or "{}")
    except (TypeError, json.JSONDecodeError):
        existing = {}
    existing["status"] = "failed"
    existing["error"] = message
    save.data = json.dumps(existing)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"[BLOG-BG] couldn't mark save {save_id} as failed: {e}")


@router.post("/generate", response_model=BlogGenerateResponse)
def generate_blog(
    data: BlogGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kick off blog generation. Returns a placeholder ``BlogGenerateResponse``
    with ``status="generating"`` and the ``save_id`` to poll. The actual LLM
    call runs in a background task to avoid tunnel / proxy idle timeouts on
    the 30-120s blog rendering.
    """
    if not data.topic.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Topic is required.")

    # Pre-flight credit check. Deducted after the BG pipeline succeeds so
    # failed blog renders don't charge the user.
    require_credits(db, current_user.id, COST_BLOG_GENERATE)
    db.commit()  # release read snapshot before kicking off the BG task

    logger.info(
        "[BLOG] Kickoff for topic=%r keyword=%r words=%d",
        data.topic, data.primary_keyword, data.word_count,
    )

    placeholder_title = (data.topic or "Untitled blog").strip()[:160]
    placeholder = {
        "title": placeholder_title,
        "content": "",
        "word_count": 0,
        "primary_keyword": data.primary_keyword or data.topic,
        "meta_title": placeholder_title[:60],
        "meta_description": "",
        "schema_markup": {},
        "topic": data.topic,
        "secondary_keywords": data.secondary_keywords,
        "tone": data.tone,
        "status": "generating",
    }

    save_id_out: str | None = None
    try:
        existing = None
        if data.save_id:
            existing = (
                db.query(SeoSave)
                .filter(
                    SeoSave.id == data.save_id,
                    SeoSave.user_id == current_user.id,
                    SeoSave.type == "blog",
                )
                .first()
            )
        if existing:
            existing.title = placeholder_title
            existing.data = json.dumps(placeholder)
            db.commit()
            save_id_out = existing.id
        else:
            save = SeoSave(
                user_id=current_user.id,
                type="blog",
                title=placeholder_title,
                data=json.dumps(placeholder),
            )
            db.add(save)
            db.commit()
            db.refresh(save)
            save_id_out = save.id
    except Exception as exc:
        logger.warning("[BLOG] kickoff save failed: %s", exc)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start blog generation. Please try again.",
        )

    author_fallback = current_user.name or current_user.email or "Author"

    background_tasks.add_task(
        _generate_blog_in_background,
        save_id=save_id_out,
        user_id=current_user.id,
        request_dict=data.model_dump(),
        author_fallback=author_fallback,
    )

    return BlogGenerateResponse(
        title=placeholder_title,
        content="",
        word_count=0,
        primary_keyword=data.primary_keyword or data.topic,
        meta_title=placeholder_title[:60],
        meta_description="",
        schema_markup={},
        save_id=save_id_out,
        status="generating",
    )


# ---------------------------------------------------------------------------
# Blog Saves — CRUD (reuses seo_saves table with type="blog")
# ---------------------------------------------------------------------------

class BlogSaveItem(BaseModel):
    id: str
    type: str
    title: str
    data: dict
    created_at: str
    updated_at: str


@router.get("/saves", response_model=list[BlogSaveItem])
def list_blog_saves(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saves = (
        db.query(SeoSave)
        .filter(SeoSave.user_id == current_user.id, SeoSave.type == "blog")
        .order_by(SeoSave.created_at.desc())
        .all()
    )
    return [
        BlogSaveItem(
            id=s.id,
            type=s.type,
            title=s.title,
            data=json.loads(s.data),
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        )
        for s in saves
    ]


@router.get("/saves/{save_id}", response_model=BlogSaveItem)
def get_blog_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = db.query(SeoSave).filter(
        SeoSave.id == save_id,
        SeoSave.user_id == current_user.id,
        SeoSave.type == "blog",
    ).first()
    if not save:
        raise HTTPException(status_code=404, detail="Blog save not found.")
    return BlogSaveItem(
        id=save.id,
        type=save.type,
        title=save.title,
        data=json.loads(save.data),
        created_at=save.created_at.isoformat(),
        updated_at=save.updated_at.isoformat(),
    )


@router.delete("/saves/{save_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_blog_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = db.query(SeoSave).filter(
        SeoSave.id == save_id,
        SeoSave.user_id == current_user.id,
        SeoSave.type == "blog",
    ).first()
    if not save:
        raise HTTPException(status_code=404, detail="Blog save not found.")
    db.delete(save)
    db.commit()

# ---------------------------------------------------------------------------
# Blog Publishing — push a saved blog draft to a connected platform
# ---------------------------------------------------------------------------
class BlogPublishRequest(BaseModel):
    """Optional overrides for the publish payload. If omitted, we use the
    title/content/tags already saved in the blog draft."""

    title: str | None = None
    tags: list[str] | None = None
    canonical_url: str | None = None  # mark dev.to as a republish
    publish: bool = True  # False = save as draft on the platform


class BlogPublishResponse(BaseModel):
    platform: str
    external_post_id: str
    url: str
    save_id: str


@router.post("/saves/{save_id}/publish/devto", response_model=BlogPublishResponse)
async def publish_blog_to_devto(
    save_id: str,
    payload: BlogPublishRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Publish a saved blog draft to the user's Dev.to account.

    Persists the returned article id + URL inside the save's `data` JSON under
    a `published` key so the analytics dashboard can later fetch metrics:

        data["published"] = {
            "devto": {"id": "...", "url": "...", "published_at": "..."}
        }
    """
    from app.models.social_account import SocialAccount
    from app.services.blog_publish import publish_to_devto

    save = (
        db.query(SeoSave)
        .filter(
            SeoSave.id == save_id,
            SeoSave.user_id == current_user.id,
            SeoSave.type == "blog",
        )
        .first()
    )
    if not save:
        raise HTTPException(status_code=404, detail="Blog save not found.")

    account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "devto",
        )
        .first()
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Connect Dev.to in Settings before publishing.",
        )

    try:
        blog_data: dict = json.loads(save.data or "{}")
    except json.JSONDecodeError:
        blog_data = {}

    title = (payload.title if payload else None) or blog_data.get("title") or save.title
    markdown = blog_data.get("content") or ""
    tags = (payload.tags if payload else None) or blog_data.get("tags") or []

    if not markdown.strip():
        raise HTTPException(
            status_code=400,
            detail="This blog has no content to publish — generate or paste content first.",
        )

    try:
        result = await publish_to_devto(
            account=account,
            title=title,
            markdown=markdown,
            tags=tags,
            canonical_url=(payload.canonical_url if payload else None),
            publish=(payload.publish if payload else True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("[blog publish] dev.to failed")
        raise HTTPException(status_code=502, detail=f"Dev.to API error: {exc}")

    # Stash publish metadata back into the save's JSON so analytics can fetch
    # metrics later. Keyed by platform so future providers (LinkedIn articles,
    # Hashnode, etc.) can coexist.
    blog_data.setdefault("published", {})[result.platform] = {
        "id": result.external_post_id,
        "url": result.url,
        "published_at": datetime.now(timezone.utc).isoformat(),
        **result.raw,
    }
    save.data = json.dumps(blog_data, ensure_ascii=False)
    db.commit()

    return BlogPublishResponse(
        platform=result.platform,
        external_post_id=result.external_post_id,
        url=result.url,
        save_id=save.id,
    )