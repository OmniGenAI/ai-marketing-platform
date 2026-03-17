import httpx
import json
from app.config import settings


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
    """
    platform_guidelines = {
        "facebook": "Keep it under 500 characters. Use engaging, conversational language. Include a call-to-action.",
        "instagram": "Keep it under 2200 characters. Use emojis sparingly. Make it visually descriptive. End with relevant hashtags.",
    }

    # Parse website context if available
    website_info = ""
    if website_context:
        try:
            context = json.loads(website_context)
            website_parts = []
            if context.get("meta_description"):
                website_parts.append(f"Website Description: {context['meta_description']}")
            if context.get("about_content"):
                website_parts.append(f"About: {context['about_content'][:500]}")
            if context.get("main_content"):
                website_parts.append(f"Key Info: {context['main_content'][:500]}")
            website_info = "\n".join(website_parts)
        except (json.JSONDecodeError, TypeError):
            pass

    # Build website context section separately to avoid f-string backslash issue
    website_section = f"Website Context:\n{website_info}" if website_info else ""

    prompt = f"""You are a social media marketing expert. Generate a {platform} post for the following business:

Business Name: {business_name}
Industry/Niche: {niche}
Tone: {tone}
Products/Services: {products}
Brand Voice: {brand_voice}
Target Audience: {target_audience}
Topic/Theme: {topic}
{website_section}

Platform Guidelines: {platform_guidelines.get(platform, platform_guidelines['facebook'])}

Generate the post content and relevant hashtags separately.

Respond in this exact format:
CONTENT:
[Your post content here]

HASHTAGS:
[Your hashtags here, including any preferred: {hashtags}]
"""

    # Use direct REST API - most reliable method
    # Using gemini-flash-latest which is an alias for the latest flash model
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"

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

        return {"content": content, "hashtags": generated_hashtags}

    except httpx.HTTPStatusError as e:
        error_body = e.response.text
        raise Exception(f"Gemini API error: {e.response.status_code} - {error_body}")
    except Exception as e:
        raise Exception(f"Failed to generate content: {str(e)}")


def generate_image_from_prompt(topic: str, business_name: str, niche: str) -> str | None:
    """
    Generate an image using Google Imagen API.
    Returns the image URL or None if generation fails.
    """
    # Use Gemini to generate image via Imagen model
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImage?key={settings.GOOGLE_GEMINI_API_KEY}"

    prompt = f"Professional social media post image for {business_name}, a {niche} business. Theme: {topic}. High quality, engaging, suitable for marketing."

    payload = {
        "prompt": prompt,
        "number_of_images": 1,
        "aspect_ratio": "1:1",
        "safety_filter_level": "BLOCK_MEDIUM_AND_ABOVE",
    }

    try:
        response = httpx.post(
            api_url,
            json=payload,
            timeout=60.0
        )
        response.raise_for_status()

        result = response.json()

        # Extract image data (base64 or URL depending on API version)
        if "predictions" in result and len(result["predictions"]) > 0:
            image_data = result["predictions"][0]
            if "bytesBase64Encoded" in image_data:
                # Return base64 data URL
                return f"data:image/png;base64,{image_data['bytesBase64Encoded']}"
            elif "gcsUri" in image_data:
                return image_data["gcsUri"]

        return None

    except Exception as e:
        print(f"Image generation failed: {str(e)}")
        return None
