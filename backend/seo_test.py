"""
SEO Test Script
---------------
Usage:
    python seo_test.py <path/to/article.html> [--keyword "your keyword"] [--target-words 1500] [--url https://example.com]

Examples:
    python seo_test.py article.html
    python seo_test.py article.html --keyword "content marketing"
    python seo_test.py article.html --keyword "SEO tips" --target-words 2000 --url https://myblog.com/seo-tips
"""

import sys
import argparse
import json
import re
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: beautifulsoup4 not installed. Run: pip install beautifulsoup4 lxml")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Add backend root to sys.path so app.services imports work
# ---------------------------------------------------------------------------
BACKEND_ROOT = Path(__file__).parent
sys.path.insert(0, str(BACKEND_ROOT))

try:
    from app.services.seo_tools import (
        analyse_content_structure,
        analyse_keyword_density,
        analyse_keyword_placement,
        analyse_lsi_coverage,
        analyse_links,
        build_serp_preview,
        calculate_seo_score,
        count_passive_voice,
        extract_keywords_from_text,
        generate_meta_suggestions,
        generate_schema_markup,
        score_content_length,
        score_readability,
    )
except ImportError as e:
    print(f"ERROR: Could not import seo_tools: {e}")
    print("Make sure you are running this from the backend directory with the venv activated.")
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTML → structured text helpers
# ---------------------------------------------------------------------------

def _html_to_markdown_headings(soup: BeautifulSoup) -> str:
    """
    Convert HTML headings (h1-h3) and paragraphs into markdown-style text
    so that analyse_content_structure() can work correctly.
    """
    chunks: list[str] = []
    for tag in soup.find_all(["h1", "h2", "h3", "p", "li"]):
        text = tag.get_text(strip=True)
        if not text:
            continue
        if tag.name == "h1":
            chunks.append(f"# {text}")
        elif tag.name == "h2":
            chunks.append(f"## {text}")
        elif tag.name == "h3":
            chunks.append(f"### {text}")
        elif tag.name in ("p", "li"):
            chunks.append(text)
            chunks.append("")          # blank line between paragraphs
    return "\n".join(chunks)


def _extract_plain_text(soup: BeautifulSoup) -> str:
    """Return clean plain text (no tags) for density / readability analysis."""
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return soup.get_text(separator=" ", strip=True)


def _extract_links_as_markdown(soup: BeautifulSoup) -> str:
    """Convert <a href> tags into markdown link syntax for analyse_links()."""
    parts: list[str] = []
    for a in soup.find_all("a", href=True):
        label = a.get_text(strip=True) or a["href"]
        parts.append(f"[{label}]({a['href']})")
    return " ".join(parts)


def _extract_meta(soup: BeautifulSoup) -> tuple[str, str]:
    """Return (title, meta_description) from the HTML <head>."""
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    desc_tag = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    description = ""
    if desc_tag:
        description = desc_tag.get("content", "")

    return title, description


# ---------------------------------------------------------------------------
# Pretty printing helpers
# ---------------------------------------------------------------------------

RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"
CYAN   = "\033[36m"
WHITE  = "\033[97m"


def _color(text: str, color: str) -> str:
    return f"{color}{text}{RESET}"


def _section(title: str) -> None:
    width = 60
    print(f"\n{BOLD}{CYAN}{'=' * width}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'=' * width}{RESET}")


def _row(label: str, value, *, ok: bool | None = None) -> None:
    color = GREEN if ok is True else (RED if ok is False else WHITE)
    print(f"  {label:<35} {_color(str(value), color)}")


def _score_bar(score: int, width: int = 20) -> str:
    filled = int((score / 100) * width)
    bar = "█" * filled + "░" * (width - filled)
    color = GREEN if score >= 70 else (YELLOW if score >= 40 else RED)
    return f"{_color(bar, color)}  {_color(str(score) + '/100', color)}"


def _status_color(status: str) -> str:
    mapping = {
        "optimal": GREEN, "good": GREEN, "easy": GREEN, "sufficient": GREEN,
        "moderate": YELLOW, "under": YELLOW, "approaching": YELLOW,
        "difficult": RED, "over": RED, "high": RED, "missing": RED, "short": RED, "empty": RED,
    }
    return _color(status, mapping.get(status.lower(), WHITE))


# ---------------------------------------------------------------------------
# Main report
# ---------------------------------------------------------------------------

def run_seo_report(
    html_path: str,
    keyword: str = "",
    target_words: int = 1500,
    url: str = "https://yourwebsite.com",
) -> None:
    # ── Load HTML ──────────────────────────────────────────────────────
    path = Path(html_path)
    if not path.exists():
        print(f"ERROR: File not found: {html_path}")
        sys.exit(1)

    html_content = path.read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(html_content, "lxml")

    # ── Extract components ────────────────────────────────────────────
    plain_text   = _extract_plain_text(BeautifulSoup(html_content, "lxml"))
    md_text      = _html_to_markdown_headings(soup)
    link_text    = _extract_links_as_markdown(soup)
    meta_title, meta_desc = _extract_meta(soup)

    # Auto-detect primary keyword if not given
    if not keyword:
        top_kws = extract_keywords_from_text(plain_text, top_n=1)
        keyword = top_kws[0]["keyword"] if top_kws else "unknown"
        print(f"\n{YELLOW}No keyword supplied — auto-detected: '{keyword}'{RESET}")

    # ── Run all analyses ──────────────────────────────────────────────
    readability     = score_readability(plain_text)
    kw_density      = analyse_keyword_density(plain_text, keyword)
    kw_placement    = analyse_keyword_placement(md_text, keyword)
    structure       = analyse_content_structure(md_text)
    lsi             = analyse_lsi_coverage(plain_text, keyword)
    passive         = count_passive_voice(plain_text)
    links           = analyse_links(link_text)
    content_len     = score_content_length(readability["word_count"], target_words)
    top_keywords    = extract_keywords_from_text(plain_text, top_n=15)
    meta_ok         = bool(meta_title and meta_desc and len(meta_title) <= 60 and len(meta_desc) <= 155)

    seo_score = calculate_seo_score(
        readability=readability,
        keyword_density=kw_density,
        structure=structure,
        meta_ok=meta_ok,
        keyword_placement=kw_placement,
        lsi=lsi,
        passive_voice=passive,
        links=links,
        content_length=content_len,
    )

    meta_suggestions = generate_meta_suggestions(keyword, [kw["keyword"] for kw in top_keywords[:5]])
    serp_preview     = build_serp_preview(meta_title or keyword.title(), meta_desc, url)
    schema           = generate_schema_markup(meta_title or keyword.title(), meta_desc or plain_text[:120], url)

    # ================================================================
    # REPORT OUTPUT
    # ================================================================

    print(f"\n{BOLD}{WHITE}SEO ANALYSIS REPORT{RESET}")
    print(f"{WHITE}File   : {path.name}{RESET}")
    print(f"{WHITE}Keyword: {keyword}{RESET}")

    # ── Overall Score ─────────────────────────────────────────────────
    _section("OVERALL SEO SCORE")
    print(f"\n  {_score_bar(seo_score)}\n")

    # ── Meta Tags ─────────────────────────────────────────────────────
    _section("META TAGS")
    _row("Title",            meta_title or "(not found)", ok=bool(meta_title))
    _row("Title length",     f"{len(meta_title)} chars",  ok=0 < len(meta_title) <= 60)
    _row("Description",      (meta_desc[:80] + "…") if len(meta_desc) > 80 else (meta_desc or "(not found)"),
         ok=bool(meta_desc))
    _row("Description length", f"{len(meta_desc)} chars", ok=0 < len(meta_desc) <= 155)

    # ── Content Structure ─────────────────────────────────────────────
    _section("CONTENT STRUCTURE")
    _row("H1 headings",      structure["h1_count"],       ok=structure["h1_count"] == 1)
    _row("H2 headings",      structure["h2_count"],       ok=structure["h2_count"] >= 2)
    _row("H3 headings",      structure["h3_count"])
    _row("Paragraphs",       structure["paragraph_count"])
    _row("Avg paragraph words", structure["avg_paragraph_words"])
    _row("Long paragraphs (>150w)", structure["long_paragraphs"], ok=structure["long_paragraphs"] == 0)
    if structure["issues"]:
        print(f"\n  {_color('Issues:', YELLOW)}")
        for issue in structure["issues"]:
            print(f"    {_color('⚠ ', YELLOW)}{issue}")

    # ── Content Length ────────────────────────────────────────────────
    _section("CONTENT LENGTH")
    _row("Word count",       content_len["word_count"],   ok=content_len["status"] == "sufficient")
    _row("Target",           f"{target_words} words")
    _row("Coverage",         f"{content_len['percentage']}%")
    _row("Status",           _status_color(content_len["status"]))
    _row("Score",            f"{content_len['score']}/100")

    # ── Readability ───────────────────────────────────────────────────
    _section("READABILITY")
    _row("Flesch score",     readability["flesch_score"],  ok=readability["flesch_score"] >= 60)
    _row("Grade level",      readability["grade_level"])
    _row("Sentences",        readability["sentence_count"])
    _row("Avg words/sentence", readability["avg_words_per_sentence"], ok=readability["avg_words_per_sentence"] <= 20)
    _row("Readability status", _status_color(readability["status"]))

    # ── Passive Voice ─────────────────────────────────────────────────
    _section("PASSIVE VOICE")
    _row("Passive sentences",    passive["passive_count"])
    _row("Total sentences",      passive["total_sentences"])
    _row("Passive %",            f"{passive['passive_percentage']}%",  ok=passive["passive_percentage"] <= 10)
    _row("Status",               _status_color(passive["status"]))
    _row("Score",                f"{passive['score']}/100")

    # ── Keyword Analysis ──────────────────────────────────────────────
    _section(f"KEYWORD ANALYSIS  ─  '{keyword}'")
    _row("Occurrences",          kw_density["occurrences"])
    _row("Density",              f"{kw_density['density']}%",           ok=kw_density["status"] == "optimal")
    _row("Density status",       _status_color(kw_density["status"]))
    print()
    _row("In H1",                "✓" if kw_placement["in_h1"] else "✗",          ok=kw_placement["in_h1"])
    _row("In H2",                "✓" if kw_placement["in_h2"] else "✗",          ok=kw_placement["in_h2"])
    _row("In first paragraph",   "✓" if kw_placement["in_first_paragraph"] else "✗",
         ok=kw_placement["in_first_paragraph"])
    _row("Placement score",      f"{kw_placement['placement_score']}/100")

    # ── LSI / Semantic Coverage ───────────────────────────────────────
    _section("SEMANTIC COVERAGE (LSI)")
    _row("Unique content terms",  lsi["unique_terms"])
    _row("Coverage score",        f"{lsi['coverage_score']}/100",       ok=lsi["coverage_score"] >= 60)
    print(f"\n  {'Top semantic terms':}")
    for item in lsi["top_terms"][:10]:
        bar = "▪" * min(item["count"], 20)
        print(f"    {item['term']:<20} {item['count']:>3}x  {_color(bar, CYAN)}")

    # ── Top Keywords ──────────────────────────────────────────────────
    _section("TOP EXTRACTED KEYWORDS")
    for i, kw in enumerate(top_keywords, 1):
        print(f"  {i:>2}. {kw['keyword']:<25} {kw['count']:>3}x  ({kw['frequency']}%)")

    # ── Links ─────────────────────────────────────────────────────────
    _section("LINKS")
    _row("Internal links",   links["internal_count"],   ok=links["internal_count"] >= 1)
    _row("External links",   links["external_count"],   ok=links["external_count"] >= 1)
    _row("Total links",      links["total_links"])
    _row("Score",            f"{links['score']}/100")

    # ── SERP Preview ─────────────────────────────────────────────────
    _section("SERP PREVIEW")
    print(f"\n  {_color(serp_preview['title'], CYAN)}")
    print(f"  {_color(serp_preview['url'], GREEN)}")
    print(f"  {serp_preview['description']}")
    if serp_preview["title_truncated"]:
        print(f"  {_color('⚠ Title will be truncated in Google', YELLOW)}")
    if serp_preview["desc_truncated"]:
        print(f"  {_color('⚠ Description will be truncated in Google', YELLOW)}")

    # ── Meta Suggestions ─────────────────────────────────────────────
    _section("META TAG SUGGESTIONS")
    for i, v in enumerate(meta_suggestions, 1):
        ok_t = _color("✓", GREEN) if v["title_ok"] else _color("✗", RED)
        ok_d = _color("✓", GREEN) if v["description_ok"] else _color("✗", RED)
        print(f"\n  Variant {i}:")
        print(f"    Title [{v['title_length']}] {ok_t}  {v['title']}")
        print(f"    Desc  [{v['description_length']}] {ok_d}  {v['description']}")

    # ── Schema Markup ─────────────────────────────────────────────────
    _section("JSON-LD SCHEMA MARKUP")
    print(json.dumps(schema, indent=4))

    # ── Score Breakdown ───────────────────────────────────────────────
    _section("SCORE BREAKDOWN  (weighted components)")
    components = [
        ("Keyword Optimisation (25%)",  int(
            ({"optimal": 100, "under": 50, "over": 40, "missing": 0}.get(kw_density["status"], 0) * 0.5)
            + (kw_placement["placement_score"] * 0.5)
        )),
        ("Semantic Coverage    (20%)",  lsi["coverage_score"]),
        ("Readability          (15%)",  min(100, int(readability["flesch_score"]))),
        ("Content Structure    (15%)",  min(100, max(0,
            (structure["h1_count"] > 0) * 30
            + min(structure["h2_count"], 4) * 15
            - len(structure["issues"]) * 10
        ))),
        ("Links                (10%)",  links["score"]),
        ("Meta Tags            (10%)",  100 if meta_ok else 50),
        ("Content Length       ( 5%)",  content_len["score"]),
    ]
    for label, comp_score in components:
        bar = _score_bar(comp_score, width=15)
        print(f"  {label:<34} {bar}")

    print(f"\n  {'FINAL SEO SCORE':<34} {_score_bar(seo_score, width=15)}\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyse an HTML article file for SEO metrics.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("html_file", help="Path to the HTML article file")
    parser.add_argument("--keyword",      "-k", default="",     help="Primary target keyword")
    parser.add_argument("--target-words", "-t", default=1500, type=int, help="Target word count (default: 1500)")
    parser.add_argument("--url",          "-u", default="https://yourwebsite.com", help="Canonical URL for schema/SERP preview")

    args = parser.parse_args()
    run_seo_report(
        html_path=args.html_file,
        keyword=args.keyword,
        target_words=args.target_words,
        url=args.url,
    )


if __name__ == "__main__":
    main()
