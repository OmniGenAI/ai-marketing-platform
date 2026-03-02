from datetime import datetime

from pydantic import BaseModel


class WalletResponse(BaseModel):
    id: str
    user_id: str
    balance: int
    total_credits_used: int

    model_config = {"from_attributes": True}


class UsageLogResponse(BaseModel):
    id: str
    wallet_id: str
    action: str
    credits_used: int
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}
