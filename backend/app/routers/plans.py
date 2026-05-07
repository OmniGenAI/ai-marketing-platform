from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.plan import Plan
from app.schemas.plan import PlanResponse

router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.get("", response_model=list[PlanResponse])
def list_plans(db: Session = Depends(get_db)):
    # Order by price ascending so the subscription page always renders
    # Free → Starter → Growth → Agency regardless of seed/insertion order.
    plans = (
        db.query(Plan)
        .filter(Plan.is_active == True)  # noqa: E712
        .order_by(Plan.price.asc(), Plan.name.asc())
        .all()
    )
    return plans
