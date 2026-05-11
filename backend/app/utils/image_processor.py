"""
Image processing utilities for social media posting.
Handles automatic resizing/cropping to meet platform requirements.
"""
import base64
import io
import logging
import uuid

import httpx
from PIL import Image
from typing import Tuple, Optional

from app.config import settings

logger = logging.getLogger(__name__)


def upload_bytes_to_supabase(
    image_bytes: bytes,
    user_id: str,
    *,
    extension: str = "png",
    content_type: str = "image/png",
    bucket: str = "post-images",
    subfolder: str = "ai-generated",
) -> str | None:
    """Synchronously upload raw image bytes to Supabase Storage.

    Returns the public URL on success, or None if Supabase isn't configured /
    upload fails. Designed to be called from sync code paths (e.g. inside a
    threadpool task) so we can avoid awaiting the async upload helper.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        logger.info("Supabase storage not configured — cannot upload generated image")
        return None

    file_path = f"{user_id}/{subfolder}/{uuid.uuid4()}.{extension}"
    upload_url = (
        f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{file_path}"
    )
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(upload_url, headers=headers, content=image_bytes)
            if resp.status_code not in (200, 201):
                logger.warning(
                    "Supabase upload failed (%s): %s",
                    resp.status_code, resp.text[:200],
                )
                return None
        return (
            f"{settings.SUPABASE_URL}/storage/v1/object/public/"
            f"{bucket}/{file_path}"
        )
    except Exception as e:
        logger.warning("Supabase upload exception: %s", e)
        return None


def get_instagram_compatible_aspect_ratio(width: int, height: int) -> Tuple[float, str]:
    """
    Determine the best Instagram-compatible aspect ratio for an image.

    Instagram requirements:
    - Minimum: 0.8:1 (4:5 portrait)
    - Maximum: 1.91:1 (landscape)

    Args:
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        Tuple of (aspect_ratio, format_name)
    """
    current_ratio = width / height

    # If already compatible, return current
    if 0.8 <= current_ratio <= 1.91:
        if abs(current_ratio - 1.0) < 0.1:
            return (1.0, "square")
        elif current_ratio < 1.0:
            return (0.8, "portrait")
        else:
            return (1.91, "landscape")

    # Too tall (portrait), crop to 4:5
    if current_ratio < 0.8:
        return (0.8, "portrait")

    # Too wide (landscape), crop to 1.91:1
    return (1.91, "landscape")


async def resize_for_instagram(image_url: str, max_size: int = 1080) -> bytes:
    """
    Download an image and prepare it for Instagram while preserving the
    original dimensions. Padding (white letterbox/pillarbox) is added only
    when the aspect ratio falls outside Instagram's supported window
    (0.8:1 to 1.91:1) — the original pixels are never cropped.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(image_url)
        response.raise_for_status()
        image_data = response.content

    return resize_for_instagram_bytes(image_data=image_data, max_size=max_size)


def resize_for_instagram_bytes(
    image_data: bytes,
    max_size: int = 1080,  # kept for backward compatibility; ignored when preserving originals
    *,
    preserve_original: bool = True,
    pad_color: Tuple[int, int, int] = (255, 255, 255),
) -> bytes:
    """
    Prepare image bytes for Instagram while preserving the original image fully.

    Strategy (preserve_original=True, default):
    - Never crop. Keep every pixel of the original.
    - If the aspect ratio is already inside Instagram's 0.8:1 – 1.91:1 window,
      return the original unchanged (re-encoded as JPEG).
    - If outside the window, **letterbox/pillarbox-pad** with `pad_color`
      (default white) to the nearest supported aspect ratio (4:5 portrait or
      1.91:1 landscape). The full original image is centred on the new canvas
      so nothing is lost.
    - Cap the longest side at Instagram's hard upper limit (1440 px wide for
      feed images per Meta's published spec) only if it exceeds that limit.

    Args:
        image_data: Raw image bytes
        max_size: Legacy resize cap. Ignored when preserve_original is True.
        preserve_original: When True (default), no cropping or downscaling
            below Meta's hard limits.
        pad_color: RGB tuple used to pad letterbox/pillarbox bars.

    Returns:
        bytes: JPEG image data ready for upload
    """
    img = Image.open(io.BytesIO(image_data))

    if img.mode != "RGB":
        img = img.convert("RGB")

    width, height = img.size
    current_ratio = width / height
    print(f"📐 Original image: {width}x{height} (ratio: {current_ratio:.2f}:1)")

    if not preserve_original:
        # Legacy behaviour: crop to fit, downscale to max_size
        if not (0.8 <= current_ratio <= 1.91):
            target_ratio, format_name = get_instagram_compatible_aspect_ratio(width, height)
            if current_ratio < 0.8:
                new_height = int(width / target_ratio)
                new_width = width
            else:
                new_width = int(height * target_ratio)
                new_height = height
            left = (width - new_width) // 2
            top = (height - new_height) // 2
            img = img.crop((left, top, left + new_width, top + new_height))
            print(f"✂️  Cropped to {format_name}: {img.size[0]}x{img.size[1]}")

        if img.size[0] > max_size or img.size[1] > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            print(f"📏 Final size: {img.size[0]}x{img.size[1]}")
    else:
        # Preserve every pixel of the original.
        # 1. Pad with `pad_color` only if outside Instagram's aspect window.
        if 0.8 <= current_ratio <= 1.91:
            print("✅ Original aspect ratio is Instagram-compatible — no padding needed.")
        else:
            if current_ratio < 0.8:
                # Too tall → pillarbox: widen canvas to ratio 0.8 (4:5 portrait)
                target_ratio = 0.8
                new_width = int(round(height * target_ratio))
                new_height = height
                paste_x = (new_width - width) // 2
                paste_y = 0
                fmt = "portrait (pillarboxed)"
            else:
                # Too wide → letterbox: tall canvas to ratio 1.91:1
                target_ratio = 1.91
                new_width = width
                new_height = int(round(width / target_ratio))
                paste_x = 0
                paste_y = (new_height - height) // 2
                fmt = "landscape (letterboxed)"

            canvas = Image.new("RGB", (new_width, new_height), pad_color)
            canvas.paste(img, (paste_x, paste_y))
            img = canvas
            print(
                f"🖼️  Padded to {fmt}: {img.size[0]}x{img.size[1]} "
                f"(ratio: {target_ratio}:1, original preserved)"
            )

        # 2. Only downscale if exceeding Meta's hard upper limit.
        #    Feed image max recommended is 1440px on the long side; the API
        #    itself rejects images > 8192px. Cap at 1440 to be safe.
        IG_MAX_LONG_SIDE = 1440
        long_side = max(img.size)
        if long_side > IG_MAX_LONG_SIDE:
            img.thumbnail((IG_MAX_LONG_SIDE, IG_MAX_LONG_SIDE), Image.Resampling.LANCZOS)
            print(f"📏 Downscaled to Meta cap: {img.size[0]}x{img.size[1]}")

    output = io.BytesIO()
    img.save(output, format="JPEG", quality=95, optimize=True)
    output.seek(0)
    return output.read()


async def upload_processed_image(
    image_bytes: bytes,
    user_id: str,
    filename: str,
    supabase_url: str,
    service_key: str
) -> str:
    """
    Upload processed image to Supabase Storage.

    Args:
        image_bytes: Image data
        user_id: User ID for folder organization
        filename: Original filename
        supabase_url: Supabase project URL
        service_key: Supabase service role key

    Returns:
        str: Public URL of uploaded image
    """
    bucket_name = "post-images"

    # Add prefix to indicate it's a processed/resized image
    file_path = f"{user_id}/instagram/{filename}"

    upload_url = f"{supabase_url}/storage/v1/object/{bucket_name}/{file_path}"

    headers = {
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "image/jpeg",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            upload_url,
            headers=headers,
            content=image_bytes,
        )

        if response.status_code not in [200, 201]:
            error_detail = response.text
            print(f"❌ Failed to upload processed image: {error_detail}")
            response.raise_for_status()

    public_url = f"{supabase_url}/storage/v1/object/public/{bucket_name}/{file_path}"
    print(f"✅ Uploaded processed image: {public_url}")

    return public_url

def composite_logo_on_image(
    image_bytes: bytes,
    logo_url: str,
    position: str = "bottom-right",
    logo_scale: float = 0.15,
    padding_ratio: float = 0.04,
) -> bytes:
    """
    Overlay a brand logo onto a generated marketing image.

    Args:
        image_bytes: Source image bytes (the AI-generated marketing photo).
        logo_url: HTTP(S) URL or data URI of the brand logo.
        position: "bottom-right" | "bottom-left" | "top-right" | "top-left".
        logo_scale: Logo width as fraction of image width (default 15%).
        padding_ratio: Edge padding as fraction of image width (default 4%).

    Returns:
        bytes: PNG-encoded composite image. Falls back to the original on failure.
    """
    try:
        base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")

        # Load logo from data URI or HTTP(S)
        if logo_url.startswith("data:"):
            _, b64 = logo_url.split(",", 1)
            logo_data = base64.b64decode(b64)
        else:
            with httpx.Client(timeout=15.0, follow_redirects=True, verify=False) as c:
                resp = c.get(logo_url)
                resp.raise_for_status()
                logo_data = resp.content

        logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")

        # Resize logo preserving aspect ratio
        target_w = max(1, int(base.width * logo_scale))
        ratio = target_w / logo.width
        target_h = max(1, int(logo.height * ratio))
        logo = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)

        pad = int(base.width * padding_ratio)
        if position == "bottom-right":
            x, y = base.width - target_w - pad, base.height - target_h - pad
        elif position == "bottom-left":
            x, y = pad, base.height - target_h - pad
        elif position == "top-right":
            x, y = base.width - target_w - pad, pad
        else:
            x, y = pad, pad

        base.alpha_composite(logo, dest=(x, y))

        out = io.BytesIO()
        base.convert("RGB").save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning(f"Logo composite failed, returning original image: {e}")
        return image_bytes