import httpx
import json
import logging
from app.config import settings

logger = logging.getLogger(__name__)


def call_llm_with_fallback(
    prompt: str,
    *,
    system: str = "",
    temperature: float = 0.7,
    expect_json: bool = False,
    caller: str = "llm",
) -> str:
    """Try Gemini 2.5-flash → Groq llama-3.3-70b → xAI grok-2. Raises if all fail.

    `expect_json=True` sets Gemini's responseMimeType to application/json and appends a
    JSON-only instruction to the system prompt for the OpenAI-compatible providers.
    """
    sys_msg = system or "You are a helpful assistant. Follow the requested response format exactly."
    if expect_json:
        sys_msg = sys_msg + "\n\nReturn ONLY valid JSON. No markdown fences, no commentary."

    def _try_gemini() -> str:
        # Use systemInstruction (separate field, not concatenated) so the
        # system block becomes a stable prefix Gemini's implicit prompt cache
        # can hash and reuse on follow-up calls within ~5 min.
        api_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
            f"?key={settings.GOOGLE_GEMINI_API_KEY}"
        )
        payload: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if sys_msg:
            payload["systemInstruction"] = {"parts": [{"text": sys_msg}]}
        if expect_json:
            payload["generationConfig"]["responseMimeType"] = "application/json"
        response = httpx.post(api_url, json=payload, timeout=45.0)
        response.raise_for_status()
        data = response.json()
        # Log cache stats so we can verify the prefix is actually being reused.
        usage = data.get("usageMetadata") or {}
        cached = usage.get("cachedContentTokenCount") or 0
        prompt_tok = usage.get("promptTokenCount") or 0
        if cached:
            logger.info(
                f"[{caller}] gemini cache HIT: {cached}/{prompt_tok} prompt tokens cached"
            )
        elif prompt_tok:
            logger.debug(
                f"[{caller}] gemini cache MISS: {prompt_tok} prompt tokens (none cached)"
            )
        return data["candidates"][0]["content"]["parts"][0]["text"]

    def _try_groq() -> str:
        if not settings.GROQ_API_KEY:
            raise Exception("GROQ_API_KEY not configured")
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                **({"response_format": {"type": "json_object"}} if expect_json else {}),
            },
            timeout=45.0,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    def _try_xai() -> str:
        if not settings.XAI_API_KEY:
            raise Exception("XAI_API_KEY not configured")
        response = httpx.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-2-latest",
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
            },
            timeout=45.0,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    providers = [
        ("gemini-2.5-flash", _try_gemini),
        ("groq-llama-3.3-70b", _try_groq),
        ("xai-grok-2", _try_xai),
    ]
    last_error: Exception | None = None
    for name, fn in providers:
        try:
            text = fn()
            if not (text or "").strip():
                raise Exception(f"{name} returned empty response")
            logger.info(f"[{caller}] {name} success ({len(text)} chars)")
            return text
        except httpx.HTTPStatusError as e:
            last_error = e
            logger.warning(
                f"[{caller}] {name} HTTP {e.response.status_code}; falling back. "
                f"Body: {e.response.text[:200]}"
            )
        except Exception as e:
            last_error = e
            logger.warning(f"[{caller}] {name} failed: {e}; falling back.")

    raise Exception(f"All LLM providers failed: {last_error}")


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
    seo_keywords: list[str] | None = None,
    primary_keyword: str = "",
    blog_url: str = "",
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

    # SEO-mode section: inject primary + secondary keywords
    seo_section = ""
    if primary_keyword or seo_keywords:
        kw_list = [k for k in ([primary_keyword] + (seo_keywords or [])) if k]
        seo_section = (
            "SEO MODE — integrate these target keywords naturally into the content "
            "(do not stuff, weave them in grammatically):\n"
            f"- Primary keyword: {primary_keyword or '(none)'}\n"
            f"- Secondary keywords: {', '.join(seo_keywords or [])}\n"
        )

    # Backlink section
    backlink_section = ""
    if blog_url:
        backlink_section = (
            f"BACKLINK — end the CONTENT with a short CTA line that includes this URL verbatim: {blog_url}\n"
            "Example CTA styles: 'Read more →', 'Full guide:', 'Learn more:'.\n"
        )

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

{seo_section}

{backlink_section}

Platform Guidelines: {platform_guidelines.get(platform, platform_guidelines['facebook'])}

INSTRUCTIONS:
- Generate engaging content that reflects the business information
- If website context is provided, ensure the post aligns with and references the business information
- Make the post specific to the business, not generic
- Generate post content and relevant hashtags separately
- If SEO keywords are provided, weave them into the CONTENT naturally and include them as hashtags

Respond in this exact format:
CONTENT:
[Your post content here]

HASHTAGS:
[Your hashtags here, including any preferred: {hashtags}]
"""

    def _parse(text: str) -> tuple[str, str]:
        if "CONTENT:" in text and "HASHTAGS:" in text:
            parts = text.split("HASHTAGS:")
            return parts[0].replace("CONTENT:", "").strip(), parts[1].strip()
        return text.strip(), ""

    def _post_process(content: str, generated_hashtags: str) -> dict:
        if blog_url and blog_url not in content:
            content = f"{content.rstrip()}\n\nRead more → {blog_url}"
        if seo_keywords or primary_keyword:
            def _to_tag(term: str) -> str:
                parts_ = [p for p in "".join(
                    c if c.isalnum() or c.isspace() else " " for c in term
                ).split() if p]
                return "#" + "".join(p.capitalize() for p in parts_) if parts_ else ""
            seo_tags = [t for t in [_to_tag(primary_keyword)] + [_to_tag(k) for k in (seo_keywords or [])] if t]
            existing = generated_hashtags.lower()
            missing = [t for t in seo_tags if t.lower() not in existing]
            if missing:
                generated_hashtags = (generated_hashtags + " " + " ".join(missing)).strip()
        return {"content": content, "hashtags": generated_hashtags}

    try:
        text = call_llm_with_fallback(
            prompt,
            system="You are a social media marketing expert. Follow the requested response format exactly.",
            temperature=0.7,
            caller=f"social-{platform}",
        )
    except Exception as e:
        logger.error(f"All LLM providers failed for {business_name}: {e}")
        raise Exception(f"Failed to generate content: {e}")

    content, generated_hashtags = _parse(text)
    if not content.strip():
        raise Exception("LLM returned empty content")
    result = _post_process(content, generated_hashtags)
    logger.info(
        f"Successfully generated {platform} post for {business_name} "
        f"(website_context: {bool(has_website_context)}, seo_mode: {bool(seo_keywords or primary_keyword)})"
    )
    return result


import time


def _build_image_prompt(topic: str, business_name: str, niche: str) -> str:
    return (
        f"Professional photorealistic social media marketing photo for {business_name}, a {niche} business. Theme: {topic}. "
        "High quality, 4k resolution, engaging, suitable for marketing. "
        "Ensure absolute physical realism, natural lighting, and correct gravity. "
        "IMPORTANT: No floating objects, no extra limbs, no unrealistic physics, no distorted proportions."
    )


def _generate_image_gemini(prompt: str) -> str | None:
    """Primary provider: Gemini 3 Pro image preview. Returns data-URI or None."""
    if not settings.GOOGLE_GEMINI_API_KEY:
        logger.info("Gemini image: API key missing, skipping")
        return None

    api_url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-3-pro-image-preview:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    headers = {"Content-Type": "application/json"}
    max_retries = 2

    with httpx.Client(timeout=60.0) as client:
        for attempt in range(max_retries):
            try:
                response = client.post(api_url, headers=headers, json=payload)

                if response.status_code == 429:
                    wait_time = (2 ** attempt) * 2
                    logger.warning(
                        f"Gemini image rate limited (429). Waiting {wait_time}s "
                        f"before retry {attempt + 1}/{max_retries}"
                    )
                    time.sleep(wait_time)
                    continue

                response.raise_for_status()
                result = response.json()

                candidates = result.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        inline_data = part.get("inlineData", {})
                        if "data" in inline_data:
                            mime_type = inline_data.get("mimeType", "image/jpeg")
                            return f"data:{mime_type};base64,{inline_data['data']}"

                logger.error("Gemini image: response had no image data")
                return None

            except httpx.HTTPError as e:
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                logger.error(f"Gemini image HTTP error attempt {attempt + 1}: {e}")
                if status_code in (500, 502, 503) and attempt < max_retries - 1:
                    time.sleep((2 ** attempt) * 2)
                    continue
                return None

            except Exception as e:
                logger.exception(f"Gemini image unexpected error: {e}")
                return None

    return None


def _generate_image_openai(prompt: str) -> str | None:
    """Fallback provider: OpenAI image generation (gpt-image-1 / dall-e-3).

    Requests b64_json so we can return a self-contained data URI (matching
    Gemini's output shape — no external URL fetch needed downstream).
    """
    if not settings.OPENAI_API_KEY:
        logger.info("OpenAI image: API key missing, skipping fallback")
        return None

    api_url = "https://api.openai.com/v1/images/generations"
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": settings.OPENAI_IMAGE_SIZE,
        "response_format": "b64_json",
    }
    max_retries = 2

    with httpx.Client(timeout=90.0) as client:
        for attempt in range(max_retries):
            try:
                response = client.post(api_url, headers=headers, json=payload)

                if response.status_code == 429:
                    wait_time = (2 ** attempt) * 2
                    logger.warning(
                        f"OpenAI image rate limited (429). Waiting {wait_time}s "
                        f"before retry {attempt + 1}/{max_retries}"
                    )
                    time.sleep(wait_time)
                    continue

                response.raise_for_status()
                result = response.json()

                data = result.get("data", [])
                if data:
                    item = data[0]
                    b64 = item.get("b64_json")
                    if b64:
                        return f"data:image/png;base64,{b64}"
                    url = item.get("url")
                    if url:
                        # Some accounts/models only return URLs — pass through.
                        return url

                logger.error("OpenAI image: response had no image data")
                return None

            except httpx.HTTPError as e:
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                logger.error(f"OpenAI image HTTP error attempt {attempt + 1}: {e}")
                if status_code in (500, 502, 503) and attempt < max_retries - 1:
                    time.sleep((2 ** attempt) * 2)
                    continue
                return None

            except Exception as e:
                logger.exception(f"OpenAI image unexpected error: {e}")
                return None

    return None


def generate_image_from_prompt(topic: str, business_name: str, niche: str) -> str | None:
    """Generate a marketing image with provider fallback.

    Order: Gemini 3 Pro image preview → OpenAI (gpt-image-1). Returns a data URI
    (or external URL) on success, None if every provider fails.
    """
    prompt = _build_image_prompt(topic, business_name, niche)

    image = _generate_image_gemini(prompt)
    if image:
        return image

    logger.warning("Gemini image generation failed — falling back to OpenAI")
    image = _generate_image_openai(prompt)
    if image:
        logger.info("OpenAI fallback succeeded")
        return image

    logger.error("All image providers failed (Gemini, OpenAI)")
    return None