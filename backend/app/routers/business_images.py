import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.business_image import BusinessImage
from app.schemas.business_image import (
    BusinessImageCreate,
    BusinessImageResponse,
    UploadUrlRequest,
    UploadUrlResponse,
)
from app.dependencies import get_current_user
from app.services.supabase_client import get_supabase_admin_client
from app.config import settings

router = APIRouter(prefix="/api/business-images", tags=["business-images"])


@router.get("", response_model=list[BusinessImageResponse])
def list_business_images(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all business images for the current user."""
    images = (
        db.query(BusinessImage)
        .filter(BusinessImage.user_id == current_user.id)
        .order_by(BusinessImage.created_at.desc())
        .all()
    )
    return images


@router.post("/upload-url", response_model=UploadUrlResponse)
def get_upload_url(
    data: UploadUrlRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Get a signed URL for uploading an image to Supabase Storage.
    The frontend will use this URL to upload directly to storage.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Storage not configured",
        )

    # Generate unique filename
    file_ext = data.filename.split(".")[-1] if "." in data.filename else "jpg"
    unique_filename = f"{current_user.id}/{uuid.uuid4()}.{file_ext}"

    try:
        supabase = get_supabase_admin_client()

        # Create signed upload URL
        result = supabase.storage.from_("business-images").create_signed_upload_url(
            unique_filename
        )

        # Construct public URL
        public_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/business-images/{unique_filename}"

        return UploadUrlResponse(
            upload_url=result["signedUrl"],
            public_url=public_url,
            path=unique_filename,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create upload URL: {str(e)}",
        )


@router.post("", response_model=BusinessImageResponse, status_code=status.HTTP_201_CREATED)
def create_business_image(
    data: BusinessImageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a business image record after successful upload.
    Called by frontend after uploading to the signed URL.
    """
    image = BusinessImage(
        user_id=current_user.id,
        url=data.url,
        filename=data.filename,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_business_image(
    image_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a business image."""
    image = (
        db.query(BusinessImage)
        .filter(
            BusinessImage.id == image_id,
            BusinessImage.user_id == current_user.id
        )
        .first()
    )

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Try to delete from Supabase Storage
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            supabase = get_supabase_admin_client()
            # Extract path from URL
            path = image.url.split("/business-images/")[-1]
            supabase.storage.from_("business-images").remove([path])
        except Exception:
            pass  # Continue even if storage deletion fails

    db.delete(image)
    db.commit()
