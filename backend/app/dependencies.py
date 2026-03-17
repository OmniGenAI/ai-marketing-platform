from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import httpx

from app.database import get_db
from app.models.user import User
from app.config import settings
from app.services.auth import decode_access_token
from app.services.user_sync import get_or_create_user_from_supabase

security = HTTPBearer()


def verify_supabase_token(token: str) -> dict | None:
    """
    Verify a Supabase JWT token by calling Supabase's auth API.
    Returns the user data if valid, None otherwise.
    """
    try:
        response = httpx.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": settings.SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=10.0,
        )

        if response.status_code == 200:
            return response.json()
        return None
    except Exception:
        return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials

    # Try Supabase token verification first (if configured)
    if settings.SUPABASE_URL and settings.SUPABASE_ANON_KEY:
        user_data = verify_supabase_token(token)
        if user_data:
            supabase_id = user_data.get("id")
            email = user_data.get("email")
            user_metadata = user_data.get("user_metadata", {})
            name = user_metadata.get("name") or user_metadata.get("full_name")

            if not supabase_id or not email:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token payload",
                )

            # Get or create user from Supabase data
            user = get_or_create_user_from_supabase(
                db=db,
                supabase_id=supabase_id,
                email=email,
                name=name,
            )

            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account is deactivated",
                )

            return user

    # Fall back to legacy JWT (for backwards compatibility)
    user_id = decode_access_token(token)

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user = db.query(User).filter(User.id == user_id).first()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    return user
