import json
import logging
import re

from app.schemas.repurpose import (
    ALL_PLATFORMS,
    ContentGoal,
    CtaStyle,
    VoicePreset,
)
from app.services.ai import call_llm_with_fallback

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tuning knobs (module-level for easy iteration & A/B)
# ---------------------------------------------------------------------------

VOICE_INSTRUCTIONS: dict[str, str] = {
    VoicePreset.founder_pov.value: (
        "Write as a founder who's been through this. First person ('I', 'we'). "
        "Concrete numbers, real setbacks, no corporate hedging. Short paragraphs. "
        "Never say 'as an entrepreneur' or 'in today's market' — just tell the truth."
    ),
    VoicePreset.contrarian.value: (
        "Take a position that disagrees with conventional wisdom in this space. "
        "Back it with one specific reason or example. Provoke thought — do not "
        "antagonise for its own sake."
    ),
    VoicePreset.story_driven.value: (
        "Open with a concrete moment or scene. Zoom out to the lesson in the middle. "
        "Dialogue and sensory detail are welcome. Avoid generic advice."
    ),
    VoicePreset.data_backed.value: (
        "Lead with a number or stat. Every major claim must be backed by a metric, "
        "reference, or named source. Tone is skeptical and precise."
    ),
    VoicePreset.educational.value: (
        "Teacher voice. Numbered steps or named frameworks. Use analogies. "
        "Assume smart readers, not experts. No fluff between steps."
    ),
    VoicePreset.technical_deep.value: (
        "Assume a technical audience. Use precise terminology. In-line diagrams with "
        "arrows (→, ↔) are encouraged. No oversimplification. No hand-waving."
    ),
    VoicePreset.casual_builder.value: (
        "Indie-hacker energy. Lowercase openers are fine. Self-aware humor. "
        "Words like 'shipping', 'vibes', 'real talk' belong here. Avoid corporate speak."
    ),
}

GOAL_INSTRUCTIONS: dict[str, str] = {
    ContentGoal.clicks.value: (
        "Optimise every format for click-through. Every piece must create a curiosity "
        "gap that only resolves on click. End with a specific, non-generic CTA that "
        "points to SOURCE_URL."
    ),
    ContentGoal.comments.value: (
        "End long-form posts with an open, opinionated question. Include at least one "
        "claim the reader will want to push back on. Prioritise discussion over polish."
    ),
    ContentGoal.authority.value: (
        "Demonstrate expertise through a named framework, a specific insight, or a "
        "counterintuitive observation backed by detail. No generic advice."
    ),
    ContentGoal.promote.value: (
        "Name the product or service naturally (do not invent one if BUSINESS is empty). "
        "Structure: problem → product as solution → outcome. Soft sell in the CTA, "
        "never in the hook."
    ),
    ContentGoal.viral.value: (
        "Hook must land in the first 7 words. Include one counterintuitive claim. "
        "Produce one highly-quotable line per format. Zero fluff."
    ),
}

CTA_INSTRUCTIONS: dict[str, str] = {
    CtaStyle.soft.value: (
        "CTA is a light invitation such as 'Read more →' or 'Full write-up:'. "
        "Do not hard-sell."
    ),
    CtaStyle.hard.value: (
        "CTA is direct and action-oriented — 'Try it free', 'Sign up', 'Start now'. "
        "Use imperative verbs."
    ),
    CtaStyle.curiosity.value: (
        "CTA creates a curiosity gap — 'The one thing that changed everything →' or "
        "'Here's what most people miss:'. Must still resolve to SOURCE_URL."
    ),
    CtaStyle.none.value: (
        "No explicit CTA line. Still include SOURCE_URL at the end of the body for "
        "attribution, but phrase it as a reference, not a call to action."
    ),
}

# Phase B quick-rewrite presets (maps to the `preset` field of RegenerateRequest)
REWRITE_PROMPTS: dict[str, str] = {
    "sharper": (
        "Rewrite to be sharper and more direct: remove qualifiers, tighten verbs, "
        "drop hedging. Every sentence should carry weight. Preserve the core message."
    ),
    "shorter": (
        "Rewrite to be roughly 40% shorter while keeping the strongest idea. "
        "Cut filler, merge redundant points, keep the hook, keep the CTA and URL."
    ),
    "bolder": (
        "Rewrite with a stronger, more confident stance. Remove 'I think', 'perhaps', "
        "'might'. Make one unqualified claim. Keep factual accuracy."
    ),
    "curiosity_gap": (
        "Rewrite the opening to create a curiosity gap — tease a payoff without "
        "revealing it until mid-body. Keep everything after the hook intact."
    ),
    "more_specific": (
        "Rewrite replacing generic statements with specific numbers, names, or examples. "
        "If specifics are not in the source, draw from the blog content provided."
    ),
}


# ---------------------------------------------------------------------------
# Hook-score heuristic (Phase C) — rule-based, 0..100
# Intent: reward specific, direct hooks; penalize AI-cliché patterns.
# ---------------------------------------------------------------------------

_SECOND_PERSON_CUES = (
    "you ", "your ", "you're", "you've", "you'll",
    "here's", "here are", "what most", "most people",
)

_SOFT_HEDGE_WORDS = (
    "perhaps", "maybe", "arguably", "i think", "it seems",
    "in my opinion", "generally", "usually", "often",
)

_STYLE_BONUS_SIGNALS: dict[str, tuple[tuple[str, ...], int]] = {
    "curiosity":  (("?", ":", "…", "the one", "nobody", "no one", "secret", "truth about"), 8),
    "contrarian": (("stop ", "don't ", "won't ", "wrong", "actually", "forget ", "it isn't"), 8),
    "data":       ((), 0),  # handled separately — digits/percentages
    "story":      (("the day", "last year", "last month", "when i ", "i used to", "years ago"), 8),
    "bold":       ((".", "!"), 0),  # handled separately — short + definitive
}

_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)(\s*%)?")


def score_hook(hook: str, style: str = "") -> int:
    """Rule-based hook score 0..100. Intentionally simple — directional, not an LLM judge."""
    if not hook:
        return 0
    text = hook.strip()
    lower = text.lower()
    score = 50

    # Length: short-to-medium rewarded, very long penalized.
    n = len(text)
    if n < 40:
        score += 6
    elif n < 80:
        score += 12
    elif n < 120:
        score += 6
    elif n > 180:
        score -= 10

    # Second-person / reader-focused cues
    if any(c in lower for c in _SECOND_PERSON_CUES):
        score += 8

    # Ends with curiosity-inducing punctuation
    if text.endswith(("?", ":", "…", ".")):
        score += 3
    if text.endswith(("?", ":", "…")):
        score += 3

    # Contains a specific number or percentage
    m = _NUM_RE.search(text)
    if m:
        score += 10
        if m.group(2):  # had "%"
            score += 3

    # Penalise hedging / softening language
    hedges = sum(1 for w in _SOFT_HEDGE_WORDS if w in lower)
    score -= 6 * hedges

    # Heavy penalty for AI-cliché vocabulary
    banned_hits = len(BANNED_CLICHE_RE.findall(text))
    score -= 20 * banned_hits

    # Style-specific signals
    style_key = (style or "").strip().lower()
    if style_key in _STYLE_BONUS_SIGNALS:
        signals, bonus = _STYLE_BONUS_SIGNALS[style_key]
        if signals and any(s in lower for s in signals):
            score += bonus
        if style_key == "data" and m:
            score += 8
        if style_key == "bold" and n < 90 and not text.endswith("?"):
            score += 6

    # First-word punchiness: long opening word is a mild negative for all styles
    first = lower.split(" ", 1)[0] if lower else ""
    if len(first) > 14:
        score -= 4

    return max(0, min(100, score))


BANNED_CLICHE_RE = re.compile(
    r"\b("
    r"unleash|elevate|revolutionize|unlock|landscape|delve|game-changer|"
    r"embark|paradigm|synergy|leverage|cutting-edge|state of the art|"
    r"seamless|robust solution|in today's fast-paced world|"
    r"at the end of the day|the key is|it's important to|make sure to"
    r")\b",
    flags=re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

def _slug_to_hashtag(term: str) -> str:
    if not term:
        return ""
    parts = [p for p in "".join(
        c if c.isalnum() or c.isspace() else " " for c in term
    ).split() if p]
    return "#" + "".join(p.capitalize() for p in parts) if parts else ""


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _scrub_banned(text: str) -> str:
    return BANNED_CLICHE_RE.sub("", text or "")


def _ensure_source_url(text: str, url: str) -> str:
    if not url or url in (text or ""):
        return text
    return f"{(text or '').rstrip()}\n\nRead the full article: {url}"


def _ensure_hashtags(text: str, tags: list[str]) -> str:
    if not tags:
        return text
    existing = (text or "").lower()
    missing = [t for t in tags if t and t.lower() not in existing]
    if not missing:
        return text
    return f"{(text or '').rstrip()}\n\n{' '.join(missing)}"


def _clamp(text: str, max_len: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def _clamp_tweet(t: str, source_url: str, max_len: int = 270) -> str:
    """Clamp a tweet to max_len while preserving a trailing source URL if present."""
    t = (t or "").strip()
    if len(t) <= max_len:
        return t
    url_suffix = ""
    body = t
    if source_url and t.endswith(source_url):
        url_suffix = f" {source_url}"
        body = t[: -len(url_suffix)].rstrip()
    room = max_len - len(url_suffix) - 1
    if room < 20:
        # URL alone would blow the limit; drop it and just clamp.
        return t[: max_len - 1].rstrip() + "…"
    return body[:room].rstrip() + "…" + url_suffix


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_HOOK_RULES = (
    "Return exactly 5 hook variations, one per style in this order: "
    "curiosity, contrarian, data, story, bold.\n"
    "- curiosity: open a loop, max 100 chars, ends with ':' or '…'.\n"
    "- contrarian: disagree with a common belief held in this space.\n"
    "- data: include a specific number, percentage, or named stat.\n"
    "- story: first-person micro-story opening ('The day I…', 'Last month…').\n"
    "- bold: confident, unqualified claim (no 'I think', no hedging)."
)


def _schema_block(platforms: set[str], variations: int) -> str:
    """Build a JSON schema block that only includes the selected platforms."""
    parts: list[str] = []
    parts.append(
        '"hook_variations": [\n'
        '    {"style": "curiosity",  "text": "hook text"},\n'
        '    {"style": "contrarian", "text": "hook text"},\n'
        '    {"style": "data",       "text": "hook text"},\n'
        '    {"style": "story",      "text": "hook text"},\n'
        '    {"style": "bold",       "text": "hook text"}\n'
        "  ]"
    )

    def _plural_field(key: str, description: str) -> str:
        n = variations
        examples = ",\n    ".join(
            [f'"{description} — angle {i+1}"' for i in range(n)]
        )
        return f'"{key}": [\n    {examples}\n  ]'

    if "linkedin" in platforms:
        parts.append(
            _plural_field(
                "linkedin_posts",
                "800-1500 char LinkedIn post. Strong hook line 1. Short paragraphs. End with CTA + SOURCE_URL",
            )
        )
    if "twitter" in platforms:
        parts.append(
            '"twitter_thread": [\n'
            '    "tweet 1 — strong hook, <= 270 chars",\n'
            '    "tweet 2", "tweet 3", "tweet 4",\n'
            '    "final tweet — ends with SOURCE_URL"\n'
            "  ]"
        )
    if "email" in platforms:
        parts.append(
            '"email": {\n'
            '    "subject": "<= 70 char subject",\n'
            '    "body": "greeting, 3-4 short paragraphs, CTA, SOURCE_URL"\n'
            "  }"
        )
    if "youtube" in platforms:
        parts.append(
            '"youtube_description": "short hook, 3-4 bullets, SOURCE_URL, 5-8 hashtags"'
        )
    if "instagram" in platforms:
        parts.append(
            _plural_field(
                "instagram_captions",
                "scroll-stopping hook, 3-4 short lines, emojis sparingly, 'Link in bio 👇', 5-8 hashtags",
            )
        )
    if "facebook" in platforms:
        parts.append(
            _plural_field(
                "facebook_posts",
                "conversational 300-500 char post ending with SOURCE_URL + 2-3 hashtags",
            )
        )
    if "quotes" in platforms:
        parts.append('"quote_cards": ["quote 1 (<=120 chars)", "quote 2", "quote 3"]')
    if "carousel" in platforms:
        parts.append(
            '"carousel_outline": [\n'
            '    "Slide 1: hook title",\n'
            '    "Slide 2: …", "Slide 3: …", "Slide 4: …",\n'
            '    "Slide 5: CTA + SOURCE_URL"\n'
            "  ]"
        )

    return "{\n  " + ",\n  ".join(parts) + "\n}"


_BULK_VOICE_ROTATION = [
    (VoicePreset.founder_pov.value,    "founder POV"),
    (VoicePreset.contrarian.value,     "contrarian"),
    (VoicePreset.story_driven.value,   "story-driven"),
    (VoicePreset.data_backed.value,    "data-backed"),
    (VoicePreset.educational.value,    "educational"),
]


def _build_prompt(
    *,
    blog_title: str,
    blog_content: str,
    source_url: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    voice: str,
    goal: str,
    cta_style: str,
    platforms: list[str],
    variations_per_platform: int,
    include_hook_variations: bool,
    business_name: str,
    niche: str,
    variations_across_voices: bool = False,
) -> str:
    sec_csv = ", ".join(secondary_keywords[:5]) or "(none)"
    business_line = (
        f"{business_name} ({niche})" if business_name or niche else "(not provided)"
    )
    platform_set = set(platforms)
    schema = _schema_block(platform_set, variations_per_platform)

    voice_block = VOICE_INSTRUCTIONS.get(voice, VOICE_INSTRUCTIONS[VoicePreset.founder_pov.value])
    goal_block = GOAL_INSTRUCTIONS.get(goal, GOAL_INSTRUCTIONS[ContentGoal.authority.value])
    cta_block = CTA_INSTRUCTIONS.get(cta_style, CTA_INSTRUCTIONS[CtaStyle.soft.value])

    hook_section = _HOOK_RULES if include_hook_variations else (
        "Return hook_variations as an empty array — the caller does not want hooks."
    )

    # Voice block: single voice, OR a rotation of voices (one per variant)
    voice_directive: str
    if variations_across_voices and variations_per_platform > 1:
        rotation = _BULK_VOICE_ROTATION[:variations_per_platform]
        rotation_lines = "\n".join(
            f"  - Variant {i + 1}: {label} voice — {VOICE_INSTRUCTIONS[key]}"
            for i, (key, label) in enumerate(rotation)
        )
        voice_directive = (
            "VOICE — BULK ACROSS STYLES:\n"
            "For LinkedIn/Instagram/Facebook variants, rotate voice by index "
            "(do not apply the single base voice to all). Use this exact mapping:\n"
            f"{rotation_lines}\n"
            "All other sections (email, YouTube, twitter_thread, quotes, carousel, "
            f"hook_variations) stay in the single base voice — {voice}:\n"
            f"{voice_block}"
        )
    else:
        voice_directive = f"VOICE — {voice}:\n{voice_block}"

    return f"""Transform the following blog into distribution-ready content for the requested platforms.

BLOG TITLE: {blog_title}
SOURCE_URL: {source_url}
PRIMARY_KEYWORD: {primary_keyword}
SECONDARY_KEYWORDS: {sec_csv}
BUSINESS: {business_line}

{voice_directive}

GOAL — {goal}:
{goal_block}

CTA_STYLE — {cta_style}:
{cta_block}

PLATFORMS REQUESTED: {", ".join(platforms)}
VARIATIONS per LinkedIn/Instagram/Facebook: {variations_per_platform}

{hook_section}

BLOG CONTENT (truncated):
---
{blog_content[:4000]}
---

Return a single JSON object exactly matching this shape (omit keys for any platform not in PLATFORMS REQUESTED):

{schema}

Hard rules:
- Write ONLY for the platforms in PLATFORMS REQUESTED. Omit unrequested keys entirely.
- Include SOURCE_URL verbatim in every format (final tweet, last carousel slide, end of each long-form post).
- Each Twitter tweet must be 270 characters or fewer.
- Email subject must be 70 characters or fewer.
- NEVER use: unleash, elevate, revolutionize, unlock, landscape, delve, game-changer, embark, paradigm, synergy, leverage, cutting-edge, state of the art, seamless, robust solution, "in today's fast-paced world", "at the end of the day", "the key is", "it's important to", "make sure to".
- Weave PRIMARY_KEYWORD plus 1-2 secondary keywords into each format (no stuffing, no parentheses).
- Obey VOICE and GOAL strictly — they override generic best practices.
- Output valid JSON only. No markdown fences, no preamble.
"""


# ---------------------------------------------------------------------------
# Parsing / coercion
# ---------------------------------------------------------------------------

def _as_str(v) -> str:
    return v if isinstance(v, str) else ""


def _as_list_str(v) -> list[str]:
    if isinstance(v, list):
        return [x for x in (str(i).strip() for i in v) if x]
    return []


def _coerce_formats(parsed: dict) -> dict:
    """Ensure every expected key exists with a sane default type."""
    email = parsed.get("email") or {}
    if not isinstance(email, dict):
        email = {}

    # Support both plural (new) and singular (legacy) LLM outputs for linkedin/ig/fb.
    def _plural_or_singular(plural_key: str, singular_key: str) -> list[str]:
        plural = _as_list_str(parsed.get(plural_key))
        if plural:
            return plural
        single = _as_str(parsed.get(singular_key))
        return [single] if single.strip() else []

    linkedin_posts = _plural_or_singular("linkedin_posts", "linkedin_post")
    instagram_captions = _plural_or_singular("instagram_captions", "instagram_caption")
    facebook_posts = _plural_or_singular("facebook_posts", "facebook_post")

    # Hook variations
    raw_hooks = parsed.get("hook_variations") or []
    hooks: list[dict] = []
    if isinstance(raw_hooks, list):
        for h in raw_hooks:
            if isinstance(h, dict):
                style = _as_str(h.get("style")).lower().strip()
                text = _as_str(h.get("text")).strip()
                if style in {"curiosity", "contrarian", "data", "story", "bold"} and text:
                    hooks.append({"style": style, "text": text, "score": 0})

    return {
        "hook_variations": hooks,
        "linkedin_posts": linkedin_posts,
        "linkedin_post": linkedin_posts[0] if linkedin_posts else "",
        "twitter_thread": _as_list_str(parsed.get("twitter_thread")),
        "email": {
            "subject": _as_str(email.get("subject")),
            "body": _as_str(email.get("body")),
        },
        "youtube_description": _as_str(parsed.get("youtube_description")),
        "instagram_captions": instagram_captions,
        "instagram_caption": instagram_captions[0] if instagram_captions else "",
        "facebook_posts": facebook_posts,
        "facebook_post": facebook_posts[0] if facebook_posts else "",
        "quote_cards": _as_list_str(parsed.get("quote_cards")),
        "carousel_outline": _as_list_str(parsed.get("carousel_outline")),
    }


# ---------------------------------------------------------------------------
# Deterministic fallbacks — never let the UI show empty tiles
# ---------------------------------------------------------------------------

_HOOK_FALLBACKS: dict[str, str] = {
    "curiosity":  "Most people get {kw} completely backwards. Here's the part that matters:",
    "contrarian": "Everyone says {kw} is about scale. It isn't.",
    "data":       "3 out of 5 {kw} attempts fail for the same reason.",
    "story":      "The day I changed how I think about {kw}, everything shifted.",
    "bold":       "{kw} doesn't work the way you were told.",
}


def _fill_missing_hooks(existing: list[dict], primary_keyword: str) -> list[dict]:
    have = {h["style"] for h in existing}
    kw = primary_keyword.strip() or "this"
    for style, template in _HOOK_FALLBACKS.items():
        if style not in have:
            existing.append({
                "style": style,
                "text": template.format(kw=kw),
                "score": 0,
            })
    # Re-order to canonical order
    order = {"curiosity": 0, "contrarian": 1, "data": 2, "story": 3, "bold": 4}
    existing.sort(key=lambda h: order.get(h["style"], 99))
    return existing


# ---------------------------------------------------------------------------
# Platform filtering
# ---------------------------------------------------------------------------

_PLATFORM_KEYS: dict[str, list[str]] = {
    "linkedin":  ["linkedin_posts", "linkedin_post"],
    "twitter":   ["twitter_thread"],
    "email":     ["email"],
    "youtube":   ["youtube_description"],
    "instagram": ["instagram_captions", "instagram_caption"],
    "facebook":  ["facebook_posts", "facebook_post"],
    "quotes":    ["quote_cards"],
    "carousel":  ["carousel_outline"],
}


def _zero_unselected(formats: dict, platforms: set[str]) -> dict:
    for plat, keys in _PLATFORM_KEYS.items():
        if plat not in platforms:
            for k in keys:
                if k == "email":
                    formats[k] = {"subject": "", "body": ""}
                elif isinstance(formats.get(k), list):
                    formats[k] = []
                else:
                    formats[k] = ""
    return formats


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def repurpose_content(
    *,
    blog_title: str,
    blog_content: str,
    source_url: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    voice: str = VoicePreset.founder_pov.value,
    goal: str = ContentGoal.authority.value,
    cta_style: str = CtaStyle.soft.value,
    platforms: list[str] | None = None,
    variations_per_platform: int = 1,
    include_hook_variations: bool = True,
    variations_across_voices: bool = False,
    business_name: str = "",
    niche: str = "",
) -> dict:
    """Generate platform-native distribution formats from a blog.

    One LLM call produces everything the caller asked for (respecting `platforms`
    and `variations_per_platform`); post-processing guarantees the source URL and
    SEO hashtags are present, trims length limits, scrubs cliché words, and fills
    any missing hook variations with deterministic templates.
    """
    if not (blog_content or "").strip():
        raise ValueError("blog_content is required")

    if not platforms:
        platforms = list(ALL_PLATFORMS)
    platform_set = set(platforms)
    variations_per_platform = max(1, min(5, int(variations_per_platform)))

    prompt = _build_prompt(
        blog_title=blog_title or "",
        blog_content=blog_content,
        source_url=source_url or "",
        primary_keyword=primary_keyword or "",
        secondary_keywords=secondary_keywords or [],
        voice=voice,
        goal=goal,
        cta_style=cta_style,
        platforms=platforms,
        variations_per_platform=variations_per_platform,
        include_hook_variations=include_hook_variations,
        business_name=business_name,
        niche=niche,
        variations_across_voices=variations_across_voices,
    )

    raw = call_llm_with_fallback(
        prompt,
        system=(
            "You are a senior content strategist who has written for indie founders, "
            "SaaS companies, and developer brands. You write like a human operator, "
            "not a corporate blog. No AI clichés. No hedging. Specifics over generics."
        ),
        temperature=0.6,
        expect_json=True,
        caller=f"repurpose[{voice}/{goal}]",
    )

    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("LLM JSON is not an object")
    except Exception as e:
        logger.error(f"[repurpose] Failed to parse LLM JSON: {e}. Head: {cleaned[:400]!r}")
        raise ValueError("Failed to parse LLM response as JSON")

    formats = _coerce_formats(parsed)

    # Hook variations: fill gaps with deterministic fallbacks so UI is never empty.
    if include_hook_variations:
        formats["hook_variations"] = _fill_missing_hooks(
            formats["hook_variations"], primary_keyword or blog_title or ""
        )
    else:
        formats["hook_variations"] = []

    # SEO tag pool: primary + up to 3 secondary
    tag_pool = [_slug_to_hashtag(primary_keyword)] + [
        _slug_to_hashtag(k) for k in (secondary_keywords or [])[:3]
    ]
    tag_pool = [t for t in tag_pool if t]

    # --- Scrub cliché words across every string field ---
    def _scrub_list(xs: list[str]) -> list[str]:
        return [_scrub_banned(x) for x in xs]

    formats["linkedin_posts"] = _scrub_list(formats["linkedin_posts"])
    formats["instagram_captions"] = _scrub_list(formats["instagram_captions"])
    formats["facebook_posts"] = _scrub_list(formats["facebook_posts"])
    formats["twitter_thread"] = _scrub_list(formats["twitter_thread"])
    formats["quote_cards"] = _scrub_list(formats["quote_cards"])
    formats["carousel_outline"] = _scrub_list(formats["carousel_outline"])
    formats["youtube_description"] = _scrub_banned(formats["youtube_description"])
    formats["email"]["body"] = _scrub_banned(formats["email"]["body"])
    formats["hook_variations"] = [
        {**h, "text": _scrub_banned(h["text"])} for h in formats["hook_variations"]
    ]

    # --- Source URL guarantees (selected platforms only) ---
    if source_url:
        if "linkedin" in platform_set:
            formats["linkedin_posts"] = [_ensure_source_url(p, source_url) for p in formats["linkedin_posts"]]
        if "instagram" in platform_set:
            formats["instagram_captions"] = [_ensure_source_url(p, source_url) for p in formats["instagram_captions"]]
        if "facebook" in platform_set:
            formats["facebook_posts"] = [_ensure_source_url(p, source_url) for p in formats["facebook_posts"]]
        if "youtube" in platform_set:
            formats["youtube_description"] = _ensure_source_url(formats["youtube_description"], source_url)
        if "email" in platform_set:
            formats["email"]["body"] = _ensure_source_url(formats["email"]["body"], source_url)
        if "twitter" in platform_set:
            if formats["twitter_thread"]:
                last = len(formats["twitter_thread"]) - 1
                if source_url not in formats["twitter_thread"][last]:
                    formats["twitter_thread"][last] = (
                        formats["twitter_thread"][last].rstrip() + f" {source_url}"
                    )
            else:
                formats["twitter_thread"] = [f"Read the full article: {source_url}"]
        if "carousel" in platform_set and formats["carousel_outline"]:
            last = len(formats["carousel_outline"]) - 1
            if source_url not in formats["carousel_outline"][last]:
                formats["carousel_outline"][last] = (
                    formats["carousel_outline"][last].rstrip() + f" — {source_url}"
                )

    # --- Hashtag guarantees on hashtag-friendly surfaces ---
    if tag_pool:
        if "linkedin" in platform_set:
            formats["linkedin_posts"] = [_ensure_hashtags(p, tag_pool) for p in formats["linkedin_posts"]]
        if "instagram" in platform_set:
            formats["instagram_captions"] = [_ensure_hashtags(p, tag_pool) for p in formats["instagram_captions"]]
        if "facebook" in platform_set:
            formats["facebook_posts"] = [_ensure_hashtags(p, tag_pool[:3]) for p in formats["facebook_posts"]]
        if "youtube" in platform_set:
            formats["youtube_description"] = _ensure_hashtags(formats["youtube_description"], tag_pool)

    # --- Length clamps + hook scoring ---
    formats["email"]["subject"] = _clamp(formats["email"]["subject"], 70)
    formats["twitter_thread"] = [_clamp_tweet(t, source_url) for t in formats["twitter_thread"]]
    formats["hook_variations"] = [
        {
            **h,
            "text": _clamp(h["text"], 220),
            "score": score_hook(_clamp(h["text"], 220), h.get("style", "")),
        }
        for h in formats["hook_variations"]
    ]

    # --- Refresh deprecated singulars from plurals post-scrub ---
    formats["linkedin_post"] = formats["linkedin_posts"][0] if formats["linkedin_posts"] else ""
    formats["instagram_caption"] = formats["instagram_captions"][0] if formats["instagram_captions"] else ""
    formats["facebook_post"] = formats["facebook_posts"][0] if formats["facebook_posts"] else ""

    # --- Zero out any platform the caller didn't request (LLM may have overshared) ---
    formats = _zero_unselected(formats, platform_set)

    logger.info(
        "[repurpose] voice=%s goal=%s platforms=%s vpp=%d hooks=%d li=%d ig=%d fb=%d tweets=%d quotes=%d slides=%d",
        voice, goal, sorted(platform_set), variations_per_platform,
        len(formats["hook_variations"]),
        len(formats["linkedin_posts"]), len(formats["instagram_captions"]), len(formats["facebook_posts"]),
        len(formats["twitter_thread"]), len(formats["quote_cards"]), len(formats["carousel_outline"]),
    )
    return formats


# ---------------------------------------------------------------------------
# Phase B — per-section regeneration
# ---------------------------------------------------------------------------

# Map user-facing section slug → (schema_key, output_shape)
# output_shape: "string" | "string_list" | "email" | "hooks"
_SECTION_SPEC: dict[str, tuple[str, str]] = {
    "hook_variations": ("hook_variations",   "hooks"),
    "linkedin":        ("linkedin_posts",    "string_list"),
    "twitter_thread":  ("twitter_thread",    "string_list"),
    "email":           ("email",             "email"),
    "youtube":         ("youtube_description","string"),
    "instagram":       ("instagram_captions","string_list"),
    "facebook":        ("facebook_posts",    "string_list"),
    "quotes":          ("quote_cards",       "string_list"),
    "carousel":        ("carousel_outline",  "string_list"),
}


def _section_schema(section: str, variants: int = 1) -> str:
    _, shape = _SECTION_SPEC[section]
    if shape == "hooks":
        return (
            '{"hook_variations": [\n'
            '  {"style":"curiosity","text":"hook"},\n'
            '  {"style":"contrarian","text":"hook"},\n'
            '  {"style":"data","text":"hook"},\n'
            '  {"style":"story","text":"hook"},\n'
            '  {"style":"bold","text":"hook"}\n'
            "]}"
        )
    if shape == "email":
        return (
            '{"email": {"subject": "<=70 char subject", '
            '"body": "email body with CTA and SOURCE_URL"}}'
        )
    if shape == "string_list":
        if section == "twitter_thread":
            return (
                '{"twitter_thread": ["hook tweet","tweet 2","tweet 3","tweet 4",'
                '"final tweet ending with SOURCE_URL"]}'
            )
        if section == "quotes":
            return '{"quote_cards": ["quote 1","quote 2","quote 3"]}'
        if section == "carousel":
            return (
                '{"carousel_outline": ["Slide 1: hook","Slide 2: …","Slide 3: …",'
                '"Slide 4: …","Slide 5: CTA + SOURCE_URL"]}'
            )
        # linkedin/instagram/facebook — N variants
        key = _SECTION_SPEC[section][0]
        examples = ",".join(
            [f'"{section} post — angle {i + 1}"' for i in range(max(1, variants))]
        )
        return f'{{"{key}": [{examples}]}}'
    # single string
    key = _SECTION_SPEC[section][0]
    return f'{{"{key}": "platform-native content ending with SOURCE_URL"}}'


def _build_section_prompt(
    *,
    section: str,
    variants: int,
    blog_title: str,
    blog_content: str,
    source_url: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    voice: str,
    goal: str,
    cta_style: str,
    preset: str | None,
    instruction: str | None,
    existing_value: str,
    business_name: str,
    niche: str,
) -> str:
    sec_csv = ", ".join(secondary_keywords[:5]) or "(none)"
    business_line = (
        f"{business_name} ({niche})" if business_name or niche else "(not provided)"
    )
    voice_block = VOICE_INSTRUCTIONS.get(voice, VOICE_INSTRUCTIONS[VoicePreset.founder_pov.value])
    goal_block = GOAL_INSTRUCTIONS.get(goal, GOAL_INSTRUCTIONS[ContentGoal.authority.value])
    cta_block = CTA_INSTRUCTIONS.get(cta_style, CTA_INSTRUCTIONS[CtaStyle.soft.value])
    preset_block = REWRITE_PROMPTS.get(preset or "", "") if preset else ""
    user_instruction = (instruction or "").strip()

    directive_lines: list[str] = []
    if preset_block:
        directive_lines.append(f"REWRITE DIRECTIVE ({preset}): {preset_block}")
    if user_instruction:
        directive_lines.append(f"USER INSTRUCTION: {user_instruction}")
    if not directive_lines:
        directive_lines.append(
            "Regenerate this section with a fresh angle — keep the core message but "
            "use a different opening line and supporting points."
        )
    directive = "\n".join(directive_lines)

    existing_block = ""
    if existing_value:
        existing_block = (
            "CURRENT VERSION (rewrite this, do not copy verbatim):\n---\n"
            f"{existing_value[:2000]}\n---\n"
        )

    schema = _section_schema(section, variants)

    return f"""Regenerate ONLY the '{section}' section of a repurposed blog post.

BLOG TITLE: {blog_title}
SOURCE_URL: {source_url}
PRIMARY_KEYWORD: {primary_keyword}
SECONDARY_KEYWORDS: {sec_csv}
BUSINESS: {business_line}

VOICE — {voice}:
{voice_block}

GOAL — {goal}:
{goal_block}

CTA_STYLE — {cta_style}:
{cta_block}

{directive}

{existing_block}BLOG CONTENT (truncated):
---
{blog_content[:3000]}
---

Return a single JSON object with exactly this shape:
{schema}

Hard rules:
- Include SOURCE_URL verbatim in every format (final tweet, last carousel slide, end of each long-form post).
- Each Twitter tweet must be 270 characters or fewer.
- Email subject must be 70 characters or fewer.
- NEVER use: unleash, elevate, revolutionize, unlock, landscape, delve, game-changer, embark, paradigm, synergy, leverage, cutting-edge, state of the art, seamless, robust solution, "in today's fast-paced world", "at the end of the day", "the key is", "it's important to", "make sure to".
- Weave PRIMARY_KEYWORD naturally (no stuffing).
- Output valid JSON only. No markdown fences, no preamble.
"""


def _postprocess_section(
    section: str,
    value,  # list | dict | str
    *,
    source_url: str,
    primary_keyword: str,
    secondary_keywords: list[str],
) -> object:
    """Apply the same source-url / hashtag / clamp / scrub guarantees
    as the full-run pipeline, but scoped to one section."""
    tag_pool = [_slug_to_hashtag(primary_keyword)] + [
        _slug_to_hashtag(k) for k in (secondary_keywords or [])[:3]
    ]
    tag_pool = [t for t in tag_pool if t]

    if section == "hook_variations":
        hooks = value if isinstance(value, list) else []
        clean: list[dict] = []
        for h in hooks:
            if isinstance(h, dict):
                style = _as_str(h.get("style")).lower().strip()
                text = _scrub_banned(_as_str(h.get("text")).strip())
                if style in {"curiosity", "contrarian", "data", "story", "bold"} and text:
                    clamped = _clamp(text, 220)
                    clean.append({
                        "style": style,
                        "text": clamped,
                        "score": score_hook(clamped, style),
                    })
        clean = _fill_missing_hooks(clean, primary_keyword)
        # Score any fallback-filled hooks too
        clean = [
            {**h, "score": h.get("score") or score_hook(h.get("text", ""), h.get("style", ""))}
            for h in clean
        ]
        return clean

    if section == "email":
        email = value if isinstance(value, dict) else {}
        subject = _clamp(_scrub_banned(_as_str(email.get("subject"))), 70)
        body = _scrub_banned(_as_str(email.get("body")))
        body = _ensure_source_url(body, source_url)
        return {"subject": subject, "body": body}

    if section == "twitter_thread":
        tweets = _as_list_str(value) if isinstance(value, list) else []
        tweets = [_scrub_banned(t) for t in tweets]
        if tweets and source_url and source_url not in tweets[-1]:
            tweets[-1] = tweets[-1].rstrip() + f" {source_url}"
        if not tweets and source_url:
            tweets = [f"Read the full article: {source_url}"]
        tweets = [_clamp_tweet(t, source_url) for t in tweets]
        return tweets

    if section == "carousel":
        slides = _as_list_str(value) if isinstance(value, list) else []
        slides = [_scrub_banned(s) for s in slides]
        if slides and source_url and source_url not in slides[-1]:
            slides[-1] = slides[-1].rstrip() + f" — {source_url}"
        return slides

    if section == "quotes":
        quotes = _as_list_str(value) if isinstance(value, list) else []
        return [_scrub_banned(q) for q in quotes]

    if section in ("linkedin", "instagram", "facebook"):
        posts = _as_list_str(value) if isinstance(value, list) else []
        posts = [_scrub_banned(p) for p in posts]
        posts = [_ensure_source_url(p, source_url) for p in posts]
        if section in ("linkedin", "instagram"):
            posts = [_ensure_hashtags(p, tag_pool) for p in posts]
        elif section == "facebook":
            posts = [_ensure_hashtags(p, tag_pool[:3]) for p in posts]
        return posts

    if section == "youtube":
        desc = _scrub_banned(_as_str(value))
        desc = _ensure_source_url(desc, source_url)
        desc = _ensure_hashtags(desc, tag_pool)
        return desc

    return value


def regenerate_section(
    *,
    section: str,
    variant_index: int,
    preset: str | None,
    instruction: str | None,
    existing_formats: dict,           # current full `formats` dict from the save
    blog_title: str,
    blog_content: str,
    source_url: str,
    primary_keyword: str,
    secondary_keywords: list[str],
    voice: str,
    goal: str,
    cta_style: str,
    variations_per_platform: int,
    business_name: str = "",
    niche: str = "",
) -> dict:
    """Regenerate one section of a Repurpose save, merge into the existing formats
    dict, and return the updated formats dict (ready to persist + return to UI).
    """
    if section not in _SECTION_SPEC:
        raise ValueError(f"Unknown section: {section}")

    schema_key, shape = _SECTION_SPEC[section]

    # Determine how many variants to ask for on this section
    if section in ("linkedin", "instagram", "facebook"):
        variants = max(1, min(5, variations_per_platform))
    else:
        variants = 1

    # Pull the existing value for the LLM to see (variant-aware for plural sections)
    existing_value = ""
    existing_field = existing_formats.get(schema_key)
    if shape == "email" and isinstance(existing_field, dict):
        existing_value = (
            f"Subject: {existing_field.get('subject','')}\n\n{existing_field.get('body','')}"
        )
    elif shape == "string":
        existing_value = _as_str(existing_field)
    elif shape == "string_list":
        if section in ("linkedin", "instagram", "facebook"):
            xs = _as_list_str(existing_field)
            if 0 <= variant_index < len(xs):
                existing_value = xs[variant_index]
        else:
            existing_value = "\n".join(_as_list_str(existing_field))
    elif shape == "hooks":
        hooks = existing_field if isinstance(existing_field, list) else []
        existing_value = "\n".join(
            f"- [{h.get('style','?')}] {h.get('text','')}" for h in hooks if isinstance(h, dict)
        )

    prompt = _build_section_prompt(
        section=section,
        variants=variants,
        blog_title=blog_title,
        blog_content=blog_content,
        source_url=source_url,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
        voice=voice,
        goal=goal,
        cta_style=cta_style,
        preset=preset,
        instruction=instruction,
        existing_value=existing_value,
        business_name=business_name,
        niche=niche,
    )

    raw = call_llm_with_fallback(
        prompt,
        system=(
            "You are a senior content strategist. You write like a human operator, "
            "not a corporate blog. No AI clichés. No hedging. Output valid JSON only."
        ),
        temperature=0.65,
        expect_json=True,
        caller=f"repurpose.regen[{section}]",
    )

    cleaned = _strip_fences(raw)
    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("Section JSON is not an object")
    except Exception as e:
        logger.error(f"[repurpose.regen] JSON parse failed ({section}): {e}. Head: {cleaned[:300]!r}")
        raise ValueError("Failed to parse LLM response as JSON")

    new_value = parsed.get(schema_key)
    if new_value is None:
        # Some LLMs return the bare value without wrapping — accept it
        new_value = parsed

    processed = _postprocess_section(
        section,
        new_value,
        source_url=source_url,
        primary_keyword=primary_keyword,
        secondary_keywords=secondary_keywords,
    )

    # Merge into existing_formats
    merged = dict(existing_formats)

    if section in ("linkedin", "instagram", "facebook"):
        # Plural array — replace single variant if the user asked for one, else replace whole list
        current = _as_list_str(merged.get(schema_key))
        new_list = processed if isinstance(processed, list) else []
        if variations_per_platform > 1 and 0 <= variant_index < max(1, len(current)):
            # Replace only that variant; fill new_list[0] into position
            if not new_list:
                new_list = [existing_value]
            while len(current) <= variant_index:
                current.append("")
            current[variant_index] = new_list[0]
            merged[schema_key] = current
        else:
            merged[schema_key] = new_list or current
        # Refresh deprecated singular mirror
        singular_key = {
            "linkedin": "linkedin_post",
            "instagram": "instagram_caption",
            "facebook": "facebook_post",
        }[section]
        plural = merged.get(schema_key) or []
        merged[singular_key] = plural[0] if plural else ""
    else:
        merged[schema_key] = processed

    logger.info(
        "[repurpose.regen] section=%s variant=%d preset=%s instr=%s",
        section, variant_index, preset, bool(instruction),
    )
    return merged
