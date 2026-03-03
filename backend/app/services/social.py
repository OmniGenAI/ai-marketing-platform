"""
Social media integration service.
Facebook and Instagram Graph API integrations for publishing posts.
"""
import httpx
from typing import Optional


async def publish_to_facebook(
    page_id: str,
    access_token: str,
    content: str,
    link: Optional[str] = None
) -> dict:
    """
    Publish a text post to Facebook page.

    Args:
        page_id: Facebook page ID
        access_token: Page access token
        content: Post message/content
        link: Optional link to attach to the post

    Returns:
        dict with 'id' of the published post

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    url = f"https://graph.facebook.com/v18.0/{page_id}/feed"

    payload = {
        "message": content,
        "access_token": access_token
    }

    if link:
        payload["link"] = link

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, data=payload)
        response.raise_for_status()
        result = response.json()

    print(f"✅ Published to Facebook: Post ID {result.get('id')}")
    return result


async def publish_to_instagram(
    instagram_account_id: str,
    access_token: str,
    image_url: str,
    caption: str
) -> dict:
    """
    Publish an image post to Instagram.
    Instagram requires images - text-only posts are not supported.

    Args:
        instagram_account_id: Instagram Business Account ID (not page ID)
        access_token: Page access token
        image_url: Public URL of the image to post
        caption: Post caption (content + hashtags)

    Returns:
        dict with 'id' of the published media

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    # Step 1: Create media container
    container_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media"
    container_payload = {
        "image_url": image_url,
        "caption": caption,
        "access_token": access_token
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Create the media container
        container_response = await client.post(container_url, data=container_payload)
        container_response.raise_for_status()
        creation_id = container_response.json()["id"]

        print(f"✅ Instagram media container created: {creation_id}")

        # Step 2: Publish the media container
        publish_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media_publish"
        publish_payload = {
            "creation_id": creation_id,
            "access_token": access_token
        }

        publish_response = await client.post(publish_url, data=publish_payload)
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
