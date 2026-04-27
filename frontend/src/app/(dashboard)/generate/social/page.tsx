"use client";

import { useEffect, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  AlertTriangle,
  Image as ImageIcon,
  Send,
  Wand2,
  Search,
  Link as LinkIcon,
} from "lucide-react";
import api from "@/lib/api";
import { useSubscription } from "@/hooks/use-subscription";
import type { GenerateResponse } from "@/types";

type ImageOption = "ai" | "upload";

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

  const [tone, setTone] = useState("professional");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["facebook"]);
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState("");
  const [imageOption, setImageOption] = useState<ImageOption>("upload");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedHashtags, setGeneratedHashtags] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const handlePublishClick = () => {
    setIsPublishModalOpen(true);
  };

  const handleFinalPublish = async () => {
    if (selectedPlatforms.length === 0) {
      toast.error("Please select at least one platform");
      return;
    }
    setIsPublishModalOpen(false);
    handlePostNow();
  };

  const [isDragging, setIsDragging] = useState(false);
  const [seoMode, setSeoMode] = useState(false);
  const [seoSaveId, setSeoSaveId] = useState<string>("");
  const [blogUrl, setBlogUrl] = useState("");
  const [savedBriefs, setSavedBriefs] = useState<Array<{ id: string; title: string; primary_keyword?: string }>>([]);
  const [seoKeywordsUsed, setSeoKeywordsUsed] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<Array<{ id: string; type: string; title: string; data: Record<string, unknown> }>>(
          "/api/seo/saves"
        );
        const briefs = (res.data || [])
          .filter((s) => s.type === "brief")
          .map((s) => ({
            id: s.id,
            title: s.title,
            primary_keyword: (s.data as { primary_keyword?: string })?.primary_keyword,
          }));
        setSavedBriefs(briefs);
      } catch {
        // silent — SEO mode will fall back to most-recent-brief lookup server-side
      }
    })();
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("social_blog_url") : null;
    if (saved) setBlogUrl(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("social_blog_url", blogUrl);
  }, [blogUrl]);

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

  const uploadFile = async (file: File) => {
    const imageTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    const videoTypes = ["video/mp4", "video/quicktime"];
    const allowedTypes = [...imageTypes, ...videoTypes];
    const isVideo = videoTypes.includes(file.type);

    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload JPEG, PNG, GIF, WebP, or MP4.");
      return;
    }

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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
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
        platforms: selectedPlatforms,
        tone,
        topic,
        image_option: imageOption,
        uploaded_image_url: imageOption === "upload" ? uploadedImageUrl : null,
        seo_mode: seoMode,
        seo_save_id: seoMode && seoSaveId ? seoSaveId : null,
        blog_url: blogUrl.trim() || null,
      };
      console.log("[Generate] Payload:", payload);

      const response = await api.post<GenerateResponse>("/api/generate", payload);
      console.log("[Generate] Response:", response.data);

      setGeneratedContent(response.data.content);
      setGeneratedHashtags(response.data.hashtags);
      setGeneratedImageUrl(response.data.image_url);
      setSeoKeywordsUsed(response.data.seo_keywords_used || []);
      toast.success(
        seoMode && (response.data.seo_keywords_used?.length ?? 0) > 0
          ? `Post generated with ${response.data.seo_keywords_used!.length} SEO keywords! 1 credit used.`
          : "Post generated! 1 credit used."
      );
      refreshSubscription();
    } catch (error: unknown) {
      console.error("[Generate] Error:", error);
      const err = error as { response?: { data?: { detail?: string | { msg: string }[] }; status?: number }; message?: string };
      
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
        platforms: selectedPlatforms,
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
      const createResponse = await api.post("/api/posts", {
        content: generatedContent,
        hashtags: generatedHashtags,
        image_url: getDisplayImageUrl(),
        image_option: imageOption,
        platforms: selectedPlatforms,
        tone,
        status: "draft",
      });

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

  const getDisplayImageUrl = () => {
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
      <div>
        <h1 className="text-3xl font-bold">Generate Post</h1>
        <p className="text-muted-foreground">
          Use AI to generate engaging social media posts for your business.
        </p>
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
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="topic">
                  Post Topic <span className="text-red-500">*</span>
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
                  className={topicError ? "border-red-500 focus:ring-red-500" : "focus:ring-primary"}
                />
                {topicError && (
                  <p className="text-sm text-red-500">{topicError}</p>
                )}
              </div>

              <div className="space-y-4">
                <Label className="flex items-center justify-between">
                  Tone
                  {isFreePlan && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Upgrade for more
                    </span>
                  )}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {availableTones.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTone(t.value)}
                      className={`px-4 py-2 rounded-full text-xs font-semibold transition-all border ${
                        tone === t.value
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background text-muted-foreground border-input hover:border-primary/50"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-primary/20 p-4 bg-muted/20 shadow-sm transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2 text-sm font-bold">
                      <Search className="h-4 w-4 text-primary" />
                      SEO Mode
                    </Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Interweave top keywords from your SEO briefs automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={seoMode}
                    onClick={() => setSeoMode(!seoMode)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      seoMode ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 translate-x-0 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                        seoMode ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {seoMode && (
                  <div className="space-y-3 pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Select Brief Source</Label>
                      <Select
                        value={seoSaveId || "latest"}
                        onValueChange={(v) => setSeoSaveId(v === "latest" ? "" : v)}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Use most recent brief" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="latest">Most recent brief (auto)</SelectItem>
                          {savedBriefs.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.primary_keyword ? `${b.primary_keyword} — ` : ""}
                              {b.title || "Untitled"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 group">
                <Label htmlFor="blog-url" className="flex items-center gap-2">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Backlink URL <span className="text-[10px] text-muted-foreground font-normal">(Optional)</span>
                </Label>
                <Input
                  id="blog-url"
                  type="url"
                  placeholder="https://yourblog.com/post-slug"
                  value={blogUrl}
                  onChange={(e) => setBlogUrl(e.target.value)}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant={imageOption === "upload" ? "default" : "outline"}
                  className="h-auto py-3 flex flex-col gap-1 transition-all"
                  onClick={() => setImageOption("upload")}
                >
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-tight">Upload</span>
                </Button>
                <Button
                  type="button"
                  variant={imageOption === "ai" ? "default" : "outline"}
                  className="h-auto py-3 flex flex-col gap-1 transition-all"
                  onClick={() => {
                    setImageOption("ai");
                    setUploadedImageUrl(null);
                  }}
                >
                  <Wand2 className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-tight">AI Generated</span>
                </Button>
              </div>

              {imageOption === "upload" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  {uploadedImageUrl ? (
                    <div className="relative group">
                      <div className="relative w-full h-48 rounded-lg overflow-hidden border">
                        <img
                          src={uploadedImageUrl}
                          alt="Uploaded"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setUploadedImageUrl(null)}
                          >
                            Replace Image
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => !isUploading && document.getElementById("image-upload")?.click()}
                      className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                        isDragging
                          ? "border-primary bg-primary/10"
                          : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/40"
                      } ${isUploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    >
                      {isUploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                          <p className="text-xs font-bold">Uploading...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <ImageIcon className="h-6 w-6 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-bold">
                              {isDragging ? "Drop here" : "Upload Asset"}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              JPEG • PNG • MP4
                            </p>
                          </div>
                        </div>
                      )}
                      <input
                        id="image-upload"
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
                        onChange={handleImageUpload}
                        disabled={isUploading}
                        className="hidden"
                      />
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={isGenerating || creditsRemaining === 0}
                className="w-full h-12 text-base font-bold gap-2 shadow-sm transition-all"
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
              <div className="flex gap-1">
                {selectedPlatforms.map(p => (
                  <Badge key={p} variant="secondary" className="capitalize">{p}</Badge>
                ))}
              </div>
            </CardTitle>
            <CardDescription>
              Review and edit the AI-generated content below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedContent ? (
              <>
                {seoKeywordsUsed.length > 0 && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <Search className="h-3.5 w-3.5" />
                      SEO keywords injected
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {seoKeywordsUsed.filter(Boolean).map((k) => (
                        <Badge key={k} variant="secondary" className="text-xs">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

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
                    onClick={handlePublishClick}
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
                        Publish Now
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

      <Dialog open={isPublishModalOpen} onOpenChange={setIsPublishModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Platforms</DialogTitle>
            <DialogDescription>
              Choose which social media accounts you want to publish this post to.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center space-x-3 space-y-0 rounded-md border p-4">
              <Checkbox 
                id="fb-check" 
                checked={selectedPlatforms.includes("facebook")}
                onCheckedChange={() => togglePlatform("facebook")}
              />
              <div className="flex-1 space-y-1 leading-none">
                <Label htmlFor="fb-check" className="text-sm font-medium leading-none cursor-pointer">
                  Facebook
                </Label>
                <p className="text-xs text-muted-foreground">
                  Publish to your connected Facebook Page.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3 space-y-0 rounded-md border p-4">
              <Checkbox 
                id="ig-check" 
                checked={selectedPlatforms.includes("instagram")}
                onCheckedChange={() => togglePlatform("instagram")}
              />
              <div className="flex-1 space-y-1 leading-none">
                <Label htmlFor="ig-check" className="text-sm font-medium leading-none cursor-pointer">
                  Instagram
                </Label>
                <p className="text-xs text-muted-foreground">
                  Publish to your connected Instagram Business Account.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPublishModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleFinalPublish} disabled={isPublishing}>
              Confirm & Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
