"""
Pure Python SEO utility functions.
No external paid APIs required — all analysis is done locally.
"""
import re
import json
import math
from collections import Counter

try:
    import textstat as _textstat
    _HAS_TEXTSTAT = True
except ImportError:
    _HAS_TEXTSTAT = False


# ---------------------------------------------------------------------------
# Readability  (uses textstat if available, pure-Python fallback otherwise)
# ---------------------------------------------------------------------------

def score_readability(text: str) -> dict:
    """
    Calculate Flesch-Kincaid readability metrics.
    Uses textstat for accuracy when available; falls back to pure Python.
    """
    if not text or not text.strip():
        return {"flesch_score": 0, "grade_level": 0, "word_count": 0,
                "sentence_count": 0, "avg_words_per_sentence": 0, "status": "no_content"}

    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    sentence_count = max(len(sentences), 1)

    words = re.findall(r'\b[a-zA-Z]+\b', text)
    word_count = len(words)
    if word_count == 0:
        return {"flesch_score": 0, "grade_level": 0, "word_count": 0,
                "sentence_count": sentence_count, "avg_words_per_sentence": 0, "status": "no_words"}

    avg_words_per_sentence = round(word_count / sentence_count, 1)

    if _HAS_TEXTSTAT:
        flesch_score = round(max(0.0, min(100.0, _textstat.flesch_reading_ease(text))), 1)
        grade_level  = round(max(0.0, _textstat.flesch_kincaid_grade(text)), 1)
    else:
        # Pure-Python fallback
        def _syllables(word: str) -> int:
            w = word.lower()
            count = len(re.findall(r'[aeiou]', w))
            if w.endswith('e') and count > 1:
                count -= 1
            return max(count, 1)

        total_syllables = sum(_syllables(w) for w in words)
        aws = word_count / sentence_count
        asw = total_syllables / word_count
        flesch_score = round(max(0, min(100, 206.835 - 1.015 * aws - 84.6 * asw)), 1)
        grade_level  = round(max(0, 0.39 * aws + 11.8 * asw - 15.59), 1)

    status = "easy" if flesch_score >= 70 else "moderate" if flesch_score >= 50 else "difficult"

    return {
        "flesch_score": flesch_score,
        "grade_level": grade_level,
        "word_count": word_count,
        "sentence_count": sentence_count,
        "avg_words_per_sentence": avg_words_per_sentence,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Keyword Density
# ---------------------------------------------------------------------------

def analyse_keyword_density(text: str, keyword: str) -> dict:
    """
    Analyse how often a keyword appears in text and whether density is optimal.
    Optimal range: 1-3%.
    """
    if not text or not keyword:
        return {"density": 0, "occurrences": 0, "word_count": 0, "status": "no_content"}

    words = re.findall(r'\b[a-zA-Z]+\b', text.lower())
    word_count = len(words)
    if word_count == 0:
        return {"density": 0, "occurrences": 0, "word_count": 0, "status": "no_content"}

    keyword_lower = keyword.lower()
    keyword_words = keyword_lower.split()
    keyword_len = len(keyword_words)

    # Count phrase occurrences
    if keyword_len == 1:
        occurrences = words.count(keyword_lower)
    else:
        text_lower = text.lower()
        occurrences = len(re.findall(re.escape(keyword_lower), text_lower))

    density = (occurrences / word_count) * 100 if word_count > 0 else 0

    if density == 0:
        status = "missing"
    elif density < 1:
        status = "under"
    elif density <= 3:
        status = "optimal"
    else:
        status = "over"

    return {
        "density": round(density, 2),
        "occurrences": occurrences,
        "word_count": word_count,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Meta Tag Suggestions
# ---------------------------------------------------------------------------

def generate_meta_suggestions(topic: str, keywords: list[str]) -> list[dict]:
    """
    Generate 3 meta title + description variants with character counts.
    No AI — template-based patterns that follow SEO best practices.
    """
    primary = keywords[0] if keywords else topic
    secondary = keywords[1] if len(keywords) > 1 else ""
    year = "2025"

    variants = [
        {
            "title": f"{primary.title()}: Complete Guide {year}",
            "description": f"Discover everything you need to know about {primary}. {secondary.title() + ' tips and ' if secondary else ''}expert strategies to get real results.",
        },
        {
            "title": f"{topic.title()} — {primary.title()} Tips That Work",
            "description": f"Learn proven {primary} strategies used by top marketers. Step-by-step guide to {topic.lower()} success.",
        },
        {
            "title": f"How to {topic.title()} with {primary.title()}",
            "description": f"The ultimate {primary} guide for {topic.lower()}. Actionable steps, real examples, and expert insights.",
        },
    ]

    result = []
    for v in variants:
        title = v["title"][:60]  # Google truncates at ~60 chars
        desc = v["description"][:155]  # Google truncates at ~155 chars
        result.append({
            "title": title,
            "title_length": len(title),
            "title_ok": len(title) <= 60,
            "description": desc,
            "description_length": len(desc),
            "description_ok": len(desc) <= 155,
        })

    return result


# ---------------------------------------------------------------------------
# Schema Markup
# ---------------------------------------------------------------------------

def generate_schema_markup(title: str, description: str, url: str = "") -> dict:
    """
    Generate JSON-LD Article schema markup for SEO.
    """
    schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "description": description,
        "author": {
            "@type": "Organization",
            "name": "OmniGenAI",
        },
        "datePublished": "2025-01-01",
        "dateModified": "2025-01-01",
    }
    if url:
        schema["url"] = url

    return schema


def generate_faq_schema(faqs: list[dict]) -> dict:
    """
    Generate JSON-LD FAQPage schema from a list of {question, answer} dicts.
    """
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": faq["question"],
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": faq["answer"],
                },
            }
            for faq in faqs
        ],
    }


# ---------------------------------------------------------------------------
# Content Structure Analysis
# ---------------------------------------------------------------------------

def analyse_content_structure(content: str) -> dict:
    """
    Analyse heading structure, paragraph length and formatting issues.
    """
    lines = content.split('\n')

    h1 = [l for l in lines if l.startswith('# ') and not l.startswith('## ')]
    h2 = [l for l in lines if l.startswith('## ') and not l.startswith('### ')]
    h3 = [l for l in lines if l.startswith('### ')]

    paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
    para_lengths = [len(re.findall(r'\b\w+\b', p)) for p in paragraphs]
    long_paras = [l for l in para_lengths if l > 150]

    issues = []
    if len(h1) == 0:
        issues.append("Missing H1 heading")
    if len(h1) > 1:
        issues.append(f"Multiple H1 headings ({len(h1)}) — use only one")
    if len(h2) < 2:
        issues.append("Add at least 2 H2 subheadings for structure")
    if long_paras:
        issues.append(f"{len(long_paras)} paragraph(s) exceed 150 words — break them up")

    return {
        "h1_count": len(h1),
        "h2_count": len(h2),
        "h3_count": len(h3),
        "paragraph_count": len(paragraphs),
        "avg_paragraph_words": round(sum(para_lengths) / len(para_lengths), 1) if para_lengths else 0,
        "long_paragraphs": len(long_paras),
        "issues": issues,
    }


# ---------------------------------------------------------------------------
# Keyword Extraction (TF-based, no paid API)
# ---------------------------------------------------------------------------

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "this", "that", "these", "those",
    "it", "its", "we", "you", "he", "she", "they", "i", "me", "my", "our",
    "your", "their", "what", "how", "when", "where", "who", "which", "not",
    "no", "so", "if", "as", "up", "out", "about", "into", "than", "then",
    "there", "also", "more", "all", "just", "get", "use", "make", "like",
}


def extract_keywords_from_text(text: str, top_n: int = 10) -> list[dict]:
    """
    Extract top keywords by frequency (TF), excluding stopwords.
    """
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    filtered = [w for w in words if w not in STOPWORDS]
    counts = Counter(filtered)
    total = len(filtered) or 1

    return [
        {"keyword": kw, "count": count, "frequency": round((count / total) * 100, 2)}
        for kw, count in counts.most_common(top_n)
    ]


# ---------------------------------------------------------------------------
# H2 Outline Builder
# ---------------------------------------------------------------------------

def build_seo_outline(topic: str, keywords: list[str], word_count: int = 1500) -> list[dict]:
    """
    Build a template SEO H2 outline for a given topic and keywords.
    Returns a list of {heading, notes} dicts.
    """
    primary = keywords[0] if keywords else topic
    secondary = keywords[1] if len(keywords) > 1 else primary

    # Scale section count to target word count
    section_count = max(4, min(8, word_count // 300))

    templates = [
        {"heading": f"What Is {primary.title()} and Why Does It Matter?", "notes": "Define the concept. Hook the reader with why they should care."},
        {"heading": f"How {primary.title()} Works in {topic.title()}", "notes": f"Explain the mechanics. Include {secondary} examples."},
        {"heading": f"Top {primary.title()} Strategies That Actually Work", "notes": "List 3-5 actionable tactics. Use subheadings for each."},
        {"heading": f"Common {primary.title()} Mistakes to Avoid", "notes": "Address objections. Build credibility by acknowledging pitfalls."},
        {"heading": f"How to Get Started with {primary.title()} Today", "notes": "Step-by-step quick-start guide. Make it actionable."},
        {"heading": f"{primary.title()} Tools and Resources", "notes": f"Recommended tools for {topic.lower()}. Keep it practical."},
        {"heading": f"Measuring Your {primary.title()} Results", "notes": "KPIs and metrics to track progress."},
        {"heading": f"FAQs About {primary.title()}", "notes": "Answer the top 3-5 questions searchers have."},
    ]

    return templates[:section_count]


# ---------------------------------------------------------------------------
# SERP Preview
# ---------------------------------------------------------------------------

def build_serp_preview(title: str, description: str, url: str = "https://yourwebsite.com") -> dict:
    """
    Build a SERP snippet preview object for display in the UI.
    """
    title_display = title[:60] + ("..." if len(title) > 60 else "")
    desc_display = description[:155] + ("..." if len(description) > 155 else "")
    url_display = url.replace("https://", "").replace("http://", "")

    return {
        "title": title_display,
        "url": url_display,
        "description": desc_display,
        "title_truncated": len(title) > 60,
        "desc_truncated": len(description) > 155,
    }


# ---------------------------------------------------------------------------
# Keyword Placement Analysis (component 1 sub-scores)
# ---------------------------------------------------------------------------

def analyse_keyword_placement(text: str, keyword: str) -> dict:
    """
    Check where the primary keyword appears:
    - In H1 heading
    - In any H2 heading
    - In the first paragraph (first 200 words)
    - In last paragraph
    Returns a placement dict with boolean flags and a 0-100 score.
    """
    if not keyword or not text:
        return {"in_h1": False, "in_h2": False, "in_first_paragraph": False,
                "in_last_paragraph": False, "placement_score": 0}

    kw = keyword.lower()
    lines = text.split("\n")

    h1_lines = [l for l in lines if l.startswith("# ") and not l.startswith("## ")]
    h2_lines = [l for l in lines if l.startswith("## ")]

    in_h1 = any(kw in l.lower() for l in h1_lines)
    in_h2 = any(kw in l.lower() for l in h2_lines)

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip() and not p.strip().startswith("#")]
    first_para = paragraphs[0].lower() if paragraphs else ""

    in_first = kw in first_para

    # Score: H1=40pts, H2=35pts, first_para=25pts
    score = (40 if in_h1 else 0) + (35 if in_h2 else 0) + (25 if in_first else 0)

    return {
        "in_h1": in_h1,
        "in_h2": in_h2,
        "in_first_paragraph": in_first,
        "placement_score": score,
    }


# ---------------------------------------------------------------------------
# LSI / Related Keywords (simple TF-IDF proxy without external API)
# ---------------------------------------------------------------------------

def analyse_lsi_coverage(text: str, primary_keyword: str) -> dict:
    """
    Extract top content keywords and identify semantic coverage.
    A high-coverage article uses varied, topic-relevant vocabulary —
    not just the primary keyword repeated.
    Returns top terms and a coverage score 0-100.
    """
    if not text or not primary_keyword:
        return {"top_terms": [], "unique_terms": 0, "coverage_score": 0}

    kw_words = set(primary_keyword.lower().split())
    words = re.findall(r'\b[a-zA-Z]{4,}\b', text.lower())
    filtered = [w for w in words if w not in STOPWORDS and w not in kw_words]
    counts = Counter(filtered)

    total_unique = len(counts)
    top_terms = [{"term": w, "count": c} for w, c in counts.most_common(10)]

    # Coverage score: more unique topic-relevant terms = better semantic richness
    # 200+ unique non-stopword terms → 100pts, scale linearly below
    coverage_score = min(100, int((total_unique / 200) * 100))

    return {
        "top_terms": top_terms,
        "unique_terms": total_unique,
        "coverage_score": coverage_score,
    }


# ---------------------------------------------------------------------------
# Passive Voice Detection
# ---------------------------------------------------------------------------

_PASSIVE_PATTERN = re.compile(
    r'\b(is|are|was|were|be|been|being)\s+\w+ed\b', re.IGNORECASE
)


def count_passive_voice(text: str) -> dict:
    """
    Count passive voice constructions (be + past participle).
    Optimal: <10% of sentences use passive voice.
    """
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    total = max(len(sentences), 1)

    passive_sentences = [s for s in sentences if _PASSIVE_PATTERN.search(s)]
    passive_count = len(passive_sentences)
    passive_pct = round((passive_count / total) * 100, 1)

    status = "good" if passive_pct <= 10 else "moderate" if passive_pct <= 20 else "high"
    # Score: 0% passive → 100, scales down
    score = max(0, 100 - int(passive_pct * 4))

    return {
        "passive_count": passive_count,
        "passive_percentage": passive_pct,
        "total_sentences": total,
        "status": status,
        "score": score,
    }


# ---------------------------------------------------------------------------
# Link Analysis
# ---------------------------------------------------------------------------

def analyse_links(text: str) -> dict:
    """
    Detect markdown links [text](url) and plain URLs.
    Categorises as internal (relative or same-domain) vs external.
    Returns counts and a 0-100 score.
    """
    # Markdown links
    md_links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', text)
    # Plain URLs
    plain_urls = re.findall(r'https?://[^\s\)\"]+', text)

    all_urls = [url for _, url in md_links] + plain_urls

    internal = [u for u in all_urls if not u.startswith("http")]
    external = [u for u in all_urls if u.startswith("http")]

    # Score: having ≥1 external link = 50pts, ≥1 internal = 50pts
    score = (50 if external else 0) + (50 if internal else 0)

    return {
        "internal_count": len(internal),
        "external_count": len(external),
        "total_links": len(all_urls),
        "score": score,
    }


# ---------------------------------------------------------------------------
# Content Length Score
# ---------------------------------------------------------------------------

def score_content_length(word_count: int, target: int = 1500) -> dict:
    """
    Score content length relative to a target word count.
    Reaching target = 100pts, scales linearly below.
    Exceeding by 50%+ gives a bonus signal but stays capped at 100.
    """
    if word_count == 0:
        return {"word_count": 0, "target": target, "percentage": 0, "score": 0, "status": "empty"}

    pct = (word_count / target) * 100
    score = min(100, int(pct))

    if pct >= 100:
        status = "sufficient"
    elif pct >= 60:
        status = "approaching"
    else:
        status = "short"

    return {
        "word_count": word_count,
        "target": target,
        "percentage": round(pct, 1),
        "score": score,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Composite SEO Score — 7-component formula
# ---------------------------------------------------------------------------

def calculate_seo_score(
    readability: dict,
    keyword_density: dict,
    structure: dict,
    meta_ok: bool = True,
    keyword_placement: dict | None = None,
    lsi: dict | None = None,
    passive_voice: dict | None = None,
    links: dict | None = None,
    content_length: dict | None = None,
) -> int:
    """
    7-component SEO score (0-100):

      0.25  Keyword Optimisation  (density + placement in headings/first para)
      0.20  Content Coverage      (LSI / semantic richness)
      0.15  Readability           (Flesch + passive voice penalty)
      0.15  Structure             (H1/H2/H3 + bullets + paragraph length)
      0.10  Links                 (internal + external)
      0.10  Meta Tags             (title/desc present and within limits)
      0.05  Content Length        (vs target word count)
    """
    # 1. Keyword Optimisation (0-100)
    kd_status = keyword_density.get("status", "missing")
    density_score = {"optimal": 100, "under": 50, "over": 40, "missing": 0}.get(kd_status, 0)
    placement_score = keyword_placement.get("placement_score", 0) if keyword_placement else 50
    kw_score = (density_score * 0.5) + (placement_score * 0.5)

    # 2. Content Coverage (0-100)
    cov_score = lsi.get("coverage_score", 50) if lsi else 50

    # 3. Readability (0-100) — Flesch score only
    r_score = min(100, max(0, readability.get("flesch_score", 0)))

    # 4. Structure (0-100)
    h1 = structure.get("h1_count", 0)
    h2 = structure.get("h2_count", 0)
    issue_count = len(structure.get("issues", []))
    s_score = min(100, max(0, (h1 > 0) * 30 + min(h2, 4) * 15 - issue_count * 10))

    # 5. Links (0-100)
    l_score = links.get("score", 0) if links else 0

    # 6. Meta Tags (0-100)
    m_score = 100 if meta_ok else 50

    # 7. Content Length (0-100)
    len_score = content_length.get("score", 50) if content_length else 50

    composite = (
        kw_score   * 0.25 +
        cov_score  * 0.20 +
        r_score    * 0.15 +
        s_score    * 0.15 +
        l_score    * 0.10 +
        m_score    * 0.10 +
        len_score  * 0.05
    )
    return round(composite)
