import uuid
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.wallet import Wallet
from app.models.plan import Plan
from app.models.subscription import Subscription


def get_or_create_user_from_supabase(
    db: Session,
    supabase_id: str,
    email: str,
    name: str | None = None
) -> User:
    """
    Get existing user by supabase_id or create a new one.
    This is called on first API request to sync Supabase auth with local DB.
    """
    # First, try to find by supabase_id
    user = db.query(User).filter(User.supabase_id == supabase_id).first()
    if user:
        return user

    # Check if user exists by email (legacy user from before Supabase)
    user = db.query(User).filter(User.email == email).first()
    if user:
        # Link existing user to Supabase
        user.supabase_id = supabase_id
        db.commit()
        db.refresh(user)
        return user

    # Create new user
    user = User(
        id=str(uuid.uuid4()),
        supabase_id=supabase_id,
        name=name or email.split("@")[0],
        email=email,
        hashed_password=None,  # No password needed for Supabase auth
        is_active=True,
        role="user",
    )
    db.add(user)
    db.flush()

    # Create wallet with free plan credits
    wallet = Wallet(
        id=str(uuid.uuid4()),
        user_id=user.id,
        balance=5,  # Free starter credits
        total_credits_used=0,
    )
    db.add(wallet)

    # Create free subscription
    free_plan = db.query(Plan).filter(Plan.slug == "free").first()
    if free_plan:
        subscription = Subscription(
            id=str(uuid.uuid4()),
            user_id=user.id,
            plan_id=free_plan.id,
            status="active",
        )
        db.add(subscription)

    db.commit()
    db.refresh(user)
    return user
