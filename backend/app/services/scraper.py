import json
import logging
import os
import time
import warnings

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
        "about":    ["about", "about-us", "who-we-are", "our-story", "our-team"],
        "services": ["services", "service", "what-we-do", "solutions", "offerings"],
        "products": ["products", "product", "shop", "store", "catalogue", "catalog"],
        "contact":  ["contact", "contact-us", "get-in-touch", "reach-us"],
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
    result["contact_info"] = _extract_contact_info(soup)
    result["pages_scraped"].append(url)

    # ── Inner pages ─────────────────────────────────────────────────────
    inner_pages = _find_inner_pages(soup, url)
    logger.info("[SCRAPER] Found inner pages: %s", list(inner_pages.keys()))

    if "about" in inner_pages:
        about_soup = _fetch_html(inner_pages["about"], timeout=10.0)
        if about_soup:
            result["about_content"] = _extract_main_content(about_soup)[:2000]
            result["pages_scraped"].append(inner_pages["about"])

    if "services" in inner_pages or "products" in inner_pages:
        sp_url = inner_pages.get("services") or inner_pages.get("products")
        sp_soup = _fetch_html(sp_url, timeout=10.0)
        if sp_soup:
            result["services_content"] = _extract_main_content(sp_soup)[:2000]
            result["pages_scraped"].append(sp_url)

    # If contact info not found on homepage, try contact page
    if not result["contact_info"] and "contact" in inner_pages:
        contact_soup = _fetch_html(inner_pages["contact"], timeout=10.0)
        if contact_soup:
            result["contact_info"] = _extract_contact_info(contact_soup)
            if inner_pages["contact"] not in result["pages_scraped"]:
                result["pages_scraped"].append(inner_pages["contact"])

    logger.info("[SCRAPER] Done — title=%r pages=%d", result["title"][:50], len(result["pages_scraped"]))
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


def _extract_contact_info(soup: BeautifulSoup) -> str:
    """Extract contact information from the page."""
    contact_parts = []

    # Look for email addresses
    email_links = soup.find_all("a", href=lambda x: x and x.startswith("mailto:"))
    for link in email_links[:2]:
        email = link["href"].replace("mailto:", "").split("?")[0]
        if email and email not in contact_parts:
            contact_parts.append(f"Email: {email}")

    # Look for phone numbers
    phone_links = soup.find_all("a", href=lambda x: x and x.startswith("tel:"))
    for link in phone_links[:2]:
        phone = link["href"].replace("tel:", "")
        if phone and phone not in contact_parts:
            contact_parts.append(f"Phone: {phone}")

    # Look for address in common elements
    address_elements = soup.find_all(["address", "div", "p"], class_=lambda x: x and "address" in str(x).lower())
    for elem in address_elements[:1]:
        address = elem.get_text(separator=" ", strip=True)
        if address and len(address) > 10 and len(address) < 200:
            contact_parts.append(f"Address: {address}")

    return "; ".join(contact_parts)


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