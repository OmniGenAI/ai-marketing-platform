"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Sparkles,
  Copy,
  Save,
  RefreshCw,
  Coins,
  AlertTriangle,
  Image as ImageIcon,
  Send,
  ImageOff,
  Wand2,
} from "lucide-react";
import api from "@/lib/api";
import { useSubscription } from "@/hooks/use-subscription";
import { BusinessImages } from "@/components/business-images";
import type { BusinessImage, GenerateResponse } from "@/types";

type ImageOption = "none" | "business" | "ai" | "upload";

export default function GeneratePage() {
  const router = useRouter();
  const {
    canUseCredits,
    hasFeature,
    creditsRemaining,
    planSlug,
    isFreePlan,
    refresh: refreshSubscription,
  } = useSubscription();

  const [platform, setPlatform] = useState("facebook");
  const [tone, setTone] = useState("professional");
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState("");
  const [imageOption, setImageOption] = useState<ImageOption>("none");
  const [selectedImage, setSelectedImage] = useState<BusinessImage | null>(null);
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedHashtags, setGeneratedHashtags] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Get available tones based on plan
  const getAvailableTones = () => {
    const basicTones = [
      { value: "professional", label: "Professional" },
      { value: "friendly", label: "Friendly" },
    ];

    const premiumTones = [
      { value: "witty", label: "Witty" },
      { value: "formal", label: "Formal" },
      { value: "casual", label: "Casual" },
    ];

    if (hasFeature("all_tones")) {
      return [...basicTones, ...premiumTones];
    }
    return basicTones;
  };

  const availableTones = getAvailableTones();

  const validateTopic = (): boolean => {
    if (!topic.trim()) {
      setTopicError("Topic is required");
      return false;
    }
    setTopicError("");
    return true;
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const imageTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    const videoTypes = ["video/mp4", "video/quicktime"];
    const allowedTypes = [...imageTypes, ...videoTypes];
    const isVideo = videoTypes.includes(file.type);

    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload JPEG, PNG, GIF, WebP, or MP4.");
      return;
    }

    // Validate file size (50MB for videos, 15MB for images)
    const maxSize = isVideo ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
    const maxSizeMB = isVideo ? 50 : 15;
    if (file.size > maxSize) {
      toast.error(`File too large. Maximum size: ${maxSizeMB}MB. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await api.post<{ url: string }>("/api/upload/image", formData);

      setUploadedImageUrl(response.data.url);
      toast.success("Image uploaded successfully!");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to upload image");
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!validateTopic()) {
      toast.error("Please enter a topic for your post");
      return;
    }

    if (!canUseCredits(1)) {
      toast.error("Not enough credits! Upgrade your plan to get more.");
      return;
    }

    setIsGenerating(true);
    console.log("[Generate] Validations passed, making API call...");
    
    try {
      const payload = {
        platform,
        tone,
        topic,
        image_option: imageOption,
        business_image_id: imageOption === "business" ? selectedImage?.id : null,
        uploaded_image_url: imageOption === "upload" ? uploadedImageUrl : null,
      };
      console.log("[Generate] Payload:", payload);
      
      const response = await api.post<GenerateResponse>("/api/generate", payload);
      console.log("[Generate] Response:", response.data);
      
      setGeneratedContent(response.data.content);
      setGeneratedHashtags(response.data.hashtags);
      setGeneratedImageUrl(response.data.image_url);
      toast.success("Post generated! 1 credit used.");
      refreshSubscription();
    } catch (error: unknown) {
      console.error("[Generate] Error:", error);
      const err = error as { response?: { data?: { detail?: string | { msg: string }[] }; status?: number }; message?: string };
      
      // Log full error details
      if (err.response) {
        console.error("[Generate] Response error:", err.response.status, err.response.data);
      } else if (err.message) {
        console.error("[Generate] Network error:", err.message);
      }
      
      if (err.response?.status === 402 || (typeof err.response?.data?.detail === 'string' && err.response?.data?.detail?.includes("credit"))) {
        toast.error("Not enough credits! Upgrade your plan to continue.");
      } else if (err.response?.status === 422) {
        const detail = err.response?.data?.detail;
        if (Array.isArray(detail) && detail[0]?.msg) {
          toast.error(detail[0].msg);
        } else {
          toast.error("Please fill in all required fields");
        }
      } else if (!err.response) {
        // Network error - no response from server
        toast.error("Network error: Cannot reach the server. Please check if the backend is running.");
      } else {
        toast.error((typeof err.response?.data?.detail === 'string' ? err.response?.data?.detail : null) || "Failed to generate post.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!hasFeature("draft_saving") && isFreePlan) {
      toast.error("Draft saving requires a paid plan. Upgrade to save drafts!");
      return;
    }

    setIsSaving(true);
    try {
      await api.post("/api/posts", {
        content: generatedContent,
        hashtags: generatedHashtags,
        image_url: getDisplayImageUrl(),
        image_option: imageOption,
        platform,
        tone,
        status: "draft",
      });
      toast.success("Post saved as draft!");
    } catch {
      toast.error("Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostNow = async () => {
    setIsPublishing(true);
    try {
      // Create the post
      const createResponse = await api.post("/api/posts", {
        content: generatedContent,
        hashtags: generatedHashtags,
        image_url: getDisplayImageUrl(),
        image_option: imageOption,
        platform,
        tone,
        status: "draft",
      });

      // Publish it
      await api.post(`/api/posts/${createResponse.data.id}/publish`);
      toast.success("Post published successfully!");
      router.push("/posts");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to publish post");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `${generatedContent}\n\n${generatedHashtags}`
    );
    toast.success("Copied to clipboard!");
  };

  const formatCredits = (credits: number) => {
    if (credits === Infinity || credits === -1) return "Unlimited";
    return credits.toString();
  };

  const getDisplayImageUrl = () => {
    if (imageOption === "business" && selectedImage) {
      return selectedImage.url;
    }
    if (imageOption === "ai" && generatedImageUrl) {
      return generatedImageUrl;
    }
    if (imageOption === "upload" && uploadedImageUrl) {
      return uploadedImageUrl;
    }
    return null;
  };

  const showLowCreditsWarning = creditsRemaining !== Infinity && creditsRemaining <= 3 && creditsRemaining > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Generate Post</h1>
          <p className="text-muted-foreground">
            Use AI to generate engaging social media posts for your business.
          </p>
        </div>

        <Card className="w-fit">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">
                {formatCredits(creditsRemaining)} credits
              </p>
              <p className="text-xs text-muted-foreground capitalize">
                {planSlug} plan
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {showLowCreditsWarning && (
        <Alert variant="destructive" className="bg-yellow-50 border-yellow-200 text-yellow-800">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              You have {creditsRemaining} credit{creditsRemaining !== 1 ? "s" : ""} remaining.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/subscription")}
              className="ml-4"
            >
              Upgrade Plan
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {creditsRemaining === 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              You have no credits remaining. Upgrade your plan to continue generating posts.
            </span>
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push("/subscription")}
              className="ml-4"
            >
              Upgrade Now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Post Settings</CardTitle>
              <CardDescription>
                Configure what kind of post you want to generate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>
                    Tone
                    {isFreePlan && (
                      <span className="text-xs text-muted-foreground ml-2">
                        (Upgrade for more options)
                      </span>
                    )}
                  </Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTones.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="topic">
                  Topic <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="topic"
                  placeholder="e.g., New product launch, Holiday sale, Behind the scenes..."
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    if (topicError) setTopicError("");
                  }}
                  rows={3}
                  className={topicError ? "border-red-500" : ""}
                />
                {topicError && (
                  <p className="text-sm text-red-500">{topicError}</p>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Image Option</Label>
                <div className="grid grid-cols-4 gap-2">
                  <Button
                    type="button"
                    variant={imageOption === "none" ? "default" : "outline"}
                    className="h-auto py-3 flex flex-col gap-1"
                    onClick={() => {
                      setImageOption("none");
                      setSelectedImage(null);
                      setUploadedImageUrl(null);
                    }}
                  >
                    <ImageOff className="h-5 w-5" />
                    <span className="text-xs">No Image</span>
                  </Button>
                  <Button
                    type="button"
                    variant={imageOption === "business" ? "default" : "outline"}
                    className="h-auto py-3 flex flex-col gap-1"
                    onClick={() => {
                      setImageOption("business");
                      setUploadedImageUrl(null);
                    }}
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-xs">Business Image</span>
                  </Button>
                  <Button
                    type="button"
                    variant={imageOption === "upload" ? "default" : "outline"}
                    className="h-auto py-3 flex flex-col gap-1"
                    onClick={() => {
                      setImageOption("upload");
                      setSelectedImage(null);
                    }}
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-xs">Upload Image</span>
                  </Button>
                  <Button
                    type="button"
                    variant={imageOption === "ai" ? "default" : "outline"}
                    className="h-auto py-3 flex flex-col gap-1"
                    onClick={() => {
                      setImageOption("ai");
                      setSelectedImage(null);
                      setUploadedImageUrl(null);
                    }}
                  >
                    <Wand2 className="h-5 w-5" />
                    <span className="text-xs">Generate with AI</span>
                  </Button>
                </div>
              </div>

              {imageOption === "business" && (
                <div className="space-y-2">
                  <Label>Select Image</Label>
                  <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
                    <BusinessImages
                      selectedImageId={selectedImage?.id}
                      onSelectImage={setSelectedImage}
                      selectionMode
                    />
                  </div>
                </div>
              )}

              {imageOption === "upload" && (
                <div className="space-y-2">
                  <Label>Upload Image</Label>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    {uploadedImageUrl ? (
                      <div className="space-y-3">
                        <div className="relative w-full h-48 rounded-lg overflow-hidden">
                          <img
                            src={uploadedImageUrl}
                            alt="Uploaded"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setUploadedImageUrl(null);
                            document.getElementById("image-upload")?.click();
                          }}
                        >
                          Change Image
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Click to upload or drag and drop
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            PNG, JPG, GIF, WebP or MP4 (max 50MB)
                          </p>
                        </div>
                        <Input
                          id="image-upload"
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
                          onChange={handleImageUpload}
                          disabled={isUploading}
                          className="cursor-pointer"
                        />
                        {isUploading && (
                          <p className="text-sm text-muted-foreground">
                            Uploading...
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={isGenerating || creditsRemaining === 0}
                className="w-full gap-2"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Post (1 Credit)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Generated Post
              <Badge variant="secondary">{platform}</Badge>
            </CardTitle>
            <CardDescription>
              Review and edit the AI-generated content below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedContent ? (
              <>
                {getDisplayImageUrl() && (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={getDisplayImageUrl()!}
                      alt="Post image"
                      className="w-full h-48 object-cover"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Content</Label>
                  <Textarea
                    value={generatedContent}
                    onChange={(e) => setGeneratedContent(e.target.value)}
                    rows={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Hashtags</Label>
                  <Textarea
                    value={generatedHashtags}
                    onChange={(e) => setGeneratedHashtags(e.target.value)}
                    rows={2}
                  />
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={isSaving}
                    className="gap-1"
                    title={isFreePlan ? "Upgrade to save drafts" : "Save as draft"}
                  >
                    <Save className="h-3 w-3" />
                    {isSaving ? "Saving..." : "Save Draft"}
                    {isFreePlan && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        Pro
                      </Badge>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={isGenerating || creditsRemaining === 0}
                    className="gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePostNow}
                    disabled={isPublishing}
                    className="gap-1 ml-auto"
                  >
                    {isPublishing ? (
                      <>
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        <Send className="h-3 w-3" />
                        Post Now
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                <p>Generated content will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
