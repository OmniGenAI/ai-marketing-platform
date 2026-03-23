"""
Image processing utilities for social media posting.
Handles automatic resizing/cropping to meet platform requirements.
"""
import io
import httpx
from PIL import Image
from typing import Tuple, Optional


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
    Download and resize/crop an image to meet Instagram requirements.

    Instagram requirements:
    - Aspect ratio: 0.8:1 to 1.91:1
    - Recommended width: 1080px
    - Format: JPEG or PNG

    Args:
        image_url: Public URL of the image to process
        max_size: Maximum width/height (default 1080px)

    Returns:
        bytes: JPEG image data ready for upload

    Raises:
        httpx.RequestError: If image download fails
        PIL.UnidentifiedImageError: If image format is invalid
    """
    # Download the image
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(image_url)
        response.raise_for_status()
        image_data = response.content

    # Open image with PIL
    img = Image.open(io.BytesIO(image_data))

    # Convert to RGB if necessary (handles RGBA, P, etc.)
    if img.mode != 'RGB':
        img = img.convert('RGB')

    width, height = img.size
    current_ratio = width / height

    print(f"📐 Original image: {width}x{height} (ratio: {current_ratio:.2f}:1)")

    # Check if resize/crop is needed
    if 0.8 <= current_ratio <= 1.91:
        # Already compatible, just resize if too large
        if width > max_size or height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            print(f"✂️  Resized to: {img.size[0]}x{img.size[1]}")
    else:
        # Need to crop to fit Instagram's aspect ratio
        target_ratio, format_name = get_instagram_compatible_aspect_ratio(width, height)

        # Calculate new dimensions
        if current_ratio < 0.8:
            # Too tall, crop height
            new_height = int(width / target_ratio)
            new_width = width
        else:
            # Too wide, crop width
            new_width = int(height * target_ratio)
            new_height = height

        # Center crop
        left = (width - new_width) // 2
        top = (height - new_height) // 2
        right = left + new_width
        bottom = top + new_height

        img = img.crop((left, top, right, bottom))
        print(f"✂️  Cropped to {format_name}: {img.size[0]}x{img.size[1]} (ratio: {target_ratio}:1)")

        # Resize if still too large
        if img.size[0] > max_size or img.size[1] > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            print(f"📏 Final size: {img.size[0]}x{img.size[1]}")

    # Convert to JPEG bytes
    output = io.BytesIO()
    img.save(output, format='JPEG', quality=95, optimize=True)
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
