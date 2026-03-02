from google import genai

from app.config import settings


def get_gemini_client() -> genai.Client:
    return genai.Client(api_key=settings.GOOGLE_GEMINI_API_KEY)


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
    client = get_gemini_client()

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

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
    )
    text = response.text or ""

    content = ""
    generated_hashtags = ""

    if "CONTENT:" in text and "HASHTAGS:" in text:
        parts = text.split("HASHTAGS:")
        content = parts[0].replace("CONTENT:", "").strip()
        generated_hashtags = parts[1].strip()
    else:
        content = text.strip()

    return {"content": content, "hashtags": generated_hashtags}
