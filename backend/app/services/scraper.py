import json
import logging

import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)


def scrape_website(url: str) -> dict:
    """
    Scrape a website and extract useful context for AI content generation.
    Returns a dict with meta_description, main_content, about_content, etc.
    """
    result = {
        "url": url,
        "title": "",
        "meta_description": "",
        "main_content": "",
        "about_content": "",
        "services": "",
        "contact_info": "",
    }

    try:
        # Normalize URL
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        # Fetch main page (disable SSL verification to avoid macOS certificate issues)
        response = httpx.get(url, headers=headers, timeout=15.0, follow_redirects=True, verify=False)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")

        # Extract title
        title_tag = soup.find("title")
        if title_tag:
            result["title"] = title_tag.get_text(strip=True)

        # Extract meta description
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            result["meta_description"] = meta_desc["content"]

        # Extract Open Graph description as fallback
        if not result["meta_description"]:
            og_desc = soup.find("meta", attrs={"property": "og:description"})
            if og_desc and og_desc.get("content"):
                result["meta_description"] = og_desc["content"]

        # Extract main content
        main_content = _extract_main_content(soup)
        result["main_content"] = main_content[:2000]  # Limit size

        # Try to find and extract About page
        about_url = _find_about_page(soup, url)
        if about_url:
            try:
                about_response = httpx.get(about_url, headers=headers, timeout=10.0, follow_redirects=True, verify=False)
                about_response.raise_for_status()
                about_soup = BeautifulSoup(about_response.text, "lxml")
                about_content = _extract_main_content(about_soup)
                result["about_content"] = about_content[:1500]
            except Exception:
                pass  # Skip if about page fails

        # Extract contact info
        contact_info = _extract_contact_info(soup)
        result["contact_info"] = contact_info

    except httpx.HTTPStatusError as e:
        raise Exception(f"Failed to fetch website: HTTP {e.response.status_code}")
    except httpx.RequestError as e:
        raise Exception(f"Failed to connect to website: {str(e)}")
    except Exception as e:
        raise Exception(f"Failed to scrape website: {str(e)}")

    return result


def _extract_main_content(soup: BeautifulSoup) -> str:
    """Extract main text content from a page."""
    # Remove scripts, styles, nav, footer, etc.
    for element in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        element.decompose()

    # Try to find main content area
    main_areas = soup.find_all(["main", "article", "div"], class_=lambda x: x and any(
        term in str(x).lower() for term in ["content", "main", "body", "article"]
    ))

    if main_areas:
        text_parts = []
        for area in main_areas[:3]:  # Limit to first 3 matches
            text_parts.append(area.get_text(separator=" ", strip=True))
        return " ".join(text_parts)

    # Fallback to body text
    body = soup.find("body")
    if body:
        return body.get_text(separator=" ", strip=True)

    return ""


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

_PLAYWRIGHT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


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
        logger.warning("playwright not installed — falling back to httpx scraper")
        results = []
        for u in normalized:
            fallback = scrape_website(u)
            results.append({
                "url": u,
                "title": fallback.get("title", ""),
                "headings": [],
                "main_content": fallback.get("main_content", ""),
            })
        return results

    import time as _time
    results: list[dict] = []
    try:
        logger.info("[SCRAPER] 🚀 Launching Playwright Chromium (headless)...")
        t_browser = _time.time()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent=_PLAYWRIGHT_UA,
                ignore_https_errors=True,
            )
            logger.info("[SCRAPER] ✅ Browser ready in %.1fs", _time.time() - t_browser)

            for idx, url in enumerate(normalized):
                entry: dict = {"url": url, "title": "", "headings": [], "main_content": ""}
                logger.info("[SCRAPER] 📄 [%d/%d] Loading %s ...", idx + 1, len(normalized), url[:80])
                t_page = _time.time()
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
                                _time.time() - t_page, entry["title"][:50], len(entry["headings"]), content_len)

                except Exception as exc:
                    logger.warning("[SCRAPER]    ❌ Failed in %.1fs: %s", _time.time() - t_page, exc)

                results.append(entry)

            browser.close()
            logger.info("[SCRAPER] 🏁 Browser closed — %d pages scraped in %.1fs total",
                        len(results), _time.time() - t_browser)

    except Exception as exc:
        logger.error("[SCRAPER] ❌ Playwright batch error: %s", exc)

    return results