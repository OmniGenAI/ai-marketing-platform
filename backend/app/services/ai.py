import httpx
import json
import logging
from app.config import settings

logger = logging.getLogger(__name__)


def generate_social_post(
    business_name: str,
    niche: str,
    tone: str,
    products: str,
    brand_voice: str,
    target_audience: str,
    hashtags: str,
    platform: str,
    topic: str,
    website_context: str | None = None,
) -> dict:
    """
    Generate a social media post using Google Gemini AI via direct REST API.
    This approach is more reliable than SDK packages.
    website_context is prioritized to inform the post generation.
    """
    platform_guidelines = {
        "facebook": "Keep it under 500 characters. Use engaging, conversational language. Include a call-to-action.",
        "instagram": "Keep it under 2200 characters. Use emojis sparingly. Make it visually descriptive. End with relevant hashtags.",
    }

    # Parse website context if available and use it prominently
    website_info_list = []
    has_website_context = False
    
    if website_context:
        try:
            context = json.loads(website_context)
            has_website_context = bool(context)
            
            logger.info(f"Website context found with {len(context)} fields for business: {business_name}")
            
            if context.get("title"):
                website_info_list.append(f"Business Website Title: {context['title']}")
            if context.get("meta_description"):
                website_info_list.append(f"Business Description: {context['meta_description']}")
            if context.get("main_content"):
                website_info_list.append(f"Key Business Information: {context['main_content'][:800]}")
            if context.get("about_content"):
                website_info_list.append(f"About the Business: {context['about_content'][:600]}")
            if context.get("services"):
                website_info_list.append(f"Services/Products Info: {context['services'][:500]}")
            if context.get("contact_info"):
                website_info_list.append(f"Contact Information: {context['contact_info']}")
                
            logger.info(f"Extracted {len(website_info_list)} website info sections for post generation")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse website context for {business_name}: {str(e)}")
    else:
        logger.info(f"No website context provided for {business_name} - generating generic post")

    # Build comprehensive website context section
    if website_info_list:
        website_section = "IMPORTANT - USE THIS WEBSITE INFORMATION:\n" + "\n".join(website_info_list)
    else:
        website_section = ""

    prompt = f"""You are a social media marketing expert. Generate a {platform} post for the following business.

CRITICAL: If website information is provided below, YOU MUST incorporate relevant details from it into the post content.

Business Name: {business_name}
Industry/Niche: {niche}
Tone: {tone}
Products/Services: {products}
Brand Voice: {brand_voice}
Target Audience: {target_audience}
Topic/Theme: {topic}

{website_section}

Platform Guidelines: {platform_guidelines.get(platform, platform_guidelines['facebook'])}

INSTRUCTIONS:
- Generate engaging content that reflects the business information
- If website context is provided, ensure the post aligns with and references the business information
- Make the post specific to the business, not generic
- Generate post content and relevant hashtags separately

Respond in this exact format:
CONTENT:
[Your post content here]

HASHTAGS:
[Your hashtags here, including any preferred: {hashtags}]
"""

    # Use direct REST API - most reliable method
    # Using gemini-2.5-flash which is fast and reliable
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }

    try:
        response = httpx.post(
            api_url,
            json=payload,
            timeout=30.0
        )
        response.raise_for_status()

        result = response.json()

        # Extract text from response
        text = result["candidates"][0]["content"]["parts"][0]["text"]

        content = ""
        generated_hashtags = ""

        if "CONTENT:" in text and "HASHTAGS:" in text:
            parts = text.split("HASHTAGS:")
            content = parts[0].replace("CONTENT:", "").strip()
            generated_hashtags = parts[1].strip()
        else:
            content = text.strip()

        logger.info(f"Successfully generated {platform} post for {business_name} (website_context: {bool(has_website_context)})")
        return {"content": content, "hashtags": generated_hashtags}

    except httpx.HTTPStatusError as e:
        error_body = e.response.text
        logger.error(f"Gemini API error for {business_name}: {e.response.status_code}")
        raise Exception(f"Gemini API error: {e.response.status_code} - {error_body}")
    except Exception as e:
        logger.error(f"Failed to generate content for {business_name}: {str(e)}")
        raise Exception(f"Failed to generate content: {str(e)}")


import time

def generate_image_from_prompt(topic: str, business_name: str, niche: str) -> str | None:
    """
    Generate an image using Gemini 2.5 Flash Image model.
    Falls back to Pexels stock images on rate limit or failure.
    """
    # Using the fast and efficient gemini-2.5-flash-image model
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"

    prompt = (
        f"Professional photorealistic social media marketing photo for {business_name}, a {niche} business. Theme: {topic}. "
        "High quality, 4k resolution, engaging, suitable for marketing. "
        "Ensure absolute physical realism, natural lighting, and correct gravity. "
        "IMPORTANT: No floating objects, no extra limbs, no unrealistic physics, no distorted proportions."
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"]
        }
    }

    headers = {"Content-Type": "application/json"}
    max_retries = 2 # Reduced retries for speed as Flash is usually reliable

    # Use httpx.Client for connection pooling (faster retries)
    with httpx.Client(timeout=60.0) as client:
        for attempt in range(max_retries):
            try:
                response = client.post(api_url, headers=headers, json=payload)
                
                # 1. Handle Rate Limiting (Free tier allows ~20/day, but can burst)
                if response.status_code == 429:
                    wait_time = (2 ** attempt) * 2  # 2s, 4s, 8s backoff
                    logger.warning(f"Rate limited (429). Waiting {wait_time}s before retry {attempt + 1}/{max_retries}")
                    time.sleep(wait_time)
                    continue
                
                # 2. Raise for other HTTP errors (400, 403, 500)
                response.raise_for_status()
                result = response.json()

                # 3. Safely extract the Base64 image
                candidates = result.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        inline_data = part.get("inlineData", {})
                        if "data" in inline_data:
                            mime_type = inline_data.get("mimeType", "image/jpeg")
                            return f"data:{mime_type};base64,{inline_data['data']}"

                logger.error("API call succeeded, but no image data was found in the response.")
                break # Break out of loop: this is a structural issue, not a network hiccup

            except httpx.HTTPError as e:
                logger.error(f"HTTP error on attempt {attempt + 1}: {e}")
                # Optional: Retry on 500/503 Server Errors just like 429s
                if getattr(e, 'response', None) and e.response.status_code in [500, 502, 503] and attempt < max_retries - 1:
                    time.sleep((2 ** attempt) * 2)
                    continue
                break # Don't retry on 400 Bad Request or 403 Forbidden
                
            except Exception as e:
                logger.exception(f"Unexpected error during image generation: {e}")
                break

    return None