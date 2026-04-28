import json
import logging
import os
import re
import time
import warnings
from collections import Counter

import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, quote

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def _fetch_html(url: str, timeout: float = 15.0) -> BeautifulSoup | None:
    """Fetch a URL and return a BeautifulSoup object, or None on failure."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = httpx.get(url, headers=_HEADERS, timeout=timeout,
                             follow_redirects=True, verify=False)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.debug("[SCRAPER] fetch failed for %s: %s", url, e)
        return None


def _find_inner_pages(soup: BeautifulSoup, base_url: str) -> dict[str, str]:
    """
    Find relevant inner page URLs (about, services, contact, products).
    Returns a dict like {"about": "https://...", "services": "https://..."}.
    Only matches links that are on the same domain to avoid external URLs.
    """
    from urllib.parse import urlparse

    base_domain = urlparse(base_url).netloc
    page_patterns = {
        "about":    ["about", "about-us", "aboutus", "who-we-are", "our-story", "our-team", "company"],
        "services": ["services", "service", "what-we-do", "solutions", "offerings"],
        "products": ["products", "product", "all-products", "shop", "store", "catalogue", "catalog"],
        "contact":  ["contact", "contact-us", "contactus", "get-in-touch", "reach-us", "support"],
    }
    found: dict[str, str] = {}

    for link in soup.find_all("a", href=True):
        href: str = link["href"]
        full_url = urljoin(base_url, href)
        # Only follow same-domain links
        if urlparse(full_url).netloc != base_domain:
            continue
        path = urlparse(full_url).path.lower().rstrip("/")
        text = link.get_text(strip=True).lower()

        for page_type, keywords in page_patterns.items():
            if page_type in found:
                continue
            if any(kw in path or kw == text for kw in keywords):
                found[page_type] = full_url

        if len(found) == len(page_patterns):
            break

    return found


def scrape_website(url: str) -> dict:
    """
    Scrape a business website for AI content generation context.
    Fetches homepage + up to 3 key inner pages (about, services, contact).
    Returns a rich context dict ready to be stored and injected into AI prompts.
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    result = {
        "url": url,
        "title": "",
        "meta_description": "",
        "main_content": "",
        "about_content": "",
        "services_content": "",
        "contact_info": "",
        "pages_scraped": [],
        "logo_url": None,
        "favicon_url": None,
        "primary_color": None,
        "secondary_color": None,
        "color_palette": [],
        "social_links": {},
    }

    logger.info("[SCRAPER] Starting website scrape: %s", url)

    # ── Homepage ────────────────────────────────────────────────────────
    soup = _fetch_html(url)
    if soup is None:
        raise Exception(f"Could not reach {url}")

    title_tag = soup.find("title")
    if title_tag:
        result["title"] = title_tag.get_text(strip=True)

    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        result["meta_description"] = meta_desc["content"]
    else:
        og_desc = soup.find("meta", attrs={"property": "og:description"})
        if og_desc and og_desc.get("content"):
            result["meta_description"] = og_desc["content"]

    result["main_content"] = _extract_main_content(soup)[:3000]
    result["pages_scraped"].append(url)

    # Collect every scraped soup so we can merge social + contact across pages
    all_soups: list[tuple[str, BeautifulSoup]] = [(url, soup)]

    # ── Brand assets (logo, colors) — homepage is most reliable here ───
    try:
        result["logo_url"] = _extract_logo(soup, url)
        result["favicon_url"] = _extract_favicon(soup, url)
        colors = _extract_brand_colors(soup, url)
        result["primary_color"] = colors["primary"]
        result["secondary_color"] = colors["secondary"]
        result["color_palette"] = colors["palette"]
    except Exception as e:
        logger.warning("[SCRAPER] Brand asset extraction failed: %s", e)

    # ── Inner pages ─────────────────────────────────────────────────────
    inner_pages = _find_inner_pages(soup, url)
    logger.info("[SCRAPER] Found inner pages: %s", list(inner_pages.keys()))

    if "about" in inner_pages:
        about_soup = _fetch_html(inner_pages["about"], timeout=10.0)
        if about_soup:
            result["about_content"] = _extract_main_content(about_soup)[:2000]
            result["pages_scraped"].append(inner_pages["about"])
            all_soups.append((inner_pages["about"], about_soup))

    if "services" in inner_pages or "products" in inner_pages:
        sp_url = inner_pages.get("services") or inner_pages.get("products")
        sp_soup = _fetch_html(sp_url, timeout=10.0)
        if sp_soup:
            result["services_content"] = _extract_main_content(sp_soup)[:2000]
            result["pages_scraped"].append(sp_url)
            all_soups.append((sp_url, sp_soup))

    # Always fetch contact page if found — best source for emails/phones/socials
    if "contact" in inner_pages:
        contact_soup = _fetch_html(inner_pages["contact"], timeout=10.0)
        if contact_soup:
            if inner_pages["contact"] not in result["pages_scraped"]:
                result["pages_scraped"].append(inner_pages["contact"])
            all_soups.append((inner_pages["contact"], contact_soup))

    # ── Merge contact + social across ALL scraped pages ────────────────
    contact_parts: list[str] = []
    social_links: dict[str, str] = {}
    for _page_url, page_soup in all_soups:
        for part in _extract_contact_info(page_soup).split("; "):
            part = part.strip()
            if part and part not in contact_parts:
                contact_parts.append(part)
        for net, link in _extract_social_links(page_soup).items():
            if net not in social_links:
                social_links[net] = link

    result["contact_info"] = "; ".join(contact_parts)
    result["social_links"] = social_links

    logger.info(
        "[SCRAPER] Done — title=%r pages=%d logo=%s primary=%s social=%d contact=%s",
        result["title"][:50],
        len(result["pages_scraped"]),
        "yes" if result["logo_url"] else "no",
        result["primary_color"],
        len(social_links),
        "yes" if contact_parts else "no",
    )
    return result


def _extract_main_content(soup: BeautifulSoup) -> str:
    """Extract clean main text content from a page."""
    for element in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        element.decompose()

    # Prefer semantic tags first
    for tag in ("main", "article"):
        el = soup.find(tag)
        if el:
            return el.get_text(separator=" ", strip=True)

    # Fall back to a div with content-related class
    for div in soup.find_all("div", class_=True):
        classes = " ".join(div.get("class", [])).lower()
        if any(term in classes for term in ("content", "main", "article")):
            text = div.get_text(separator=" ", strip=True)
            if len(text) > 200:
                return text

    body = soup.find("body")
    return body.get_text(separator=" ", strip=True) if body else ""


def _find_about_page(soup: BeautifulSoup, base_url: str) -> str | None:
    """Find the About page URL if it exists."""
    about_keywords = ["about", "about-us", "about_us", "who-we-are", "our-story", "company"]

    for link in soup.find_all("a", href=True):
        href = link.get("href", "").lower()
        text = link.get_text(strip=True).lower()

        if any(keyword in href or keyword in text for keyword in about_keywords):
            return urljoin(base_url, link["href"])

    return None


# Email is matched only inside mailto: links to avoid false positives.
# Phones come from tel: links OR a strict plain-text pattern that requires
# either a leading '+' (country code) or parentheses around the area code.
_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
)
_STRICT_PHONE_RE = re.compile(
    # Must start with + (international) OR ( (US-style area code) — this
    # avoids matching plain numbers like years, prices, page counts, etc.
    r"(?:\+\d{1,3}[\s.\-]?\d{1,4}[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4}"
    r"|\(\d{2,4}\)\s?\d{3,4}[\s.\-]?\d{3,4})"
)


def _looks_like_phone(s: str) -> bool:
    """Sanity check: 8–15 digits, not just a sequence of common false positives."""
    digits = "".join(c for c in s if c.isdigit())
    if not (8 <= len(digits) <= 15):
        return False
    # Reject if all digits are the same (e.g. "0000000000")
    if len(set(digits)) == 1:
        return False
    # Reject if it's just a list of 4-digit years separated by spaces/commas
    parts = re.split(r"[\s,;]+", s.strip())
    if all(p.isdigit() and len(p) == 4 and 1900 <= int(p) <= 2100 for p in parts if p):
        return False
    return True


def _extract_contact_info(soup: BeautifulSoup) -> str:
    """Extract contact information from explicit links + strict text patterns."""
    contact_parts: list[str] = []
    seen_emails: set[str] = set()
    seen_phones: set[str] = set()

    # 1. mailto: links — most reliable email source
    for link in soup.find_all("a", href=lambda x: x and x.startswith("mailto:")):
        email = link["href"].replace("mailto:", "").split("?")[0].strip().lower()
        if email and "@" in email and email not in seen_emails:
            seen_emails.add(email)
            contact_parts.append(f"Email: {email}")
            if len(seen_emails) >= 2:
                break

    # 2. tel: links — most reliable phone source
    for link in soup.find_all("a", href=lambda x: x and x.startswith("tel:")):
        phone = link["href"].replace("tel:", "").strip()
        if phone and _looks_like_phone(phone) and phone not in seen_phones:
            seen_phones.add(phone)
            contact_parts.append(f"Phone: {phone}")
            if len(seen_phones) >= 2:
                break

    # 3. Email plain-text fallback (footer only — body too noisy)
    if not seen_emails:
        footer = soup.find("footer")
        if footer:
            for m in _EMAIL_RE.findall(footer.get_text(" ", strip=True)):
                em = m.strip().lower()
                if em.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
                    continue
                if em not in seen_emails:
                    seen_emails.add(em)
                    contact_parts.append(f"Email: {em}")
                    if len(seen_emails) >= 2:
                        break

    # 4. Phone plain-text fallback — STRICT pattern, footer only.
    #    Skipped entirely if no tel: links found AND no strict-format match.
    if not seen_phones:
        footer = soup.find("footer")
        if footer:
            footer_text = footer.get_text(" ", strip=True)
            for m in _STRICT_PHONE_RE.findall(footer_text):
                phone = m.strip()
                if not _looks_like_phone(phone):
                    continue
                if phone not in seen_phones:
                    seen_phones.add(phone)
                    contact_parts.append(f"Phone: {phone}")
                    if len(seen_phones) >= 2:
                        break

    # 5. Address
    address_elements = soup.find_all(
        ["address", "div", "p"],
        class_=lambda x: x and "address" in str(x).lower(),
    )
    if not address_elements:
        address_tag = soup.find("address")
        if address_tag:
            address_elements = [address_tag]
    for elem in address_elements[:1]:
        address = elem.get_text(separator=" ", strip=True)
        if address and 10 < len(address) < 200:
            contact_parts.append(f"Address: {address}")

    return "; ".join(contact_parts)


# ---------------------------------------------------------------------------
# Brand asset extractors (logo, colors, social links)
# ---------------------------------------------------------------------------

def _extract_logo(soup: BeautifulSoup, base_url: str) -> str | None:
    """Find the most likely logo URL using deterministic priority rules."""
    # 1. <img> with logo class / alt / src
    for img in soup.find_all("img"):
        src = (img.get("src") or img.get("data-src") or "").strip()
        if not src:
            continue
        cls = " ".join(img.get("class", [])).lower()
        alt = (img.get("alt") or "").lower()
        if "logo" in cls or "logo" in alt or "/logo" in src.lower() or "logo." in src.lower():
            return urljoin(base_url, src)

    # 2. <link rel="apple-touch-icon">
    apple = soup.find("link", rel=lambda r: r and "apple-touch-icon" in (
        " ".join(r) if isinstance(r, list) else r
    ).lower())
    if apple and apple.get("href"):
        return urljoin(base_url, apple["href"])

    # 3. og:image
    og = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
    if og and og.get("content"):
        return urljoin(base_url, og["content"])

    # 4. twitter:image
    tw = soup.find("meta", attrs={"name": "twitter:image"})
    if tw and tw.get("content"):
        return urljoin(base_url, tw["content"])

    return None


def _extract_favicon(soup: BeautifulSoup, base_url: str) -> str:
    """Return the favicon URL, defaulting to /favicon.ico."""
    for rel_match in ("icon", "shortcut icon"):
        icon = soup.find("link", rel=lambda r: r and rel_match in (
            " ".join(r) if isinstance(r, list) else r
        ).lower())
        if icon and icon.get("href"):
            return urljoin(base_url, icon["href"])
    return urljoin(base_url, "/favicon.ico")


def _is_neutral_color(hex_color: str) -> bool:
    """Skip whites, blacks, and grays — they're rarely brand colors."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return True
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return True
    if max(r, g, b) > 240 and min(r, g, b) > 240:
        return True
    if max(r, g, b) < 20:
        return True
    return (max(r, g, b) - min(r, g, b)) < 25


def _normalize_hex(c: str) -> str:
    c = c.strip().lower()
    if c.startswith("#") and len(c) == 4:
        return "#" + "".join(ch * 2 for ch in c[1:])
    return c


def _extract_brand_colors(soup: BeautifulSoup, base_url: str) -> dict:
    """Extract brand colors via theme-color → CSS variables → frequency analysis."""
    primary: str | None = None
    secondary: str | None = None

    # 1. theme-color meta — strong signal but skip neutrals
    theme = soup.find("meta", attrs={"name": "theme-color"})
    if theme and theme.get("content"):
        candidate = theme["content"].strip()
        if candidate.startswith("#"):
            normalized = _normalize_hex(candidate)
            if not _is_neutral_color(normalized):
                primary = normalized

    # 2. Collect CSS text from <style> + the first stylesheet only.
    # Bounded fetching keeps Brand Kit save latency predictable on slow sites.
    css_text = ""
    for style in soup.find_all("style"):
        css_text += style.get_text() + "\n"

    stylesheet_links = soup.find_all("link", rel="stylesheet")[:1]
    for link in stylesheet_links:
        href = link.get("href")
        if not href:
            continue
        try:
            full_url = urljoin(base_url, href)
            r = httpx.get(
                full_url,
                timeout=2.0,
                headers=_HEADERS,
                follow_redirects=True,
            )
            if r.status_code == 200:
                css_text += r.text + "\n"
        except Exception:
            continue

    # 3. CSS variables
    var_matches = re.findall(
        r"--(?:primary|brand|accent|main|theme|color-primary|color-brand)[\w-]*\s*:\s*"
        r"(#[0-9a-fA-F]{3,8}\b|rgb[a]?\([^)]+\))",
        css_text, re.IGNORECASE
    )
    var_hex: list[str] = [_normalize_hex(v) for v in var_matches if v.startswith("#")]

    # 4. Frequency analysis
    all_hex = re.findall(r"#[0-9a-fA-F]{6}\b", css_text)
    normalized = [_normalize_hex(c) for c in all_hex]
    filtered = [c for c in normalized if not _is_neutral_color(c)]
    top_freq = [c for c, _ in Counter(filtered).most_common(8)]

    candidates: list[str] = []
    if primary:
        candidates.append(primary)
    candidates.extend(var_hex)
    candidates.extend(top_freq)

    seen: set[str] = set()
    palette: list[str] = []
    for c in candidates:
        if c and c not in seen and not _is_neutral_color(c):
            seen.add(c)
            palette.append(c)
        if len(palette) >= 6:
            break

    if not primary and palette:
        primary = palette[0]
    if len(palette) >= 2:
        secondary = palette[1]

    return {"primary": primary, "secondary": secondary, "palette": palette}


def _extract_social_links(soup: BeautifulSoup) -> dict:
    """Find social media profile URLs."""
    networks = {
        "instagram": "instagram.com",
        "facebook": "facebook.com",
        "twitter": "twitter.com",
        "x": "x.com",
        "linkedin": "linkedin.com",
        "youtube": "youtube.com",
        "tiktok": "tiktok.com",
    }
    found: dict[str, str] = {}
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        for name, domain in networks.items():
            if name in found:
                continue
            if domain in href.lower():
                found[name] = href
                break
    return found


def website_context_to_json(context: dict) -> str:
    """Convert website context dict to JSON string for storage."""
    return json.dumps(context, ensure_ascii=False)


def json_to_website_context(json_str: str) -> dict:
    """Parse website context JSON string back to dict."""
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, TypeError):
        return {}

# ---------------------------------------------------------------------------
# Playwright + BeautifulSoup article scraper (for SEO competitor analysis)
# ---------------------------------------------------------------------------

_PLAYWRIGHT_UA = _HEADERS["User-Agent"]

# Scrape.do fallback — used when Playwright fails / is unavailable. Token is
# read from env so it can be rotated without a code change. Fallback is silently
# skipped when the token is missing.
_SCRAPEDO_TOKEN = os.getenv("SCRAPEDO_TOKEN", "9c866fcc8f7840bdb8d30b765c7794c46542f274983")
_SCRAPEDO_ENDPOINT = "http://api.scrape.do/"


def _scrape_via_scrapedo(url: str, timeout: float = 30.0) -> dict | None:
    """Fetch a URL via scrape.do and parse it into the article-shape dict.

    Returns None on any failure so callers can decide their own fallback path.
    """
    if not _SCRAPEDO_TOKEN:
        return None
    try:
        proxied = f"{_SCRAPEDO_ENDPOINT}?url={quote(url, safe='')}&token={_SCRAPEDO_TOKEN}"
        resp = httpx.get(proxied, timeout=timeout, follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        title_tag = soup.find("title")
        return {
            "url": url,
            "title": title_tag.get_text(strip=True) if title_tag else "",
            "headings": _extract_headings(soup),
            "main_content": _extract_main_content(soup)[:3_000],
        }
    except Exception as exc:
        logger.warning("[SCRAPER]    ❌ scrape.do fallback failed for %s: %s", url[:80], exc)
        return None


def _extract_headings(soup: BeautifulSoup) -> list[dict]:
    """Extract h1/h2/h3 headings from a BeautifulSoup tree."""
    headings = []
    for tag in soup.find_all(["h1", "h2", "h3"]):
        text = tag.get_text(strip=True)
        if text:
            headings.append({"tag": tag.name, "text": text})
    return headings


def scrape_article_content(url: str) -> dict:
    """
    Scrape a single article URL with Playwright + BeautifulSoup.
    For batch scraping prefer `scrape_articles_batch` (one browser, many pages).

    Returns a dict with keys: url, title, headings, main_content.
    """
    results = scrape_articles_batch([url])
    return results[0] if results else {"url": url, "title": "", "headings": [], "main_content": ""}


def scrape_articles_batch(urls: list[str], page_timeout: int = 15_000) -> list[dict]:
    """
    Scrape multiple URLs with ONE Playwright browser instance.
    Each URL gets a new tab (page) — avoids the cost of launching N browsers.
    Falls back to httpx per-URL if Playwright is not installed.

    Returns a list of dicts: {url, title, headings, main_content}.
    """
    # Normalize URLs
    normalized: list[str] = []
    for u in urls:
        if not u.startswith(("http://", "https://")):
            u = "https://" + u
        normalized.append(u)

    try:
        from playwright.sync_api import (  # noqa: PLC0415
            sync_playwright,
            TimeoutError as PlaywrightTimeoutError,
        )
    except ImportError:
        logger.warning("playwright not installed — trying scrape.do then httpx fallback")
        results = []
        for u in normalized:
            via_scrapedo = _scrape_via_scrapedo(u)
            if via_scrapedo and via_scrapedo.get("main_content"):
                results.append(via_scrapedo)
                continue
            fallback = scrape_website(u)
            results.append({
                "url": u,
                "title": fallback.get("title", ""),
                "headings": [],
                "main_content": fallback.get("main_content", ""),
            })
        return results

    results: list[dict] = []
    try:
        logger.info("[SCRAPER] 🚀 Launching Playwright Chromium (headless)...")
        t_browser = time.time()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent=_PLAYWRIGHT_UA,
                ignore_https_errors=True,
            )
            logger.info("[SCRAPER] ✅ Browser ready in %.1fs", time.time() - t_browser)

            for idx, url in enumerate(normalized):
                entry: dict = {"url": url, "title": "", "headings": [], "main_content": ""}
                logger.info("[SCRAPER] 📄 [%d/%d] Loading %s ...", idx + 1, len(normalized), url[:80])
                t_page = time.time()
                try:
                    page = ctx.new_page()
                    # Block heavy assets
                    page.route(
                        "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3,css}",
                        lambda route: route.abort(),
                    )
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=page_timeout)
                    except PlaywrightTimeoutError:
                        logger.warning("[SCRAPER]    ⏱️ Timeout on %s — using partial load", url[:60])

                    html = page.content()
                    page.close()

                    soup = BeautifulSoup(html, "lxml")
                    title_tag = soup.find("title")
                    if title_tag:
                        entry["title"] = title_tag.get_text(strip=True)
                    entry["headings"] = _extract_headings(soup)
                    entry["main_content"] = _extract_main_content(soup)[:3_000]
                    content_len = len(entry["main_content"])
                    logger.info("[SCRAPER]    ✅ Done in %.1fs — title='%s' headings=%d content=%d chars",
                                time.time() - t_page, entry["title"][:50], len(entry["headings"]), content_len)

                except Exception as exc:
                    logger.warning("[SCRAPER]    ❌ Failed in %.1fs: %s — trying scrape.do fallback", time.time() - t_page, exc)
                    via_scrapedo = _scrape_via_scrapedo(url)
                    if via_scrapedo and via_scrapedo.get("main_content"):
                        entry = via_scrapedo
                        logger.info("[SCRAPER]    ✅ scrape.do fallback ok — title='%s' content=%d chars",
                                    entry["title"][:50], len(entry["main_content"]))

                # If Playwright produced an empty page (bot-block, JS-only), try scrape.do
                if not entry.get("main_content"):
                    via_scrapedo = _scrape_via_scrapedo(url)
                    if via_scrapedo and via_scrapedo.get("main_content"):
                        entry = via_scrapedo
                        logger.info("[SCRAPER]    ✅ scrape.do recovered empty page — content=%d chars",
                                    len(entry["main_content"]))

                results.append(entry)

            browser.close()
            logger.info("[SCRAPER] 🏁 Browser closed — %d pages scraped in %.1fs total",
                        len(results), time.time() - t_browser)

    except Exception as exc:
        logger.error("[SCRAPER] ❌ Playwright batch error: %s — falling back to scrape.do for remaining URLs", exc)

    # Fallback for any URL the Playwright path didn't cover (e.g. browser
    # launch failure before the loop started, or per-URL entries that ended
    # up empty and weren't recovered above).
    done_urls = {r.get("url") for r in results if r.get("main_content")}
    for u in normalized:
        if u in done_urls:
            continue
        via_scrapedo = _scrape_via_scrapedo(u)
        if via_scrapedo and via_scrapedo.get("main_content"):
            logger.info("[SCRAPER]    ✅ scrape.do recovered %s — content=%d chars",
                        u[:80], len(via_scrapedo["main_content"]))
            # Replace any empty placeholder entry for this URL, else append.
            replaced = False
            for i, r in enumerate(results):
                if r.get("url") == u and not r.get("main_content"):
                    results[i] = via_scrapedo
                    replaced = True
                    break
            if not replaced:
                results.append(via_scrapedo)

    return results