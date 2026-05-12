from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
import json
import logging

from app.database import SessionLocal, get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.models.business_image import BusinessImage
from app.models.wallet import Wallet, UsageLog
from app.models.seo_save import SeoSave
from app.models.post import Post
from app.schemas.post import GenerateRequest, GenerateResponse
from app.dependencies import get_current_user
from app.services.ai import generate_social_post, generate_image_from_prompt
from app.services.credits import COST_SOCIAL_POST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate", tags=["generate"])

UNLIMITED_BALANCE = -1


def _generate_image_in_background(
    post_id: str,
    user_id: str,
    topic: str,
    business_name: str,
    niche: str,
    primary_color: str | None,
    secondary_color: str | None,
    logo_url: str | None,
    aspect_ratio: str | None,
    overlay_text: str | None,
) -> None:
    """Run AI image generation off the request thread.

    The HTTP request returns to the client as soon as the text is ready, which
    keeps total request time well under tunnel / proxy idle timeouts (ngrok
    free tier kills connections held >~30s). When the image is ready we patch
    the Post row in a fresh DB session so the frontend can pick it up by
    polling /api/posts/{post_id}.
    """
    db = SessionLocal()
    try:
        try:
            image_url = generate_image_from_prompt(
                topic=topic,
                business_name=business_name,
                niche=niche,
                primary_color=primary_color,
                secondary_color=secondary_color,
                logo_url=logo_url,
                aspect_ratio=aspect_ratio,
                overlay_text=overlay_text,
                user_id=user_id,
            )
        except Exception as e:
            logger.error(
                f"[IMAGE-BG] AI image generation failed for post {post_id}: {e}",
                exc_info=True,
            )
            image_url = None

        post = db.query(Post).filter(Post.id == post_id).first()
        if not post:
            logger.warning(f"[IMAGE-BG] Post {post_id} not found when writing image")
            return

        post.image_url = image_url
        try:
            db.commit()
            logger.info(
                f"[IMAGE-BG] post={post_id} image_url={'set' if image_url else 'failed'}"
            )
        except Exception as e:
            db.rollback()
            logger.error(
                f"[IMAGE-BG] Failed to persist image_url for post {post_id}: {e}",
                exc_info=True,
            )
    finally:
        db.close()


@router.post("", response_model=GenerateResponse)
async def generate_post(
    data: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Pre-flight credit check (no row lock — generation can take 30-60s talking
    # to OpenAI / Supabase Storage and we must NOT hold a Postgres transaction
    # open across that wait, or the connection gets killed as "idle in
    # transaction" and the later db.commit() fails with a 500). The actual
    # decrement re-reads + locks the row after generation completes.
    wallet = (
        db.query(Wallet)
        .filter(Wallet.user_id == current_user.id)
        .first()
    )

    has_unlimited_credits = wallet and wallet.balance == UNLIMITED_BALANCE
    has_credits = wallet and wallet.balance > 0

    if not wallet or (not has_unlimited_credits and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please upgrade your plan.",
        )

    # Release any read snapshot before the long-running external calls below.
    db.commit()

    # Get business config
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please configure your business profile first.",
        )

    # Check if website context is available and valid
    website_context_used = False
    if config.website_context:
        try:
            json.loads(config.website_context)  # Validate it's proper JSON
            website_context_used = True
            logger.info(f"Website context validated for user {current_user.id}")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Invalid website context for user {current_user.id}: {str(e)}")
    else:
        logger.info(f"No website context for user {current_user.id} - post will be generated without website data")

    # SEO mode: resolve primary + top-5 secondary keywords from a saved brief
    primary_keyword = ""
    seo_keywords: list[str] = []
    if data.seo_mode:
        brief_row = None
        if data.seo_save_id:
            brief_row = (
                db.query(SeoSave)
                .filter(
                    SeoSave.id == data.seo_save_id,
                    SeoSave.user_id == current_user.id,
                    SeoSave.type == "brief",
                )
                .first()
            )
        else:
            brief_row = (
                db.query(SeoSave)
                .filter(
                    SeoSave.user_id == current_user.id,
                    SeoSave.type == "brief",
                )
                .order_by(SeoSave.updated_at.desc())
                .first()
            )
        if brief_row:
            try:
                payload = json.loads(brief_row.data or "{}")
                primary_keyword = str(payload.get("primary_keyword", "") or "").strip()
                raw_secondary = payload.get("secondary_keywords", []) or []
                seo_keywords = [str(k).strip() for k in raw_secondary if str(k).strip()][:5]
                logger.info(
                    f"SEO mode: using brief {brief_row.id} — primary='{primary_keyword}', "
                    f"secondary={len(seo_keywords)} keywords"
                )
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"Failed to parse brief {brief_row.id} for SEO mode: {e}")
        else:
            logger.info(f"SEO mode requested but no brief found for user {current_user.id}")

    # Generate post using AI with website context (offloaded to threadpool — sync I/O)
    try:
        result = await run_in_threadpool(
            generate_social_post,
            business_name=config.business_name,
            niche=config.niche,
            tone=data.tone,
            tones=data.tones,
            variations=data.variations,
            products=config.products,
            brand_voice=config.brand_voice,
            target_audience=config.target_audience,
            hashtags=config.hashtags,
            platform=data.platform,
            topic=data.topic,
            website_context=config.website_context,
            seo_keywords=seo_keywords,
            primary_keyword=primary_keyword,
            blog_url=(data.blog_url or "").strip(),
        )
    except Exception as e:
        logger.error(f"AI post generation failed for user {current_user.id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate post. Please try again.",
        )

    # Handle image option — image failures degrade gracefully (post still returns)
    image_url = None
    image_generation_failed = False
    image_pending = False
    # Brand-kit context for AI images is resolved here so we can pass it to
    # the background task without hitting the DB again from that thread.
    primary_color: str | None = None
    secondary_color: str | None = None
    brand_logo_url: str | None = None

    if data.image_option == "business" and data.business_image_id:
        business_image = (
            db.query(BusinessImage)
            .filter(
                BusinessImage.id == data.business_image_id,
                BusinessImage.user_id == current_user.id,
            )
            .first()
        )
        if business_image:
            image_url = business_image.url

    elif data.image_option == "ai":
        # Pull brand colors + logo from saved Brand Kit website_context, if any
        if config.website_context:
            try:
                ctx = json.loads(config.website_context)
                primary_color = ctx.get("primary_color") or None
                secondary_color = ctx.get("secondary_color") or None
                brand_logo_url = ctx.get("logo_url") or ctx.get("favicon_url") or None
            except (json.JSONDecodeError, TypeError):
                pass

        logger.info(
            f"[IMAGE] user={current_user.id} primary={primary_color} "
            f"secondary={secondary_color} logo={'yes' if brand_logo_url else 'no'} "
            f"logo_url={brand_logo_url[:80] if brand_logo_url else None} "
            f"(deferred to background)"
        )
        # Image generation is dispatched as a background task AFTER the draft
        # post row is created below, so the request can return immediately.
        # This avoids ngrok / load-balancer idle timeouts that would otherwise
        # 500 the request during the 30-60s OpenAI image call.
        image_pending = True

    elif data.image_option == "upload" and data.uploaded_image_url:
        image_url = data.uploaded_image_url

    # Deduct credit + log usage atomically with rollback safety. Re-acquire
    # the wallet with a row lock now (after the long external calls have
    # completed) so we don't hold the lock across OpenAI / storage I/O.
    try:
        wallet = (
            db.query(Wallet)
            .filter(Wallet.user_id == current_user.id)
            .with_for_update()
            .first()
        )
        if not wallet:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Wallet not found while recording usage.",
            )

        if wallet.balance != UNLIMITED_BALANCE:
            wallet.balance -= COST_SOCIAL_POST
        wallet.total_credits_used += COST_SOCIAL_POST

        usage_log = UsageLog(
            wallet_id=wallet.id,
            action="generate_post",
            credits_used=COST_SOCIAL_POST,
            description=f"Generated {data.platform} post",
        )
        db.add(usage_log)
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to commit credit deduction for user {current_user.id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record usage. Please try again.",
        )

    seo_keywords_used = [k for k in [primary_keyword, *seo_keywords] if k]

    # Auto-save the generated post as a draft so it appears in the hub.
    post_id: str | None = None
    try:
        post = Post(
            user_id=current_user.id,
            content=result["content"],
            hashtags=result["hashtags"],
            image_url=image_url,
            image_option=data.image_option,
            platform=data.platform,
            tone=data.tone,
            status="draft",
        )
        db.add(post)
        db.commit()
        db.refresh(post)
        post_id = post.id
    except Exception as e:
        db.rollback()
        logger.error(
            f"Failed to auto-save generated post for user {current_user.id}: {e}",
            exc_info=True,
        )

    # Kick off AI image generation in the background once the draft post row
    # exists. The task patches Post.image_url when it finishes, and the
    # frontend polls /api/posts/{post_id} to pick up the result.
    if image_pending and post_id:
        background_tasks.add_task(
            _generate_image_in_background,
            post_id=post_id,
            user_id=current_user.id,
            topic=data.topic,
            business_name=config.business_name,
            niche=config.niche,
            primary_color=primary_color,
            secondary_color=secondary_color,
            logo_url=brand_logo_url,
            aspect_ratio=data.aspect_ratio,
            overlay_text=data.image_text,
        )
    elif image_pending and not post_id:
        # Couldn't save the draft, so we have nowhere to attach the image —
        # surface a soft failure to the client instead of silently dropping.
        image_pending = False
        image_generation_failed = True

    return GenerateResponse(
        content=result["content"],
        hashtags=result["hashtags"],
        image_url=image_url,
        website_context_used=website_context_used,
        seo_keywords_used=seo_keywords_used,
        primary_keyword=primary_keyword or None,
        image_generation_failed=image_generation_failed,
        image_pending=image_pending,
        post_id=post_id,
        variations=result.get("variations", []),
    )
