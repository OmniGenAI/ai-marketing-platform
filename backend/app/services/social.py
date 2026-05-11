"""
Social media integration service.
Facebook and Instagram Graph API integrations for publishing posts.
"""
import base64
import httpx
import uuid
import asyncio
from typing import Optional
from app.utils.image_processor import resize_for_instagram, resize_for_instagram_bytes, upload_processed_image
from app.config import settings


def _is_public_http_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def _is_data_url(value: str) -> bool:
    return value.startswith("data:image/") and ";base64," in value


def _decode_data_url_image(data_url: str) -> tuple[bytes, str, str]:
    """Decode a base64 data URL and return bytes, mime type, and extension."""
    header, b64_data = data_url.split(",", 1)
    mime_type = "image/jpeg"
    if ";" in header and ":" in header:
        mime_type = header.split(":", 1)[1].split(";", 1)[0]

    image_bytes = base64.b64decode(b64_data)

    extension = "jpg"
    if "/" in mime_type:
        extension = mime_type.split("/", 1)[1].lower()
        if extension == "jpeg":
            extension = "jpg"

    return image_bytes, mime_type, extension


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
            url = f"https://graph.facebook.com/v18.0/{page_id}/photos"
            payload = {
                "caption": content,
                "access_token": access_token,
                "published": "true"  # Ensure photo is published immediately
            }

            files = None
            use_remote_url = _is_public_http_url(image_url) and len(image_url) <= 2000

            # Handle generated base64 data URLs by uploading bytes directly.
            if _is_data_url(image_url):
                try:
                    image_bytes, mime_type, extension = _decode_data_url_image(image_url)
                    files = {
                        "source": (f"generated.{extension}", image_bytes, mime_type)
                    }
                    use_remote_url = False
                    print("ℹ️  Detected data URL image. Uploading bytes directly to Facebook.")
                except Exception as e:
                    raise ValueError(f"Invalid data URL image format: {str(e)}")

            # First, verify the image URL is accessible
            if use_remote_url:
                try:
                    test_response = await client.head(image_url, timeout=10.0)
                    if test_response.status_code != 200:
                        print(f"⚠️  Warning: Image URL returned status {test_response.status_code}")
                except Exception as e:
                    print(f"⚠️  Warning: Could not verify image URL: {str(e)}")

                payload["url"] = image_url
            elif files is None:
                # For long/non-http URLs, try downloading bytes and upload via multipart source.
                try:
                    response = await client.get(image_url, timeout=20.0)
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
                    if not content_type.startswith("image/"):
                        content_type = "image/jpeg"
                    extension = content_type.split("/", 1)[1] if "/" in content_type else "jpg"
                    if extension == "jpeg":
                        extension = "jpg"
                    files = {
                        "source": (f"facebook_upload.{extension}", response.content, content_type)
                    }
                    print("ℹ️  Uploading image bytes directly to Facebook (fallback mode).")
                except Exception as e:
                    raise ValueError(f"Unable to use image URL for Facebook post: {str(e)}")
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
        if image_url and files:
            response = await client.post(url, data=payload, files=files)
        else:
            response = await client.post(url, data=payload)

        # Log error details if request failed
        if response.status_code not in [200, 201]:
            error_detail = response.text
            print(f"❌ Facebook API Error ({response.status_code}): {error_detail}")

            # Try to parse error details
            try:
                error_json = response.json()
                err = error_json.get("error", {})
                error_msg = err.get("error_user_msg") or err.get("message") or "Unknown error"
                error_code = err.get("code")
                error_subcode = err.get("error_subcode")
                print(f"❌ Error Code: {error_code}, Message: {error_msg}")

                # Auth / token errors → tell user to reconnect
                if 400 <= response.status_code < 500 and (
                    error_code in (190, 102, 463, 467) or error_subcode in (458, 460, 463, 467)
                ):
                    raise RuntimeError(
                        "Facebook session expired. Please go to Settings → Integrations and reconnect Facebook to refresh access."
                    )

                # If image URL error, suggest using feed endpoint instead
                if "url" in error_msg.lower() or "image" in error_msg.lower():
                    print("💡 Tip: Image URL might not be publicly accessible. Try using 'published=false' or upload directly.")

                # Surface a clean 4xx error to the caller
                if 400 <= response.status_code < 500:
                    raise RuntimeError(f"Facebook rejected the post: {error_msg}")
            except RuntimeError:
                raise
            except Exception:
                pass

        response.raise_for_status()
        result = response.json()

    # When posting via /photos the API returns both `id` (the photo object id)
    # and `post_id` ("{page_id}_{post_id}") — the latter is needed to build the
    # public permalink and to fetch post-level analytics.  Normalise the result
    # so callers always get `id` in the "page_id_post_id" format.
    if "post_id" in result:
        result = {"id": result["post_id"], "photo_id": result.get("id")}

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
    source_image_bytes: bytes | None = None
    try:
        if _is_data_url(image_url):
            print("ℹ️  Detected data URL image for Instagram. Converting to public image URL.")
            source_image_bytes, _, _ = _decode_data_url_image(image_url)
            processed_image_bytes = resize_for_instagram_bytes(source_image_bytes)
        elif _is_public_http_url(image_url) and len(image_url) <= 2000:
            # Resize/crop image to Instagram's aspect ratio requirements
            processed_image_bytes = await resize_for_instagram(image_url)
        else:
            raise ValueError("Image URL must be a public HTTP/HTTPS URL or a valid data URL")

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
        print(f"⚠️  Image processing failed, trying safe fallback: {str(e)}")

        # For data URLs, never pass the original URI to Instagram Graph API.
        if _is_data_url(image_url):
            if source_image_bytes is None:
                source_image_bytes, _, _ = _decode_data_url_image(image_url)

            fallback_filename = f"instagram_raw_{uuid.uuid4()}.jpeg"
            final_image_url = await upload_processed_image(
                image_bytes=source_image_bytes,
                user_id=user_id,
                filename=fallback_filename,
                supabase_url=settings.SUPABASE_URL,
                service_key=settings.SUPABASE_SERVICE_ROLE_KEY,
            )
            print(f"✅ Using raw uploaded image fallback: {final_image_url}")
        elif _is_public_http_url(image_url) and len(image_url) <= 2000:
            # If source is already a public URL, keep current fallback behavior.
            final_image_url = image_url
            print(f"✅ Using original public image URL fallback: {final_image_url}")
        else:
            raise ValueError("Instagram requires a public HTTP/HTTPS image URL. Received non-public image URI.")

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
                    # For 4xx errors, surface Instagram's real message instead of generic httpx text
                    if 400 <= container_response.status_code < 500:
                        try:
                            err_json = container_response.json().get("error", {})
                            msg = err_json.get("error_user_msg") or err_json.get("message") or error_detail
                            code = err_json.get("code")
                            subcode = err_json.get("error_subcode")
                            # Auth / token errors → tell user to reconnect
                            if code in (190, 102, 463, 467) or subcode in (458, 460, 463, 467):
                                raise RuntimeError(
                                    "Facebook/Instagram session expired. Please go to Settings → Integrations and reconnect Facebook to refresh access."
                                )
                            extra = f" (code {code}{f'/{subcode}' if subcode else ''})" if code else ""
                            raise RuntimeError(f"Instagram rejected the image: {msg}{extra}")
                        except RuntimeError:
                            raise
                        except Exception:
                            raise RuntimeError(f"Instagram rejected the request (400): {error_detail[:500]}")

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
            if 400 <= publish_response.status_code < 500:
                try:
                    err_json = publish_response.json().get("error", {})
                    msg = err_json.get("error_user_msg") or err_json.get("message") or error_detail
                    raise RuntimeError(f"Instagram publish failed: {msg}")
                except RuntimeError:
                    raise
                except Exception:
                    raise RuntimeError(f"Instagram publish failed (400): {error_detail[:500]}")

        publish_response.raise_for_status()
        result = publish_response.json()

    print(f"✅ Published to Instagram: Media ID {result.get('id')}")
    return result


async def publish_to_instagram_reels(
    instagram_account_id: str,
    access_token: str,
    video_url: str,
    caption: str,
    thumbnail_url: str | None = None,
) -> dict:
    """
    Publish a video to Instagram Reels.

    Args:
        instagram_account_id: Instagram Business Account ID
        access_token: Page access token
        video_url: Public URL of the video to post (must be MP4, H.264)
        caption: Post caption (content + hashtags)
        thumbnail_url: Optional custom thumbnail URL

    Returns:
        dict with 'id' of the published media

    Raises:
        httpx.HTTPStatusError: If the API request fails
    """
    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: Create media container for REELS
        container_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media"
        container_payload = {
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "access_token": access_token,
            "share_to_feed": "true",  # Also share to main feed
        }

        if thumbnail_url:
            container_payload["thumb_offset"] = "0"  # Use custom thumbnail

        print(f"📤 Creating Instagram Reels container...")
        container_response = await client.post(container_url, data=container_payload)

        if container_response.status_code != 200:
            error_detail = container_response.text
            print(f"❌ Instagram API Error: {error_detail}")

        container_response.raise_for_status()
        creation_id = container_response.json()["id"]
        print(f"✅ Media container created: {creation_id}")

        # Step 2: Wait for Instagram to process the video
        # Reels can take longer to process than images
        print("⏳ Waiting for Instagram to process the video...")
        max_attempts = 30  # 5 minutes max wait
        for attempt in range(max_attempts):
            status_url = f"https://graph.facebook.com/v18.0/{creation_id}"
            status_params = {
                "fields": "status_code",
                "access_token": access_token,
            }
            status_response = await client.get(status_url, params=status_params)
            status_data = status_response.json()

            status_code = status_data.get("status_code")
            print(f"   Status: {status_code} (attempt {attempt + 1}/{max_attempts})")

            if status_code == "FINISHED":
                break
            elif status_code == "ERROR":
                raise Exception("Instagram video processing failed")

            # Wait 10 seconds before checking again
            await asyncio.sleep(10)
        else:
            raise Exception("Video processing timeout - Instagram taking too long")

        # Step 3: Publish the media container
        publish_url = f"https://graph.facebook.com/v18.0/{instagram_account_id}/media_publish"
        publish_payload = {
            "creation_id": creation_id,
            "access_token": access_token,
        }

        print(f"📤 Publishing Reel...")
        publish_response = await client.post(publish_url, data=publish_payload)

        if publish_response.status_code not in [200, 201]:
            error_detail = publish_response.text
            print(f"❌ Instagram Publish Error ({publish_response.status_code}): {error_detail}")

        publish_response.raise_for_status()
        result = publish_response.json()

    print(f"✅ Published to Instagram Reels: Media ID {result.get('id')}")
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


# ---------------------------------------------------------------------------
# LinkedIn
# ---------------------------------------------------------------------------
async def publish_to_linkedin(
    member_urn: str,
    access_token: str,
    content: str,
    image_url: Optional[str] = None,
) -> dict:
    """
    Publish a post to LinkedIn via the UGC Posts API.

    If `image_url` is provided, runs the 3-step LinkedIn image flow:
      1. POST /assets?action=registerUpload   → get upload URL + asset URN
      2. PUT bytes to the upload URL          → uploads image
      3. POST /ugcPosts with shareMediaCategory=IMAGE referencing the asset

    Falls back to a text-only post if image upload fails.

    Args:
        member_urn: LinkedIn member URN (urn:li:person:{id}) stored as page_id
        access_token: OAuth 2.0 access token with w_member_social scope
        content: Post body text (max ~3000 visible chars)
        image_url: Optional image — public http URL or data:image/... data URL

    Returns:
        dict with 'id' of the created UGC post
    """
    headers_json = {
        "Authorization": f"Bearer {access_token}",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }

    asset_urn: Optional[str] = None

    # ─── Step 1+2: Image upload (only if image_url provided) ───
    if image_url:
        try:
            # Fetch image bytes (support both public http URL and base64 data URL)
            if _is_data_url(image_url):
                image_bytes, _, _ = _decode_data_url_image(image_url)
            else:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    img_res = await client.get(image_url)
                    img_res.raise_for_status()
                    image_bytes = img_res.content

            # Step 1: register upload
            register_payload = {
                "registerUploadRequest": {
                    "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
                    "owner": member_urn,
                    "serviceRelationships": [
                        {"relationshipType": "OWNER", "identifier": "urn:li:userGeneratedContent"}
                    ],
                }
            }
            async with httpx.AsyncClient(timeout=20.0) as client:
                reg_res = await client.post(
                    "https://api.linkedin.com/v2/assets?action=registerUpload",
                    json=register_payload,
                    headers=headers_json,
                )
                reg_res.raise_for_status()
                reg_data = reg_res.json()

            upload_url = (
                reg_data.get("value", {})
                .get("uploadMechanism", {})
                .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {})
                .get("uploadUrl")
            )
            asset_urn = reg_data.get("value", {}).get("asset")

            if not upload_url or not asset_urn:
                raise ValueError("LinkedIn registerUpload did not return upload URL / asset")

            # Step 2: PUT image bytes to the upload URL
            async with httpx.AsyncClient(timeout=60.0) as client:
                up_res = await client.put(
                    upload_url,
                    content=image_bytes,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if up_res.status_code not in (200, 201):
                    raise ValueError(f"LinkedIn image upload failed: {up_res.status_code}")

            print(f"🖼️  Uploaded image to LinkedIn: {asset_urn}")
        except Exception as e:
            print(f"⚠️  LinkedIn image upload failed, falling back to text-only: {e}")
            asset_urn = None

    # ─── Step 3: Create the UGC post ───
    if asset_urn:
        share_content = {
            "shareCommentary": {"text": content},
            "shareMediaCategory": "IMAGE",
            "media": [
                {
                    "status": "READY",
                    "description": {"text": ""},
                    "media": asset_urn,
                    "title": {"text": ""},
                }
            ],
        }
    else:
        share_content = {
            "shareCommentary": {"text": content},
            "shareMediaCategory": "NONE",
        }

    payload = {
        "author": member_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": share_content},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            json=payload,
            headers=headers_json,
        )
        r.raise_for_status()
        data = r.json() if r.text.strip() else {}
        post_id = data.get("id") or r.headers.get("x-restli-id", "")

    print(f"✅ Published to LinkedIn: {post_id}")
    return {"id": post_id}


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------
async def publish_to_reddit(
    username: str,
    access_token: str,
    content: str,
    subreddit: str = "",
    image_url: Optional[str] = None,
) -> dict:
    """
    Submit a post to Reddit. If `image_url` is provided, posts as a link to
    the image (Reddit's `link` kind) — full image upload requires Reddit's
    media upload API which needs additional scopes/permissions.

    Args:
        username: Reddit username (stored as page_id in SocialAccount)
        access_token: OAuth 2.0 access token with submit scope
        content: Full post body
        subreddit: Target subreddit without `r/` prefix.
                   Defaults to the user's own profile page (u/{username}).
        image_url: Optional public image URL — submitted as a link post

    Returns:
        dict with 'id' (fullname like "t3_abc123") and 'url'
    """
    sr = subreddit.strip() if subreddit.strip() else f"u_{username}"

    # Reddit title is required and capped at 300 chars; derive from first line.
    lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    title = lines[0][:300] if lines else content[:300]

    # If an image is provided AND it's a public http URL, submit as a link post.
    # Data URLs and private URLs fall back to self/text post.
    if image_url and _is_public_http_url(image_url):
        submit_data = {
            "api_type": "json",
            "kind": "link",
            "sr": sr,
            "title": title,
            "url": image_url,
            "nsfw": "false",
            "spoiler": "false",
            "resubmit": "true",
        }
        print(f"🖼️  Posting image link to Reddit r/{sr}")
    else:
        submit_data = {
            "api_type": "json",
            "kind": "self",
            "sr": sr,
            "title": title,
            "text": content,
            "nsfw": "false",
            "spoiler": "false",
            "resubmit": "true",
        }

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            "https://oauth.reddit.com/api/submit",
            data=submit_data,
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": settings.REDDIT_USER_AGENT,
            },
        )
        r.raise_for_status()
        data = r.json()

    errors = (data.get("json") or {}).get("errors") or []
    if errors:
        raise ValueError(f"Reddit submission error: {errors}")

    post_data = ((data.get("json") or {}).get("data") or {})
    post_id = post_data.get("name") or post_data.get("id") or ""
    url = post_data.get("url") or ""

    print(f"✅ Published to Reddit r/{sr}: {post_id}")
    return {"id": post_id, "url": url}


# ---------------------------------------------------------------------------
# Video publish — Facebook Reel
# ---------------------------------------------------------------------------
async def publish_to_facebook_reel(
    page_id: str,
    access_token: str,
    video_url: str,
    caption: str,
) -> dict:
    """
    Publish a Reel to a Facebook Page using the Reels API.
    Flow: start upload session → upload by file_url → finish.

    Args:
        page_id: Facebook Page ID
        access_token: Page access token with `pages_manage_posts`
        video_url: Public mp4 URL (must be downloadable by Facebook)
        caption: Post description (content + hashtags)
    """
    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: Start upload session
        start_res = await client.post(
            f"https://graph.facebook.com/v19.0/{page_id}/video_reels",
            data={"upload_phase": "start", "access_token": access_token},
        )
        start_res.raise_for_status()
        video_id = start_res.json().get("video_id")
        if not video_id:
            raise ValueError("Facebook did not return a video_id")
        print(f"📤 Started Facebook Reel upload session: {video_id}")

        # Step 2: Upload by file_url (Facebook downloads from this URL)
        upload_res = await client.post(
            f"https://rupload.facebook.com/video-upload/v19.0/{video_id}",
            headers={
                "Authorization": f"OAuth {access_token}",
                "file_url": video_url,
            },
        )
        upload_res.raise_for_status()
        print(f"📦 Facebook uploaded reel video from URL")

        # Step 3: Finish — publish the reel
        finish_res = await client.post(
            f"https://graph.facebook.com/v19.0/{page_id}/video_reels",
            params={
                "upload_phase": "finish",
                "video_id": video_id,
                "video_state": "PUBLISHED",
                "description": caption,
                "access_token": access_token,
            },
        )
        finish_res.raise_for_status()
        result = finish_res.json()

    print(f"✅ Published to Facebook Reel: {video_id}")
    return {"id": video_id, **result}


# ---------------------------------------------------------------------------
# Video publish — LinkedIn (UGC video post)
# ---------------------------------------------------------------------------
async def publish_to_linkedin_video(
    member_urn: str,
    access_token: str,
    video_url: str,
    caption: str,
) -> dict:
    """
    Publish a video post to LinkedIn via the UGC + Assets APIs.
    3-step flow: registerUpload → PUT bytes → create ugcPost with video media.

    Args:
        member_urn: LinkedIn member URN (urn:li:person:{id})
        access_token: OAuth token with w_member_social
        video_url: Public mp4 URL — must be downloadable to upload bytes
        caption: Post body text
    """
    headers_json = {
        "Authorization": f"Bearer {access_token}",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }

    # Step 1: register upload
    register_payload = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-video"],
            "owner": member_urn,
            "serviceRelationships": [
                {"relationshipType": "OWNER", "identifier": "urn:li:userGeneratedContent"}
            ],
        }
    }
    async with httpx.AsyncClient(timeout=300.0) as client:
        reg_res = await client.post(
            "https://api.linkedin.com/v2/assets?action=registerUpload",
            json=register_payload,
            headers=headers_json,
        )
        reg_res.raise_for_status()
        reg_data = reg_res.json()

    upload_url = (
        reg_data.get("value", {})
        .get("uploadMechanism", {})
        .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {})
        .get("uploadUrl")
    )
    asset_urn = reg_data.get("value", {}).get("asset")
    if not upload_url or not asset_urn:
        raise ValueError("LinkedIn registerUpload did not return upload URL / asset")

    # Step 2: download video and PUT to LinkedIn
    async with httpx.AsyncClient(timeout=600.0) as client:
        vid_res = await client.get(video_url)
        vid_res.raise_for_status()
        video_bytes = vid_res.content

        up_res = await client.put(
            upload_url,
            content=video_bytes,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if up_res.status_code not in (200, 201):
            raise ValueError(f"LinkedIn video upload failed: {up_res.status_code}")
    print(f"🎬 LinkedIn video uploaded: {asset_urn}")

    # Step 3: create UGC post with video media
    payload = {
        "author": member_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": caption},
                "shareMediaCategory": "VIDEO",
                "media": [{
                    "status": "READY",
                    "description": {"text": ""},
                    "media": asset_urn,
                    "title": {"text": ""},
                }],
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            json=payload,
            headers=headers_json,
        )
        r.raise_for_status()
        data = r.json() if r.text.strip() else {}
        post_id = data.get("id") or r.headers.get("x-restli-id", "")

    print(f"✅ Published video to LinkedIn: {post_id}")
    return {"id": post_id}


# ---------------------------------------------------------------------------
# Video publish — YouTube Short
# ---------------------------------------------------------------------------
async def publish_to_youtube_short(
    access_token: str,
    video_url: str,
    title: str,
    description: str,
    tags: list[str] | None = None,
) -> dict:
    """
    Upload a YouTube Short via the YouTube Data API v3.
    Flow: download video → resumable upload → set metadata.

    Args:
        access_token: OAuth token with youtube.upload scope
        video_url: Public mp4 URL
        title: Video title (max 100 chars)
        description: Video description (max 5000 chars)
        tags: Optional list of YouTube tags
    """
    metadata = {
        "snippet": {
            "title": (title or "")[:100],
            "description": (description or "")[:5000],
            "tags": (tags or [])[:30],
            "categoryId": "22",  # People & Blogs — safe default
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False,
        },
    }

    async with httpx.AsyncClient(timeout=600.0) as client:
        # Step 1: download video
        vid_res = await client.get(video_url)
        vid_res.raise_for_status()
        video_bytes = vid_res.content
        print(f"📥 Downloaded YouTube Short video ({len(video_bytes)} bytes)")

        # Step 2: initiate resumable upload
        init_res = await client.post(
            "https://www.googleapis.com/upload/youtube/v3/videos",
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "X-Upload-Content-Type": "video/mp4",
                "X-Upload-Content-Length": str(len(video_bytes)),
            },
            json=metadata,
        )
        init_res.raise_for_status()
        upload_url = init_res.headers.get("Location")
        if not upload_url:
            raise ValueError("YouTube did not return resumable upload URL")

        # Step 3: PUT the bytes
        up_res = await client.put(
            upload_url,
            content=video_bytes,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "video/mp4",
            },
        )
        up_res.raise_for_status()
        result = up_res.json()

    video_id = result.get("id", "")
    print(f"✅ Published YouTube Short: {video_id}")
    return {"id": video_id, "url": f"https://youtube.com/shorts/{video_id}" if video_id else ""}


# ---------------------------------------------------------------------------
# Video publish — Reddit (as link post to video URL)
# ---------------------------------------------------------------------------
async def publish_to_reddit_video(
    username: str,
    access_token: str,
    video_url: str,
    caption: str,
    subreddit: str = "",
) -> dict:
    """
    Submit a video to Reddit as a link post (uses video_url directly).
    Native video upload requires reddit's media API which needs extra scopes;
    link-post fallback works in all subs that allow link posts.
    """
    sr = subreddit.strip() if subreddit.strip() else f"u_{username}"
    lines = [ln.strip() for ln in caption.splitlines() if ln.strip()]
    title = lines[0][:300] if lines else (caption[:300] or "Video")

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            "https://oauth.reddit.com/api/submit",
            data={
                "api_type": "json",
                "kind": "link",
                "sr": sr,
                "title": title,
                "url": video_url,
                "nsfw": "false",
                "spoiler": "false",
                "resubmit": "true",
            },
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": settings.REDDIT_USER_AGENT,
            },
        )
        r.raise_for_status()
        data = r.json()

    errors = (data.get("json") or {}).get("errors") or []
    if errors:
        raise ValueError(f"Reddit video submission error: {errors}")

    post_data = ((data.get("json") or {}).get("data") or {})
    post_id = post_data.get("name") or post_data.get("id") or ""
    url = post_data.get("url") or ""
    print(f"✅ Published video link to Reddit r/{sr}: {post_id}")
    return {"id": post_id, "url": url}
