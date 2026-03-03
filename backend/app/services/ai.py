import httpx
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
    topic: str = "",
) -> dict:
    """
    Generate a social media post using Google Gemini AI via direct REST API.
    This approach is more reliable than SDK packages.
    """
    platform_guidelines = {
        "facebook": "Keep it under 500 characters. Use engaging, conversational language. Include a call-to-action.",
        "instagram": "Keep it under 2200 characters. Use emojis sparingly. Make it visually descriptive. End with relevant hashtags.",
    }

    prompt = f"""You are a social media marketing expert. Generate a {platform} post for the following business:

Business Name: {business_name}
Industry/Niche: {niche}
Tone: {tone}
Products/Services: {products}
Brand Voice: {brand_voice}
Target Audience: {target_audience}
{f'Topic/Theme: {topic}' if topic else ''}

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
