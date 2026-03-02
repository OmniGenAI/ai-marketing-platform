"""
Social media integration service.
Placeholder for Facebook and Instagram API integrations.
"""


def publish_to_facebook(page_id: str, access_token: str, content: str) -> dict:
    # TODO: Implement Facebook Graph API integration
    # POST https://graph.facebook.com/{page_id}/feed
    raise NotImplementedError("Facebook publishing not yet implemented")


def publish_to_instagram(
    page_id: str, access_token: str, content: str, image_url: str
) -> dict:
    # TODO: Implement Instagram Graph API integration
    # Step 1: Create media container
    # Step 2: Publish media container
    raise NotImplementedError("Instagram publishing not yet implemented")
