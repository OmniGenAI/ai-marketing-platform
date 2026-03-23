from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import httpx
from urllib.parse import urlencode

from app.database import get_db
from app.models.user import User
from app.models.social_account import SocialAccount
from app.dependencies import get_current_user
from app.config import settings

router = APIRouter(prefix="/api/social", tags=["social-accounts"])


# Facebook OAuth Configuration
FACEBOOK_APP_ID = settings.FACEBOOK_APP_ID
FACEBOOK_APP_SECRET = settings.FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI = f"{settings.FRONTEND_URL}/auth/facebook/callback"

# Instagram uses Facebook OAuth
INSTAGRAM_REDIRECT_URI = f"{settings.FRONTEND_URL}/auth/instagram/callback"


@router.get("/debug/config")
def debug_oauth_config(current_user: User = Depends(get_current_user)):
    """Debug endpoint to check OAuth configuration"""
    return {
        "facebook_app_id": FACEBOOK_APP_ID[:10] + "..." if FACEBOOK_APP_ID else "NOT SET",
        "facebook_app_secret": "SET" if FACEBOOK_APP_SECRET else "NOT SET",
        "facebook_redirect_uri": FACEBOOK_REDIRECT_URI,
        "instagram_redirect_uri": INSTAGRAM_REDIRECT_URI,
        "frontend_url": settings.FRONTEND_URL,
        "config_valid": bool(FACEBOOK_APP_ID and FACEBOOK_APP_SECRET),
    }


@router.get("/accounts")
def list_social_accounts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all connected social media accounts for the current user"""
    accounts = (
        db.query(SocialAccount)
        .filter(SocialAccount.user_id == current_user.id)
        .all()
    )

    return [
        {
            "id": acc.id,
            "platform": acc.platform,
            "page_name": acc.page_name,
            "page_id": acc.page_id,
            "connected_at": acc.created_at,
        }
        for acc in accounts
    ]


@router.delete("/accounts/{account_id}")
def disconnect_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disconnect a social media account"""
    account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.id == account_id,
            SocialAccount.user_id == current_user.id
        )
        .first()
    )

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    db.delete(account)
    db.commit()

    return {"message": f"{account.platform.title()} account disconnected successfully"}


@router.get("/facebook/auth")
def facebook_auth(current_user: User = Depends(get_current_user)):
    """Redirect to Facebook OAuth authorization page"""
    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": FACEBOOK_REDIRECT_URI,
        "scope": "pages_show_list,pages_read_engagement,pages_manage_posts",
        "state": current_user.id,  # Pass user ID to verify on callback
    }

    auth_url = f"https://www.facebook.com/v18.0/dialog/oauth?{urlencode(params)}"
    return {"auth_url": auth_url}


@router.post("/facebook/quick-connect")
async def facebook_quick_connect(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Quick connect to Facebook using pre-configured Page Access Token.
    No OAuth redirect required - uses credentials from environment variables.
    """
    page_id = settings.FACEBOOK_PAGE_ID
    page_name = settings.FACEBOOK_PAGE_NAME
    page_token = settings.FACEBOOK_PAGE_ACCESS_TOKEN

    if not page_id or not page_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Facebook Page credentials not configured. Please set FACEBOOK_PAGE_ID, FACEBOOK_PAGE_NAME, and FACEBOOK_PAGE_ACCESS_TOKEN in environment variables."
        )

    # Validate the token by making a test API call
    # Try multiple methods to validate the token
    actual_page_name = page_name or "Facebook Page"
    token_valid = False

    async with httpx.AsyncClient() as client:
        # Method 1: Try to access the page directly
        response = await client.get(
            f"https://graph.facebook.com/v18.0/{page_id}",
            params={
                "access_token": page_token,
                "fields": "id,name"
            }
        )

        if response.status_code == 200:
            page_data = response.json()
            actual_page_name = page_data.get("name", actual_page_name)
            token_valid = True
        else:
            # Method 2: Try to validate token using debug_token endpoint
            response = await client.get(
                "https://graph.facebook.com/v18.0/debug_token",
                params={
                    "input_token": page_token,
                    "access_token": page_token
                }
            )

            if response.status_code == 200:
                debug_data = response.json().get("data", {})
                if debug_data.get("is_valid"):
                    token_valid = True
                    # Token is valid, even if we can't access the page details
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Facebook token is invalid or expired"
                    )
            else:
                # Method 3: Try to access /me endpoint (works with both user and page tokens)
                response = await client.get(
                    "https://graph.facebook.com/v18.0/me",
                    params={
                        "access_token": page_token
                    }
                )

                if response.status_code == 200:
                    token_valid = True
                    me_data = response.json()
                    # If token is for the page itself, use that name
                    if me_data.get("id") == page_id:
                        actual_page_name = me_data.get("name", actual_page_name)
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Facebook token validation failed. Please ensure the token has access to page {page_id}"
                    )

    # Check if account already exists
    existing = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "facebook",
            SocialAccount.page_id == page_id
        )
        .first()
    )

    if existing:
        # Update existing account
        existing.access_token = page_token
        existing.page_name = actual_page_name
    else:
        # Create new account
        social_account = SocialAccount(
            user_id=current_user.id,
            platform="facebook",
            access_token=page_token,
            page_id=page_id,
            page_name=actual_page_name
        )
        db.add(social_account)

    db.commit()

    return {
        "message": "Facebook connected successfully",
        "page_name": actual_page_name,
        "page_id": page_id
    }


@router.post("/instagram/quick-connect")
async def instagram_quick_connect(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Quick connect to Instagram using pre-configured Instagram Business Account.
    No OAuth redirect required - uses credentials from environment variables.
    """
    account_id = settings.INSTAGRAM_ACCOUNT_ID
    username = settings.INSTAGRAM_USERNAME
    access_token = settings.INSTAGRAM_ACCESS_TOKEN

    if not account_id or not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Instagram credentials not configured. Please set INSTAGRAM_ACCOUNT_ID, INSTAGRAM_USERNAME, and INSTAGRAM_ACCESS_TOKEN in environment variables."
        )

    # Validate the token by making a test API call
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://graph.facebook.com/v18.0/{account_id}",
            params={
                "access_token": access_token,
                "fields": "id,username"
            }
        )

        if response.status_code != 200:
            error_data = response.json()
            error_msg = error_data.get("error", {}).get("message", "Invalid token")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Instagram token validation failed: {error_msg}"
            )

        account_data = response.json()
        # Use the username from API if not configured
        actual_username = username or account_data.get("username", "Instagram Account")

    # Check if account already exists
    existing = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "instagram",
            SocialAccount.page_id == account_id
        )
        .first()
    )

    if existing:
        # Update existing account
        existing.access_token = access_token
        existing.page_name = actual_username
    else:
        # Create new account
        social_account = SocialAccount(
            user_id=current_user.id,
            platform="instagram",
            access_token=access_token,
            page_id=account_id,
            page_name=actual_username
        )
        db.add(social_account)

    db.commit()

    return {
        "message": "Instagram connected successfully",
        "page_name": actual_username,
        "page_id": account_id
    }


@router.get("/facebook/callback")
async def facebook_callback(
    code: str = None,
    state: str = None,  # user_id
    error: str = None,
    error_description: str = None,
    db: Session = Depends(get_db),
):
    """Handle Facebook OAuth callback"""
    # Handle OAuth errors from Facebook
    if error:
        print(f"[OAuth Error] {error}: {error_description}")
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=facebook_denied&message={error_description or error}"
        )

    if not code:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=facebook_failed&message=No authorization code"
        )

    if not state:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=facebook_failed&message=No state parameter"
        )

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_response = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "redirect_uri": FACEBOOK_REDIRECT_URI,
                "code": code,
            }
        )

        if token_response.status_code != 200:
            error_data = token_response.json()
            error_msg = error_data.get("error", {}).get("message", "Unknown error")
            print(f"[OAuth Token Error] {token_response.status_code}: {error_msg}")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=facebook_failed&message={error_msg}"
            )

        token_data = token_response.json()
        access_token = token_data["access_token"]

        # Get user's Facebook pages
        pages_response = await client.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={"access_token": access_token}
        )

        if pages_response.status_code != 200:
            error_data = pages_response.json()
            error_msg = error_data.get("error", {}).get("message", "Failed to fetch pages")
            print(f"[OAuth Pages Error] {pages_response.status_code}: {error_msg}")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=facebook_failed&message={error_msg}"
            )

        pages_data = pages_response.json()
        pages = pages_data.get("data", [])

        if not pages:
            print("[OAuth Error] No Facebook pages found for this user")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=facebook_failed&message=No Facebook pages found. Please create a Facebook Page first."
            )

        # Store the first page (or let user select in frontend)
        page = pages[0]

        # Check if account already exists
        existing = (
            db.query(SocialAccount)
            .filter(
                SocialAccount.user_id == state,
                SocialAccount.platform == "facebook",
                SocialAccount.page_id == page["id"]
            )
            .first()
        )

        if existing:
            # Update existing account
            existing.access_token = page["access_token"]
            existing.page_name = page["name"]
        else:
            # Create new account
            social_account = SocialAccount(
                user_id=state,
                platform="facebook",
                access_token=page["access_token"],
                page_id=page["id"],
                page_name=page["name"]
            )
            db.add(social_account)

        db.commit()

    # Redirect back to frontend settings page
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/settings?connected=facebook"
    )


@router.get("/instagram/auth")
def instagram_auth(current_user: User = Depends(get_current_user)):
    """
    Redirect to Instagram OAuth (uses Facebook OAuth)
    Instagram Business API requires Facebook page connection first
    """
    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": INSTAGRAM_REDIRECT_URI,
        "scope": "instagram_basic,instagram_content_publish,pages_show_list",
        "state": current_user.id,
    }

    auth_url = f"https://www.facebook.com/v18.0/dialog/oauth?{urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/instagram/callback")
async def instagram_callback(
    code: str = None,
    state: str = None,  # user_id
    error: str = None,
    error_description: str = None,
    db: Session = Depends(get_db),
):
    """Handle Instagram OAuth callback"""
    # Handle OAuth errors
    if error:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=instagram_denied&message={error_description or error}"
        )

    if not code:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message=Authorization code not provided"
        )

    if not state:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message=No state parameter"
        )

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_response = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "redirect_uri": INSTAGRAM_REDIRECT_URI,
                "code": code,
            }
        )

        if token_response.status_code != 200:
            error_data = token_response.json()
            error_msg = error_data.get("error", {}).get("message", "Failed to obtain access token")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message={error_msg}"
            )

        token_data = token_response.json()
        access_token = token_data["access_token"]

        # Get Facebook pages with Instagram accounts
        pages_response = await client.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={
                "access_token": access_token,
                "fields": "id,name,instagram_business_account"
            }
        )

        if pages_response.status_code != 200:
            error_data = pages_response.json()
            error_msg = error_data.get("error", {}).get("message", "Failed to fetch Facebook pages")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message={error_msg}"
            )

        pages_data = pages_response.json()
        pages = pages_data.get("data", [])

        # Find page with Instagram account
        instagram_page = None
        for page in pages:
            if "instagram_business_account" in page:
                instagram_page = page
                break

        if not instagram_page:
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message=No Instagram Business Account found. Please connect your Instagram account to a Facebook page."
            )

        instagram_account_id = instagram_page["instagram_business_account"]["id"]

        # Get Instagram account details
        ig_response = await client.get(
            f"https://graph.facebook.com/v18.0/{instagram_account_id}",
            params={
                "access_token": instagram_page["access_token"],
                "fields": "id,username"
            }
        )

        if ig_response.status_code != 200:
            error_data = ig_response.json()
            error_msg = error_data.get("error", {}).get("message", "Failed to fetch Instagram account details")
            return RedirectResponse(
                url=f"{settings.FRONTEND_URL}/settings?error=instagram_failed&message={error_msg}"
            )

        ig_data = ig_response.json()

        # Check if account already exists
        existing = (
            db.query(SocialAccount)
            .filter(
                SocialAccount.user_id == state,
                SocialAccount.platform == "instagram",
                SocialAccount.page_id == instagram_account_id
            )
            .first()
        )

        if existing:
            # Update existing account
            existing.access_token = instagram_page["access_token"]
            existing.page_name = ig_data.get("username", "Instagram")
        else:
            # Create new account
            social_account = SocialAccount(
                user_id=state,
                platform="instagram",
                access_token=instagram_page["access_token"],
                page_id=instagram_account_id,
                page_name=ig_data.get("username", "Instagram")
            )
            db.add(social_account)

        db.commit()

    # Redirect back to frontend settings page
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/settings?connected=instagram"
    )
