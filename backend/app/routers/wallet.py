from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.wallet import Wallet, UsageLog
from app.schemas.wallet import WalletResponse, UsageLogResponse
from app.dependencies import get_current_user

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


@router.get("", response_model=WalletResponse)
def get_wallet(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wallet = (
        db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    )
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found",
        )
    return wallet


@router.get("/usage", response_model=list[UsageLogResponse])
def get_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wallet = (
        db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    )
    if not wallet:
        return []

    logs = (
        db.query(UsageLog)
        .filter(UsageLog.wallet_id == wallet.id)
        .order_by(UsageLog.created_at.desc())
        .limit(50)
        .all()
    )
    return logs
