"""
Image upload endpoint for social media posts
Uploads images to Supabase Storage and returns public URLs
"""

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from app.dependencies import get_current_user
from app.models.user import User
from app.config import settings
import httpx
import uuid
from typing import Dict

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> Dict[str, str]:
    """
    Upload an image to Supabase Storage.
    Returns the public URL of the uploaded image.
    """

    # Validate file type
    allowed_types = [
        "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
        "video/mp4", "video/quicktime", "video/x-msvideo"
    ]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed types: JPEG, PNG, GIF, WebP, MP4"
        )

    # Validate file size (max 50MB for videos, 15MB for images)
    file_content = await file.read()
    file_size = len(file_content)
    is_video = file.content_type.startswith("video/")
    max_size = 50 * 1024 * 1024 if is_video else 15 * 1024 * 1024  # 50MB video, 15MB image

    if file_size > max_size:
        max_mb = 50 if is_video else 15
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {max_mb}MB. Your file: {file_size / 1024 / 1024:.2f}MB"
        )

    # Generate unique filename
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    unique_filename = f"{current_user.id}/{uuid.uuid4()}.{file_extension}"

    try:
        # Upload to Supabase Storage
        supabase_url = settings.SUPABASE_URL
        # Use "uploads" bucket for videos, "post-images" for images
        bucket_name = "uploads" if is_video else "post-images"

        upload_url = f"{supabase_url}/storage/v1/object/{bucket_name}/{unique_filename}"

        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": file.content_type,
        }

        # Longer timeout for video uploads
        timeout = 120.0 if is_video else 30.0
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                upload_url,
                headers=headers,
                content=file_content,
            )

            if response.status_code not in [200, 201]:
                # If bucket doesn't exist, create it
                if response.status_code == 404:
                    # Try to create bucket
                    create_bucket_url = f"{supabase_url}/storage/v1/bucket"
                    bucket_config = {
                        "name": bucket_name,
                        "public": True,
                    }
                    # Set higher file size limit for uploads bucket
                    if bucket_name == "uploads":
                        bucket_config["file_size_limit"] = 52428800  # 50MB

                    bucket_response = await client.post(
                        create_bucket_url,
                        headers={
                            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                            "Content-Type": "application/json",
                        },
                        json=bucket_config
                    )

                    if bucket_response.status_code in [200, 201]:
                        # Retry upload
                        response = await client.post(
                            upload_url,
                            headers=headers,
                            content=file_content,
                        )
                    else:
                        raise HTTPException(
                            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to create storage bucket: {bucket_response.text}"
                        )

            if response.status_code not in [200, 201]:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to upload image: {response.text}"
                )

        # Generate public URL
        public_url = f"{supabase_url}/storage/v1/object/public/{bucket_name}/{unique_filename}"

        return {
            "url": public_url,
            "filename": unique_filename,
            "size": str(file_size),
            "content_type": file.content_type,
        }

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Network error during upload: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image: {str(e)}"
        )
