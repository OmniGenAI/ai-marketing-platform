from datetime import datetime

from pydantic import BaseModel


class BusinessImageCreate(BaseModel):
    url: str
    filename: str


class BusinessImageResponse(BaseModel):
    id: str
    user_id: str
    url: str
    filename: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadUrlRequest(BaseModel):
    filename: str
    content_type: str


class UploadUrlResponse(BaseModel):
    upload_url: str
    public_url: str
    path: str
