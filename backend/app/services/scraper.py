import json
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse


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
