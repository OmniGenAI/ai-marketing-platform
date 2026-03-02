from datetime import datetime

from pydantic import BaseModel


class PlanResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    price: float
    credits: int
    features: dict
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
