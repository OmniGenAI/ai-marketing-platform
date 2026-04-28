import base64
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
    """Try OpenAI gpt-4o-mini → Groq llama-3.3-70b → xAI grok-2. Raises if all fail.

    `expect_json=True` enables JSON mode and appends a JSON-only instruction to the
    system prompt for all providers.
    """
    sys_msg = system or "You are a helpful assistant. Follow the requested response format exactly."
    if expect_json:
        sys_msg = sys_msg + "\n\nReturn ONLY valid JSON. No markdown fences, no commentary."

    def _try_openai() -> str:
        if not settings.OPENAI_API_KEY:
            raise Exception("OPENAI_API_KEY not configured")
        response = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.OPENAI_TEXT_MODEL,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                **(({"response_format": {"type": "json_object"}}) if expect_json else {}),
            },
            timeout=45.0,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

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
        (f"openai-{settings.OPENAI_TEXT_MODEL}", _try_openai),
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


def _build_image_prompt(
    topic: str,
    business_name: str,
    niche: str,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    reserve_logo_corner: bool = False,
    aspect_ratio: str | None = None,
    overlay_text: str | None = None,
) -> str:
    """Build a marketing image prompt with optional brand colors and logo safe-zone.

    The topic is used ONLY as conceptual inspiration. Any company names or
    acronyms inside the topic must NOT be rendered as visible text/logos —
    that's what the deterministic logo composite step is for.

    If ``overlay_text`` is provided, that exact phrase is allowed to appear as
    a single rendered headline in the image (and only that phrase).
    """
    overlay = (overlay_text or "").strip()

    parts: list[str] = [
        f"Professional photorealistic social media marketing photo for a "
        f"{niche} business. Theme: {topic}. "
        "High quality, 4k resolution, engaging, suitable for marketing. "
        "Ensure absolute physical realism, natural lighting, and correct gravity. "
        "IMPORTANT: No floating objects, no extra limbs, no unrealistic physics, "
        "no distorted proportions. Do NOT render any logo, brand mark, icon, or "
        "emblem anywhere in the image — a brand logo will be composited onto the "
        "bottom-right corner separately."
        
    ]

    if primary_color or secondary_color:
        bits: list[str] = []
        if primary_color:
            bits.append(f"primary {primary_color}")
        if secondary_color:
            bits.append(f"secondary {secondary_color}")
        parts.append(
            "Incorporate the brand color palette naturally via wardrobe, props, "
            "or lighting accents. Colors: " + ", ".join(bits) + "."
        )

    if reserve_logo_corner:
        parts.append(
            "Leave the bottom-right quadrant of the frame completely empty — "
            "soft, low-detail background with absolutely NO text, NO words, "
            "NO letters, NO subjects, NO faces, and NO busy detail in that "
            "corner (it will be covered by a logo overlay)."
        )

    if overlay:
        parts.append(
            f"Render ONE single headline as a clean text overlay that reads "
            f"EXACTLY and ONLY this phrase, character-for-character: \"{overlay}\". "
            "Spell every letter precisely with correct spacing and punctuation — "
            "no typos, no missing letters, no swapped letters, no invented words, "
            "no extra words, no subtitles, no body copy, no bullet points, no "
            "numbered lists, no captions, no duplicate text. Do NOT add any other "
            "text anywhere else in the image. Do NOT show signs, whiteboards, "
            "tablets, screens, posters, papers, or any prop displaying additional "
            "writing. Place the headline ONLY in the TOP portion of the frame "
            "(top-left or top-center), never in the bottom half and never in the "
            "bottom-right corner. Render it as a flat overlay with strong contrast "
            "and clean, legible sans-serif typography."
        )

    if aspect_ratio:
        parts.append(
            f"Compose the frame with a {aspect_ratio} aspect ratio (width:height)."
        )

    return " ".join(parts)


# Aspect-ratio mapping tables.
# OpenAI gpt-image-1 / dall-e-3 only accept a fixed enum of sizes — pick the
# closest match per requested ratio. Gemini accepts an explicit aspectRatio
# string in its imageConfig.
_OPENAI_SIZE_BY_RATIO: dict[str, str] = {
    "1:1":    "1024x1024",
    "4:5":    "1024x1024",   # closest available; true 4:5 isn't supported
    "9:16":   "1024x1792",   # portrait
    "16:9":   "1792x1024",   # landscape
    "1.91:1": "1792x1024",   # landscape (FB/LinkedIn link preview)
}

_GEMINI_RATIO_WHITELIST = {"1:1", "3:4", "4:3", "9:16", "16:9", "4:5", "5:4", "1.91:1"}


def _openai_size_for_ratio(ratio: str | None) -> str:
    if not ratio:
        return settings.OPENAI_IMAGE_SIZE
    return _OPENAI_SIZE_BY_RATIO.get(ratio, settings.OPENAI_IMAGE_SIZE)


def _generate_image_gemini(prompt: str, aspect_ratio: str | None = None) -> str | None:
    """Primary provider: Gemini 3 Pro image preview. Returns data-URI or None."""
    if not settings.GOOGLE_GEMINI_API_KEY:
        logger.info("Gemini image: API key missing, skipping")
        return None

    api_url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-3-pro-image-preview:generateContent?key={settings.GOOGLE_GEMINI_API_KEY}"
    )
    generation_config: dict = {"responseModalities": ["IMAGE"]}
    if aspect_ratio and aspect_ratio in _GEMINI_RATIO_WHITELIST:
        generation_config["imageConfig"] = {"aspectRatio": aspect_ratio}

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
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


def _generate_image_openai(prompt: str, aspect_ratio: str | None = None) -> str | None:
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
    # gpt-image-1 does not accept response_format; dall-e-2/3 do.
    is_dalle = settings.OPENAI_IMAGE_MODEL.startswith("dall-e")
    payload: dict = {
        "model": settings.OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "n": 1,
        "size": _openai_size_for_ratio(aspect_ratio),
    }
    if is_dalle:
        payload["response_format"] = "b64_json"
    max_retries = 2

    with httpx.Client(timeout=90.0) as client:
        for attempt in range(max_retries):
            try:
                response = client.post(api_url, headers=headers, json=payload)

                if response.status_code in (401, 403):
                    try:
                        body = response.json()
                        msg = (body.get("error") or {}).get("message", response.text[:300])
                    except Exception:
                        msg = response.text[:300]
                    logger.error(
                        f"OpenAI image auth error {response.status_code}: {msg}. "
                        "Check that OPENAI_API_KEY is valid and has 'images' permission."
                    )
                    return None

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
                    # dall-e returns b64_json; gpt-image-1 returns b64 directly
                    b64 = item.get("b64_json") or item.get("b64")
                    if b64:
                        return f"data:image/png;base64,{b64}"
                    url = item.get("url")
                    if url:
                        return url

                logger.error("OpenAI image: response had no image data")
                return None

            except httpx.HTTPError as e:
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                body = ""
                try:
                    body = e.response.json().get("error", {}).get("message", "")  # type: ignore[union-attr]
                except Exception:
                    pass
                logger.error(f"OpenAI image HTTP {status_code} on attempt {attempt + 1}: {body or e}")
                if status_code in (500, 502, 503) and attempt < max_retries - 1:
                    time.sleep((2 ** attempt) * 2)
                    continue
                return None

            except Exception as e:
                logger.exception(f"OpenAI image unexpected error: {e}")
                return None

    return None


def generate_image_from_prompt(
    topic: str,
    business_name: str,
    niche: str,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    logo_url: str | None = None,
    aspect_ratio: str | None = None,
    overlay_text: str | None = None,
    user_id: str | None = None,
) -> str | None:
    """Generate a marketing image using OpenAI.

    If ``primary_color``/``secondary_color`` are given they're injected into the
    prompt. If ``logo_url`` is provided the brand logo is composited onto the
    bottom-right corner after generation (deterministic — AI never draws logos).
    If ``overlay_text`` is provided that exact phrase is requested as a rendered
    headline in the image.

    Returns a public URL (Supabase Storage) on success, or a data URI as a
    fallback when storage isn't configured. Returns None on hard failure.
    """
    from app.utils.image_processor import (
        composite_logo_on_image,
        upload_bytes_to_supabase,
    )

    prompt = _build_image_prompt(
        topic, business_name, niche,
        primary_color=primary_color,
        secondary_color=secondary_color,
        reserve_logo_corner=bool(logo_url),
        aspect_ratio=aspect_ratio,
        overlay_text=overlay_text,
    )

    logger.info(
        f"[IMAGE] generating — colors=({primary_color}, {secondary_color}) "
        f"logo={'yes' if logo_url else 'no'}"
    )
    image = _generate_image_openai(prompt, aspect_ratio=aspect_ratio)
    if not image:
        logger.error("Image generation failed (OpenAI)")
        return None

    # Resolve the AI image to raw bytes so we can (optionally) composite a
    # logo and (always) upload to storage instead of persisting a data URI.
    try:
        if image.startswith("data:"):
            _, b64 = image.split(",", 1)
            img_bytes = base64.b64decode(b64)
        else:
            with httpx.Client(timeout=20.0, follow_redirects=True) as c:
                r = c.get(image)
                r.raise_for_status()
                img_bytes = r.content
    except Exception as e:
        logger.warning(f"Failed to materialize AI image bytes ({e}); returning raw response")
        return image

    if logo_url:
        try:
            logger.info(
                f"[IMAGE] compositing logo from {logo_url[:80]} ({len(img_bytes)} bytes base)"
            )
            composited = composite_logo_on_image(img_bytes, logo_url)
            if composited == img_bytes:
                logger.warning("[IMAGE] composite returned original — logo step failed silently")
            else:
                logger.info(f"[IMAGE] composite OK ({len(composited)} bytes out)")
                img_bytes = composited
        except Exception as e:
            logger.warning(f"Logo composite step failed, keeping raw AI image: {e}")

    # Upload to Supabase Storage if we have a user — avoids stuffing a multi-MB
    # base64 string into Postgres on every generation.
    if user_id:
        public_url = upload_bytes_to_supabase(img_bytes, user_id)
        if public_url:
            logger.info(f"[IMAGE] uploaded to storage: {public_url}")
            return public_url
        logger.warning("[IMAGE] storage upload failed — falling back to data URI")

    b64_out = base64.b64encode(img_bytes).decode("ascii")
    return f"data:image/png;base64,{b64_out}"


# ---------------------------------------------------------------------------
# Poster generation helpers
# ---------------------------------------------------------------------------
#
# Posters use the same image providers as social posts but with two important
# differences:
#   1. The image prompt explicitly forbids ALL rendered text — the frontend
#      renders headline / tagline / CTA as a CSS overlay on top of the image
#      so spelling is always correct and editable.
#   2. Copy is generated separately as structured JSON (headline / tagline /
#      cta / caption) via call_llm_with_fallback(expect_json=True).

# Short visual-style fragments injected into the image prompt per template.
# Keep these focused on aesthetics (color, lighting, texture, mood). Layout
# guidance lives in the shared prompt scaffold below.
_POSTER_STYLE_FRAGMENTS: dict[str, str] = {
    "minimal":   "minimal Swiss design aesthetic, generous negative space, "
                 "muted off-white backdrop with one or two subtle shapes, "
                 "soft natural lighting, refined and uncluttered",
    "bold":      "bold high-contrast composition, vibrant saturated colors, "
                 "thick geometric shapes, dramatic lighting, energetic mood",
    "corporate": "clean corporate aesthetic, premium glass-and-metal feel, "
                 "balanced composition, soft cool gradient backdrop, "
                 "trustworthy and modern",
    "festival":  "festive celebratory atmosphere, warm gradient backdrop, "
                 "soft bokeh lights and abstract confetti shapes, joyful mood, "
                 "no people, no human faces",
    "tech":      "futuristic technology aesthetic, dark navy backdrop with "
                 "neon accents, abstract circuit / grid texture, glow effects, "
                 "sleek and modern",
    "startup":   "modern startup aesthetic, bright airy backdrop, soft pastel "
                 "gradients with playful abstract shapes, optimistic and "
                 "forward-looking mood",
    "event":     "event poster aesthetic, dramatic spotlight lighting, deep "
                 "rich backdrop with subtle particle effects, cinematic mood",
    "sale":      "promotional sale aesthetic, energetic warm color palette "
                 "(reds / oranges / yellows), abstract burst / starburst "
                 "shapes, eye-catching and urgent",
}


def _build_poster_image_prompt(
    title: str,
    theme: str,
    template_style: str,
    aspect_ratio: str,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    reserve_logo_corner: bool = False,
) -> str:
    """Build a TEXT-FREE poster background prompt.

    The frontend renders headline / tagline / CTA as a CSS overlay, so the
    image must contain absolutely no letters, numbers, signs, or readable
    glyphs of any kind. The prompt explicitly reserves negative space where
    the overlay will sit.
    """
    style_fragment = _POSTER_STYLE_FRAGMENTS.get(
        template_style, _POSTER_STYLE_FRAGMENTS["minimal"]
    )

    parts: list[str] = [
        f"Professional poster background for the topic \"{title}\".",
        f"Theme: {theme or template_style}.",
        f"Visual style: {style_fragment}.",
        "High-quality, 4k resolution, suitable for use as a marketing poster background.",
        # Hard constraints — text-free background is the entire point.
        "ABSOLUTELY NO text, NO letters, NO numbers, NO words, NO captions, "
        "NO signs, NO logos, NO watermarks, NO typography, NO whiteboards, "
        "NO papers, NO tablets or screens displaying writing, NO calligraphy, "
        "NO graffiti — the image must be 100% free of any readable glyph.",
        # Composition guidance so the CSS overlay has a clean place to land.
        "Compose with strong negative space in the upper-center and "
        "lower-center of the frame so a separate text overlay can be placed "
        "there cleanly. Keep the focal point (if any) toward the edges or "
        "softly de-focused in the middle.",
        "Photorealistic where appropriate, but stylized abstract / "
        "illustrative compositions are equally welcome — pick whichever fits "
        "the visual style above.",
    ]

    if primary_color or secondary_color:
        bits: list[str] = []
        if primary_color:
            bits.append(f"primary {primary_color}")
        if secondary_color:
            bits.append(f"secondary {secondary_color}")
        parts.append(
            "Incorporate the brand color palette naturally as gradient / "
            "lighting accents — never as colored text. Colors: "
            + ", ".join(bits) + "."
        )

    if reserve_logo_corner:
        parts.append(
            "Leave the bottom-right quadrant of the frame completely empty — "
            "soft, low-detail background with NO subjects and NO busy detail "
            "in that corner (a brand logo will be composited there separately)."
        )

    parts.append(
        f"Compose the frame with a {aspect_ratio} aspect ratio (width:height)."
    )

    return " ".join(parts)


def generate_poster_background(
    title: str,
    theme: str,
    template_style: str,
    aspect_ratio: str,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    logo_url: str | None = None,
    user_id: str | None = None,
) -> str | None:
    """Generate a TEXT-FREE poster background and persist to storage.

    Returns a public Supabase Storage URL on success, a data URI when storage
    isn't configured, or None on hard failure. NEVER renders text — that's
    the frontend's job via CSS overlay.
    """
    from app.utils.image_processor import (
        composite_logo_on_image,
        upload_bytes_to_supabase,
    )

    prompt = _build_poster_image_prompt(
        title=title,
        theme=theme,
        template_style=template_style,
        aspect_ratio=aspect_ratio,
        primary_color=primary_color,
        secondary_color=secondary_color,
        reserve_logo_corner=bool(logo_url),
    )

    logger.info(
        f"[POSTER-IMAGE] generating — style={template_style} ratio={aspect_ratio} "
        f"colors=({primary_color}, {secondary_color}) logo={'yes' if logo_url else 'no'}"
    )

    image = _generate_image_gemini(prompt, aspect_ratio=aspect_ratio)
    if not image:
        logger.warning("[POSTER-IMAGE] Gemini failed; falling back to OpenAI")
        image = _generate_image_openai(prompt, aspect_ratio=aspect_ratio)
    if not image:
        logger.error("[POSTER-IMAGE] all providers failed")
        return None

    # Materialize the AI image to bytes so we can (optionally) composite the
    # brand logo and upload to Supabase Storage.
    try:
        if image.startswith("data:"):
            _, b64 = image.split(",", 1)
            img_bytes = base64.b64decode(b64)
        else:
            with httpx.Client(timeout=20.0, follow_redirects=True) as c:
                r = c.get(image)
                r.raise_for_status()
                img_bytes = r.content
    except Exception as e:
        logger.warning(f"[POSTER-IMAGE] failed to materialize bytes ({e}); returning raw")
        return image

    if logo_url:
        try:
            composited = composite_logo_on_image(img_bytes, logo_url)
            if composited != img_bytes:
                logger.info(f"[POSTER-IMAGE] composite OK ({len(composited)} bytes)")
                img_bytes = composited
        except Exception as e:
            logger.warning(f"[POSTER-IMAGE] logo composite failed, keeping raw: {e}")

    if user_id:
        public_url = upload_bytes_to_supabase(img_bytes, user_id)
        if public_url:
            logger.info(f"[POSTER-IMAGE] uploaded: {public_url}")
            return public_url
        logger.warning("[POSTER-IMAGE] storage upload failed — falling back to data URI")

    b64_out = base64.b64encode(img_bytes).decode("ascii")
    return f"data:image/png;base64,{b64_out}"


# CTAs that have become advertising clichés — refuse them and pick a
# template-appropriate replacement. Match is lowercase + whitespace-collapsed.
_GENERIC_CTA_BLOCKLIST: frozenset[str] = frozenset(
    {
        "learn more",
        "get started",
        "click here",
        "read more",
        "find out more",
        "more info",
        "discover more",
        "see more",
        "view more",
        "check it out",
        "explore",
        "explore now",
        "start here",
    }
)

# Per-template fallback CTA when the LLM returns a generic phrase. Tuned so
# the verb matches the poster's intent ("Reserve Your Spot" for events, etc).
_TEMPLATE_CTA_FALLBACK: dict[str, str] = {
    "minimal":   "Enroll Today",
    "bold":      "Join Now",
    "corporate": "Book a Demo",
    "festival":  "Reserve Your Spot",
    "tech":      "Start Free Trial",
    "startup":   "Try It Free",
    "event":     "Reserve Your Spot",
    "sale":      "Shop the Sale",
}


def _sanitize_cta(cta: str, template_style: str, hint: str | None = None) -> str:
    """Replace generic CTAs ("Learn More") with a template-appropriate verb.

    If the caller supplied a verb hint (e.g. "Enroll") and the LLM ignored
    it, swap in a hint-prefixed default ("Enroll Today").
    """
    raw = (cta or "").strip()
    normalized = " ".join(raw.lower().split())
    if normalized and normalized not in _GENERIC_CTA_BLOCKLIST:
        return raw

    if hint:
        return f"{hint.strip().capitalize()} Today"
    return _TEMPLATE_CTA_FALLBACK.get(template_style, "Enroll Today")


def generate_poster_copy(
    title: str,
    theme: str,
    optional_text: str | None,
    template_style: str,
    caption_tone: str,
    business_name: str = "",
    niche: str = "",
    brand_voice: str = "",
    cta_verb_hint: str | None = None,
) -> dict:
    """Generate structured copy for a poster.

    Returns a dict with keys: headline, tagline, event_meta, features (list[str]),
    cta, caption. Uses the existing JSON-mode LLM fallback chain
    (OpenAI → Groq → xAI). Generic CTAs are auto-replaced via `_sanitize_cta`.
    """
    business_section = ""
    if business_name or niche or brand_voice:
        business_section = (
            "Business context (use to keep the copy on-brand):\n"
            f"- Business: {business_name or '(unspecified)'}\n"
            f"- Niche / industry: {niche or '(unspecified)'}\n"
            f"- Brand voice: {brand_voice or '(unspecified)'}\n"
        )

    optional_section = ""
    if optional_text:
        optional_section = (
            "Optional user-provided context (incorporate these details into "
            "headline / tagline / event_meta / features / CTA / caption where "
            "relevant):\n"
            f"{optional_text}\n"
        )

    cta_hint_section = ""
    if cta_verb_hint:
        cta_hint_section = (
            f"CTA verb hint: the user wants the CTA to start with "
            f"\"{cta_verb_hint}\" (e.g. \"{cta_verb_hint} Now\", "
            f"\"{cta_verb_hint} Today\"). Honour this unless it's grammatically "
            "impossible.\n"
        )

    prompt = f"""You are a senior poster copywriter. Generate poster copy for the following.

Title (main subject of the poster): {title}
Theme / vibe: {theme or '(open)'}
Template style: {template_style}
Caption tone: {caption_tone}

{business_section}
{optional_section}
{cta_hint_section}

Constraints:
- HEADLINE: 2 to 6 words, punchy, the one phrase the eye lands on first.
- TAGLINE: 6 to 14 words, expands the headline with the key benefit.
- EVENT_META: 1 short eyebrow line that sits ABOVE the headline. Format:
  "<format> · <duration / cadence> · <date or location if relevant>".
  Example for a course: "30-Day Bootcamp · Self-paced · Starts May 1".
  Example for a sale:   "Limited-Time Sale · 48 Hours · Online".
  If no event details are obvious from the title/theme/optional text, use a
  short category descriptor like "Cloud Skills · Beginner-Friendly · Hands-on".
  Maximum 60 characters.
- FEATURES: an array of EXACTLY 3 to 4 short benefit bullets. Each bullet must
  be 2 to 6 words, start with a verb or noun (NOT "We"), and have NO trailing
  punctuation. Example for a course:
  ["Hands-on AWS labs", "Real cloud projects", "Mentor support",
   "Certification ready"].
- CTA: 2 to 4 words. MUST start with one of these action verbs:
  Enroll, Register, Reserve, Join, Start, Shop, Claim, Get, Book, Sign up,
  Download, Apply, Try.
  FORBIDDEN (these are too generic and will be REJECTED):
  "Learn More", "Get Started", "Click Here", "Read More", "Find Out More",
  "More Info", "Discover More", "See More", "Explore", "Check it out".
  Good examples: "Enroll Now", "Reserve Your Spot", "Shop the Sale",
  "Join Free Webinar", "Start Free Trial", "Book a Demo".
- CAPTION: 2 to 4 short sentences suitable for posting alongside the poster
  on social media. Match the requested caption tone. Include 3 to 6 relevant
  hashtags at the end on a single line.

Return ONLY a valid JSON object with EXACTLY these keys (no markdown, no commentary):
{{
  "headline": "...",
  "tagline": "...",
  "event_meta": "...",
  "features": ["...", "...", "...", "..."],
  "cta": "...",
  "caption": "..."
}}
"""

    def _fallback_copy() -> dict:
        return {
            "headline": title.strip(),
            "tagline": (theme or template_style).strip().capitalize() or title.strip(),
            "event_meta": (theme or template_style).strip().title()
                          or "Featured · This Week",
            "features": [
                "Beginner-friendly",
                "Hands-on lessons",
                "Practical results",
            ],
            "cta": _sanitize_cta("", template_style, cta_verb_hint),
            "caption": f"{title.strip()} — {theme or template_style}.",
        }

    try:
        text = call_llm_with_fallback(
            prompt,
            system=(
                "You are a senior poster copywriter. Return ONLY valid JSON "
                "with the requested keys. No markdown, no prose."
            ),
            temperature=0.8,
            expect_json=True,
            caller=f"poster-copy-{template_style}",
        )
    except Exception as e:
        logger.error(f"[POSTER-COPY] all LLM providers failed: {e}")
        return _fallback_copy()

    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"[POSTER-COPY] LLM returned non-JSON: {e}; raw={text[:200]!r}")
        return _fallback_copy()

    if not isinstance(data, dict):
        logger.warning("[POSTER-COPY] LLM returned non-object JSON; using fallback")
        return _fallback_copy()

    fallback = _fallback_copy()

    raw_features = data.get("features")
    if isinstance(raw_features, list) and raw_features:
        features = [
            str(f).strip().rstrip(".")
            for f in raw_features
            if isinstance(f, (str, int, float)) and str(f).strip()
        ][:4]
        if len(features) < 3:
            features = (features + fallback["features"])[:3]
    else:
        features = fallback["features"]

    return {
        "headline": str(data.get("headline") or fallback["headline"]).strip(),
        "tagline": str(data.get("tagline") or fallback["tagline"]).strip(),
        "event_meta": str(data.get("event_meta") or fallback["event_meta"]).strip()[:255],
        "features": features,
        "cta": _sanitize_cta(
            str(data.get("cta") or ""), template_style, cta_verb_hint
        ),
        "caption": str(data.get("caption") or fallback["caption"]).strip(),
    }
