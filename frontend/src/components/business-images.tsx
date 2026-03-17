"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, Trash2, Check, Loader2, Image as ImageIcon } from "lucide-react";
import api from "@/lib/api";
import type { BusinessImage } from "@/types";

interface BusinessImagesProps {
  selectedImageId?: string | null;
  onSelectImage?: (image: BusinessImage | null) => void;
  selectionMode?: boolean;
}

export function BusinessImages({
  selectedImageId,
  onSelectImage,
  selectionMode = false,
}: BusinessImagesProps) {
  const [images, setImages] = useState<BusinessImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchImages = useCallback(async () => {
    try {
      const response = await api.get<BusinessImage[]>("/api/business-images");
      setImages(response.data);
    } catch {
      toast.error("Failed to load images");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setIsUploading(true);

    try {
      // Get upload URL from backend
      const uploadUrlResponse = await api.post<{
        upload_url: string;
        public_url: string;
        path: string;
      }>("/api/business-images/upload-url", {
        filename: file.name,
        content_type: file.type,
      });

      // Upload to Supabase Storage
      const uploadResponse = await fetch(uploadUrlResponse.data.upload_url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image");
      }

      // Create image record in database
      const createResponse = await api.post<BusinessImage>("/api/business-images", {
        url: uploadUrlResponse.data.public_url,
        filename: file.name,
      });

      setImages((prev) => [createResponse.data, ...prev]);
      toast.success("Image uploaded successfully");
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
      // Reset file input
      e.target.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);

    try {
      await api.delete(`/api/business-images/${id}`);
      setImages((prev) => prev.filter((img) => img.id !== id));

      // Clear selection if deleted image was selected
      if (selectedImageId === id && onSelectImage) {
        onSelectImage(null);
      }

      toast.success("Image deleted");
    } catch {
      toast.error("Failed to delete image");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = (image: BusinessImage) => {
    if (!selectionMode || !onSelectImage) return;

    if (selectedImageId === image.id) {
      onSelectImage(null);
    } else {
      onSelectImage(image);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!selectionMode && (
        <div className="flex items-center gap-4">
          <Label htmlFor="image-upload" className="cursor-pointer">
            <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload Image
                </>
              )}
            </div>
          </Label>
          <Input
            id="image-upload"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            disabled={isUploading}
          />
          <p className="text-sm text-muted-foreground">
            Max 5MB. JPG, PNG, GIF supported.
          </p>
        </div>
      )}

      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No images uploaded yet</p>
          {!selectionMode && (
            <p className="text-sm text-muted-foreground mt-1">
              Upload images to use in your social media posts
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image) => (
            <div
              key={image.id}
              className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                selectedImageId === image.id
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-transparent hover:border-muted-foreground/20"
              } ${selectionMode ? "cursor-pointer" : ""}`}
              onClick={() => handleSelect(image)}
            >
              <img
                src={image.url}
                alt={image.filename}
                className="w-full aspect-square object-cover"
              />

              {selectedImageId === image.id && (
                <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                  <Check className="h-4 w-4" />
                </div>
              )}

              {!selectionMode && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(image.id);
                    }}
                    disabled={deletingId === image.id}
                  >
                    {deletingId === image.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-white text-xs truncate">{image.filename}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BusinessImagesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Images</CardTitle>
        <CardDescription>
          Upload images to use in your social media posts
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BusinessImages />
      </CardContent>
    </Card>
  );
}
