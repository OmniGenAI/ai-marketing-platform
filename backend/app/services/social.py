"""
Social media integration service.
Facebook and Instagram Graph API integrations for publishing posts.
"""
import httpx
import uuid
import asyncio
from typing import Optional
from app.utils.image_processor import resize_for_instagram, upload_processed_image
from app.config import settings


async def publish_to_facebook(
    page_id: str,
    access_token: str,
    content: str,
    link: Optional[str] = None,
    image_url: Optional[str] = None
) -> dict:
    """
    Publish a post to Facebook page (text, text+image, or text+link).

    Args:
        page_id: Facebook page ID
        access_token: Page access token
        content: Post message/content
        link: Optional link to attach to the post
        image_url: Optional image URL to post

    Returns:
        dict with 'id' of the published post

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # If we have an image, use the photos endpoint
        if image_url:
            print(f"🖼️  Posting image to Facebook: {image_url}")

            # First, verify the image URL is accessible
            try:
                test_response = await client.head(image_url, timeout=10.0)
                if test_response.status_code != 200:
                    print(f"⚠️  Warning: Image URL returned status {test_response.status_code}")
            except Exception as e:
                print(f"⚠️  Warning: Could not verify image URL: {str(e)}")

            url = f"https://graph.facebook.com/v18.0/{page_id}/photos"
            payload = {
                "url": image_url,
                "caption": content,
                "access_token": access_token,
                "published": "true"  # Ensure photo is published immediately
            }
        else:
            # Text-only or text+link post
            url = f"https://graph.facebook.com/v18.0/{page_id}/feed"
            payload = {
                "message": content,
                "access_token": access_token
            }
            if link:
                payload["link"] = link

        print(f"📤 Posting to Facebook: {url}")
        response = await client.post(url, data=payload)

        # Log error details if request failed
        if response.status_code not in [200, 201]:
            error_detail = response.text
            print(f"❌ Facebook API Error ({response.status_code}): {error_detail}")

            # Try to parse error details
            try:
                error_json = response.json()
                error_msg = error_json.get("error", {}).get("message", "Unknown error")
                error_code = error_json.get("error", {}).get("code", "N/A")
                print(f"❌ Error Code: {error_code}, Message: {error_msg}")

                # If image URL error, suggest using feed endpoint instead
                if "url" in error_msg.lower() or "image" in error_msg.lower():
                    print("💡 Tip: Image URL might not be publicly accessible. Try using 'published=false' or upload directly.")
            except:
                pass

        response.raise_for_status()
        result = response.json()

    print(f"✅ Published to Facebook: Post ID {result.get('id')}")
    return result


async def publish_to_instagram(
    instagram_account_id: str,
    access_token: str,
    image_url: str,
    caption: str,
    user_id: str
) -> dict:
    """
    Publish an image post to Instagram.
    Instagram requires images - text-only posts are not supported.
    Automatically resizes/crops images to meet Instagram's aspect ratio requirements.

    Args:
        instagram_account_id: Instagram Business Account ID (not page ID)
        access_token: Page access token
        image_url: Public URL of the image to post
        caption: Post caption (content + hashtags)
        user_id: User ID for organizing processed images

    Returns:
        dict with 'id' of the published media

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    # Process image to ensure it meets Instagram's requirements
    print(f"🖼️  Processing image for Instagram compatibility...")
    try:
        # Resize/crop image to Instagram's aspect ratio requirements
        processed_image_bytes = await resize_for_instagram(image_url)

        # Upload processed image to Supabase
        filename = f"instagram_{uuid.uuid4()}.jpeg"
        processed_image_url = await upload_processed_image(
            image_bytes=processed_image_bytes,
            user_id=user_id,
            filename=filename,
            supabase_url=settings.SUPABASE_URL,
            service_key=settings.SUPABASE_SERVICE_ROLE_KEY
        )

        # Use the processed image URL
        final_image_url = processed_image_url
        print(f"✅ Using processed image: {final_image_url}")

    except Exception as e:
        print(f"⚠️  Image processing failed, using original: {str(e)}")
        # Fallback to original image if processing fails
        final_image_url = image_url

    # Step 1: Create media container
    container_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media"
    container_payload = {
        "image_url": final_image_url,
        "caption": caption,
        "access_token": access_token
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Retry logic for transient errors
        max_retries = 3
        retry_delay = 5  # seconds

        for attempt in range(max_retries):
            try:
                # Create the media container
                container_response = await client.post(container_url, data=container_payload)

                # Check for transient errors
                if container_response.status_code in [500, 503]:
                    error_detail = container_response.text
                    print(f"❌ Instagram API Error (attempt {attempt + 1}/{max_retries}): {error_detail}")

                    # Check if error is transient
                    try:
                        error_json = container_response.json()
                        if error_json.get("error", {}).get("is_transient"):
                            if attempt < max_retries - 1:
                                print(f"⏳ Transient error detected. Retrying in {retry_delay} seconds...")
                                await asyncio.sleep(retry_delay)
                                continue
                    except:
                        pass

                # Log error details if request failed
                if container_response.status_code != 200:
                    error_detail = container_response.text
                    print(f"❌ Instagram API Error: {error_detail}")

                container_response.raise_for_status()
                creation_id = container_response.json()["id"]
                break  # Success, exit retry loop

            except httpx.HTTPStatusError as e:
                if attempt < max_retries - 1:
                    print(f"⏳ Request failed (attempt {attempt + 1}/{max_retries}). Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    raise  # Re-raise on final attempt

        print(f"✅ Instagram media container created: {creation_id}")

        # Step 2: Wait for Instagram to process the image (recommended delay)
        print("⏳ Waiting 3 seconds for Instagram to process the image...")
        await asyncio.sleep(3)

        # Step 3: Publish the media container
        publish_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media_publish"
        publish_payload = {
            "creation_id": creation_id,
            "access_token": access_token
        }

        print(f"📤 Publishing media container: {creation_id}")
        publish_response = await client.post(publish_url, data=publish_payload)

        # Log error details if request failed
        if publish_response.status_code not in [200, 201]:
            error_detail = publish_response.text
            print(f"❌ Instagram Publish Error ({publish_response.status_code}): {error_detail}")

        publish_response.raise_for_status()
        result = publish_response.json()

    print(f"✅ Published to Instagram: Media ID {result.get('id')}")
    return result


async def publish_to_instagram_carousel(
    instagram_account_id: str,
    access_token: str,
    image_urls: list[str],
    caption: str
) -> dict:
    """
    Publish a carousel (multiple images) to Instagram.

    Args:
        instagram_account_id: Instagram Business Account ID
        access_token: Page access token
        image_urls: List of public image URLs (2-10 images)
        caption: Post caption

    Returns:
        dict with 'id' of the published carousel

    Raises:
        ValueError: If image_urls has < 2 or > 10 images
        httpx.HTTPStatusError: If the API request fails
    """
    if len(image_urls) < 2 or len(image_urls) > 10:
        raise ValueError("Carousel must have 2-10 images")

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Step 1: Create media containers for each image
        children_ids = []

        for image_url in image_urls:
            container_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media"
            payload = {
                "image_url": image_url,
                "is_carousel_item": True,
                "access_token": access_token
            }

            response = await client.post(container_url, data=payload)
            response.raise_for_status()
            children_ids.append(response.json()["id"])

        # Step 2: Create carousel container
        carousel_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media"
        carousel_payload = {
            "media_type": "CAROUSEL",
            "children": ",".join(children_ids),
            "caption": caption,
            "access_token": access_token
        }

        carousel_response = await client.post(carousel_url, data=carousel_payload)
        carousel_response.raise_for_status()
        carousel_id = carousel_response.json()["id"]

        # Step 3: Publish the carousel
        publish_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media_publish"
        publish_payload = {
            "creation_id": carousel_id,
            "access_token": access_token
        }

        publish_response = await client.post(publish_url, data=publish_payload)
        publish_response.raise_for_status()
        result = publish_response.json()

    print(f"✅ Published carousel to Instagram: {len(image_urls)} images, Media ID {result.get('id')}")
    return result
