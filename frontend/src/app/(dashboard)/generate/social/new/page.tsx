"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Clock,
  ArrowLeft,
  CheckCircle2,
  Facebook,
  Instagram,
  Linkedin,
  MessageSquare,
  Code2,
  Youtube,
  AlertCircle,
} from "lucide-react";
import api from "@/lib/api";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/use-subscription";
import type { GenerateResponse } from "@/types";

type ImageOption = "ai" | "upload";

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading...</div>}>
      <GeneratePageContent />
    </Suspense>
  );
}

function GeneratePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    canUseCredits,
    hasFeature,
    creditsRemaining,
    planSlug,
    isFreePlan,
    refresh: refreshSubscription,
  } = useSubscription();

  const [tone, setTone] = useState("professional");
  // Multi-select tones — when 2+ are selected the LLM blends them into one cohesive voice.
  // `tone` (singular) is kept for backwards-compat with downstream code that reads it.
  const [selectedTones, setSelectedTones] = useState<string[]>(["professional"]);
  const toggleTone = (v: string) => {
    setSelectedTones(prev => {
      if (prev.includes(v)) {
        // Keep at least 1
        return prev.length > 1 ? prev.filter(t => t !== v) : prev;
      }
      return [...prev, v];
    });
    // Mirror first selected as `tone` for legacy code paths
    setTone(v);
  };
  // Multi-select platforms — generation/publish run for each, but a single
  // post row is created per platform. selectedPlatform mirrors the first one
  // for backward compatibility with downstream code that expects a single value.
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["facebook"]);
  const selectedPlatform = selectedPlatforms[0] ?? "facebook";
  const setSelectedPlatform = (v: string) => setSelectedPlatforms([v]);
  const togglePlatform = (v: string) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(v)) {
        // Don't allow deselecting the last one — at least 1 platform must stay
        return prev.length > 1 ? prev.filter(p => p !== v) : prev;
      }
      return [...prev, v];
    });
  };
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState("");
  const [imageOption, setImageOption] = useState<ImageOption>("upload");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedHashtags, setGeneratedHashtags] = useState("");
  // All caption variations returned by the backend (when `variations > 1`).
  // The first one is mirrored into generatedContent/Hashtags as the default.
  const [variations, setVariations] = useState<Array<{ content: string; hashtags: string }>>([]);
  const [variationIndex, setVariationIndex] = useState(0);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  // Tracks the auto-saved draft Post returned by /api/generate so subsequent
  // Save Draft / Publish actions update that row instead of creating duplicates.
  const [currentPostId, setCurrentPostId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const [publishPlatforms, setPublishPlatforms] = useState<string[]>([]);
  // Per-platform live status during publish ("pending" | "publishing" | "success" | "failed")
  type PlatformStatus = "pending" | "publishing" | "success" | "failed";
  const [publishProgress, setPublishProgress] = useState<Record<string, { status: PlatformStatus; error?: string }>>({});

  // Fetch connected providers — used to populate the publish platform list dynamically
  const { data: providers = [] } = useQuery<{ platform: string; configured: boolean; connected: boolean; page_name: string | null }[]>({
    queryKey: ["social-providers"],
    queryFn: async () => (await api.get("/api/social/providers")).data,
    staleTime: 60 * 1000,
    enabled: isPublishModalOpen,
  });
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [imageHeadline, setImageHeadline] = useState<string>("");
  // True while the backend is generating an AI image asynchronously and we
  // are polling /api/posts/{post_id} for the final URL.
  const [isImagePending, setIsImagePending] = useState(false);

  const handlePublishClick = () => {
    if (!generatedContent) { toast.error("Generate content first"); return; }
    // Pre-select platforms based on what was chosen for generation
    // (only override if nothing is already set — preserves loaded post state)
    if (publishPlatforms.length === 0) {
      setPublishPlatforms(selectedPlatforms);
    }
    setIsPublishModalOpen(true);
  };

  // Unified publish/schedule handler — creates one post per selected platform
  // (each platform has its own row in the DB so schedule/publish runs independently).
  // Tracks per-platform progress in `publishProgress` so the UI can ping-pong status.
  const handleConfirmPublish = async () => {
    if (publishPlatforms.length === 0) { toast.error("Select at least one platform"); return; }
    setIsPublishing(true);

    // Seed all platforms as "pending"
    const initialProgress: Record<string, { status: PlatformStatus; error?: string }> = {};
    publishPlatforms.forEach(p => { initialProgress[p] = { status: "pending" }; });
    setPublishProgress(initialProgress);

    try {
      const isoSchedule = scheduleValue ? new Date(scheduleValue).toISOString() : null;
      const baseFields = {
        content: generatedContent,
        hashtags: generatedHashtags,
        image_url: getDisplayImageUrl(),
        image_option: imageOption,
        tone,
      };

      const results: { platform: string; ok: boolean; error?: string }[] = [];

      for (let i = 0; i < publishPlatforms.length; i++) {
        const platform = publishPlatforms[i];
        // Mark this platform as actively publishing
        setPublishProgress(prev => ({ ...prev, [platform]: { status: "publishing" } }));
        try {
          let postId: string | null = null;
          if (i === 0 && currentPostId) {
            await api.patch(`/api/posts/${currentPostId}`, {
              ...baseFields,
              platform,
              status: "draft",
            });
            postId = currentPostId;
          } else {
            const res = await api.post<{ id: string }>("/api/posts", {
              ...baseFields,
              platform,
              status: "draft",
            });
            postId = res.data.id;
            if (i === 0) setCurrentPostId(postId);
          }
          if (isoSchedule) {
            await api.patch(`/api/posts/${postId}/reschedule`, { scheduled_at: isoSchedule });
          } else {
            await api.post(`/api/posts/${postId}/publish`);
          }
          setPublishProgress(prev => ({ ...prev, [platform]: { status: "success" } }));
          results.push({ platform, ok: true });
        } catch (err) {
          const e = err as { response?: { data?: { detail?: string } } };
          const errMsg = e.response?.data?.detail || "Failed";
          setPublishProgress(prev => ({ ...prev, [platform]: { status: "failed", error: errMsg } }));
          results.push({ platform, ok: false, error: errMsg });
        }
      }

      const successful = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);

      if (successful.length > 0) {
        const action = isoSchedule ? "scheduled" : "published";
        const platformList = successful.map(r => r.platform).join(", ");
        toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} on ${platformList}`);
      }
      if (failed.length > 0) {
        const platformList = failed.map(r => r.platform).join(", ");
        toast.error(`Failed on ${platformList}`);
      }
      // Auto-close dialog only when ALL platforms succeeded; otherwise let user inspect the errors
      if (failed.length === 0) {
        setTimeout(() => setIsPublishModalOpen(false), 1200);
      }
    } catch {
      toast.error("Failed to schedule/publish");
    } finally {
      setIsPublishing(false);
    }
  };

  // Load existing post when ?id= is present in the URL (e.g. navigating from
  // the Posts list to edit/re-publish a draft or published post).
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    (async () => {
      try {
        const res = await api.get<{
          id: string;
          content: string;
          hashtags: string;
          image_url: string | null;
          image_option: string;
          platform: string;
          tone: string;
          scheduled_at?: string | null;
          status?: string;
        }>(`/api/posts/${id}`);
        const p = res.data;
        setCurrentPostId(p.id);
        setGeneratedContent(p.content || "");
        setGeneratedHashtags(p.hashtags || "");
        setSelectedPlatform(p.platform || "facebook");
        setTone(p.tone || "professional");
        // Pre-fill modal state when reopening a scheduled / saved post
        if (p.platform) setPublishPlatforms([p.platform]);
        if (p.scheduled_at) {
          // Convert UTC ISO -> local datetime-local format
          const d = new Date(p.scheduled_at);
          const pad = (n: number) => String(n).padStart(2, "0");
          setScheduleValue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
        }
        if (p.image_option === "upload" || p.image_option === "ai") {
          setImageOption(p.image_option as ImageOption);
        }
        if (p.image_option === "upload" && p.image_url) {
          setUploadedImageUrl(p.image_url);
        }
        if (p.image_option === "ai" && p.image_url) {
          setGeneratedImageUrl(p.image_url);
        }
      } catch {
        toast.error("Failed to load post");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Poll the post until the backend background task fills in image_url.
  // Caps at ~2 min total to avoid spinning forever if the worker died.
  const pollForImage = async (postId: string) => {
    const POLL_INTERVAL_MS = 3000;
    const MAX_ATTEMPTS = 40; // 40 * 3s = 120s
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const res = await api.get<{ image_url: string | null }>(`/api/posts/${postId}`);
        if (res.data.image_url) {
          setGeneratedImageUrl(res.data.image_url);
          setIsImagePending(false);
          toast.success("Image ready!");
          return;
        }
      } catch {
        // Transient errors are fine — keep polling until the cap.
      }
    }
    setIsImagePending(false);
    toast.error("Image generation timed out. You can try regenerating.");
  };

  const handleGenerate = async () => {
    if (!validateTopic()) {
      toast.error("Please enter a topic for your post");
      return;
    }

    if (!selectedPlatform) {
      toast.error("Please select a platform");
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
        platform: selectedPlatform,
        tone,                           // Backwards compat — backend uses `tones` if provided
        tones: selectedTones,           // Multi-tone blend
        variations: 2,                  // Always request 2 caption variations
        topic,
        image_option: imageOption,
        uploaded_image_url: imageOption === "upload" ? uploadedImageUrl : null,
        aspect_ratio: imageOption === "ai" ? aspectRatio : null,
        image_text:
          imageOption === "ai" && imageHeadline.trim()
            ? imageHeadline.trim()
            : null,
        seo_mode: seoMode,
        seo_save_id: seoMode && seoSaveId ? seoSaveId : null,
        blog_url: blogUrl.trim() || null,
      };
      console.log("[Generate] Payload:", payload);

      const response = await api.post<GenerateResponse>("/api/generate", payload);
      console.log("[Generate] Response:", response.data);

      setGeneratedContent(response.data.content);
      setGeneratedHashtags(response.data.hashtags);
      // Capture all variations if backend returned them
      setVariations(response.data.variations || []);
      setVariationIndex(0);
      setGeneratedImageUrl(response.data.image_url);
      // Replace any prior draft id with the freshly-created one so subsequent
      // Save / Publish actions update this row, not the previous draft.
      const newPostId = response.data.post_id ?? null;
      setCurrentPostId(newPostId);
      setSeoKeywordsUsed(response.data.seo_keywords_used || []);
      toast.success(
        seoMode && (response.data.seo_keywords_used?.length ?? 0) > 0
          ? `Post generated with ${response.data.seo_keywords_used!.length} SEO keywords! 1 credit used.`
          : "Post generated! 1 credit used."
      );
      refreshSubscription();

      // AI image is generated asynchronously on the backend (to avoid tunnel
      // / proxy idle timeouts). Poll the post until the image lands or we
      // hit the cap.
      if (response.data.image_pending && newPostId) {
        setIsImagePending(true);
        toast.info("Generating image — this can take up to a minute…");
        void pollForImage(newPostId);
      }
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
      // Generate auto-creates a draft and returns its id; if we have one, patch
      // it instead of creating a duplicate row.
      if (currentPostId) {
        await api.patch(`/api/posts/${currentPostId}`, {
          content: generatedContent,
          hashtags: generatedHashtags,
          image_url: getDisplayImageUrl(),
          image_option: imageOption,
          status: "draft",
        });
      } else {
        const res = await api.post<{ id: string }>("/api/posts", {
          content: generatedContent,
          hashtags: generatedHashtags,
          image_url: getDisplayImageUrl(),
          image_option: imageOption,
          platform: selectedPlatform,
          tone,
          status: "draft",
        });
        setCurrentPostId(res.data.id);
      }
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
      let postId = currentPostId;

      // If we have an auto-saved draft, sync any user edits before publishing.
      if (postId) {
        await api.patch(`/api/posts/${postId}`, {
          content: generatedContent,
          hashtags: generatedHashtags,
          image_url: getDisplayImageUrl(),
          image_option: imageOption,
          status: "draft",
        });
      } else {
        // Fallback path (auto-save failed) — create then publish.
        const createResponse = await api.post<{ id: string }>("/api/posts", {
          content: generatedContent,
          hashtags: generatedHashtags,
          image_url: getDisplayImageUrl(),
          image_option: imageOption,
          platform: selectedPlatform,
          tone,
          status: "draft",
        });
        postId = createResponse.data.id;
        setCurrentPostId(postId);
      }

      await api.post(`/api/posts/${postId}/publish`);
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
    <div className="space-y-4">
      {/* Breadcrumb back */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span>/</span>
        <span className="text-foreground font-medium">Generate Post</span>
      </div>

      {/* Title + icon */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500 text-white shadow-sm">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Generate Post</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Use AI to craft engaging social media posts for your business.
          </p>
        </div>
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

      <div className="grid gap-6 lg:grid-cols-[440px_1fr] relative">
        <div className="space-y-6">
          <Card className="relative border-purple-200 h-[calc(100vh-13rem)] flex flex-col gap-0 overflow-hidden">
            {/* Purple accent stripe */}
            <div className="absolute inset-x-0 top-0 h-1 bg-purple-500" />
            <CardHeader className="shrink-0 mb-3 border-b">
              <CardTitle className="text-purple-600">
                Post Settings
              </CardTitle>
              <CardDescription>
                Configure what kind of post you want to generate.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-6 pb-6 scrollbar-thin">
              {/* Topic */}
              <div className="space-y-1.5">
                <Label htmlFor="topic">
                  Post Topic <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="topic"
                  placeholder="e.g., New product launch, Holiday sale, Behind the scenes…"
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    if (topicError) setTopicError("");
                  }}
                  rows={3}
                  className={topicError ? "border-red-500 focus:ring-red-500" : ""}
                />
                {topicError && (
                  <p className="text-xs text-red-500">{topicError}</p>
                )}
              </div>

              {/* Platform — multi-select grid with platform colors */}
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  <span>Platform <span className="text-red-500">*</span></span>
                  {selectedPlatforms.length > 0 && (
                    <span className="text-[10px] text-muted-foreground font-normal">
                      {selectedPlatforms.length} selected
                    </span>
                  )}
                </Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: "facebook",  label: "Facebook",  color: "#1877F2" },
                    { value: "instagram", label: "Instagram", color: "#E4405F" },
                    { value: "linkedin",  label: "LinkedIn",  color: "#0A66C2" },
                    { value: "twitter",   label: "X / Twitter", color: "#0F172A" },
                    { value: "threads",   label: "Threads",   color: "#0F172A" },
                  ].map((p) => {
                    const active = selectedPlatforms.includes(p.value);
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => togglePlatform(p.value)}
                        style={active ? { borderColor: p.color, color: p.color, backgroundColor: `${p.color}10` } : undefined}
                        className={`relative px-2.5 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          active
                            ? "ring-1"
                            : "text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                      >
                        {p.label}
                        {active && (
                          <span
                            className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                            style={{ backgroundColor: p.color }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  <span>
                    Tone
                    {selectedTones.length > 1 && (
                      <span className="ml-2 text-[10px] text-purple-600 font-medium">
                        Blending {selectedTones.length} tones
                      </span>
                    )}
                  </span>
                  {isFreePlan && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Upgrade for more
                    </span>
                  )}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {availableTones.map((t) => {
                    const active = selectedTones.includes(t.value);
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => toggleTone(t.value)}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all border ${
                          active
                            ? "border-purple-500 bg-purple-50 text-purple-700"
                            : "text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Pick one for a single voice, or select multiple to blend them.
                </p>
              </div>

              {/* SEO Mode — compact card with purple accent */}
              <div className="space-y-3 rounded-lg border border-purple-200 p-3 bg-purple-50/40 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold">
                      <Search className="h-3.5 w-3.5 text-purple-600" />
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
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                      seoMode ? "bg-purple-500" : "bg-muted-foreground/30"
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

              {/* Backlink URL */}
              <div className="space-y-1.5">
                <Label htmlFor="blog-url" className="flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
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

              {/* Image source toggle */}
              <div className="space-y-2">
                <Label className="text-xs">Image source</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImageOption("upload")}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 transition-all ${
                      imageOption === "upload"
                        ? "border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500"
                        : "border-border text-muted-foreground hover:border-foreground/30"
                    }`}
                  >
                    <ImageIcon className="h-4 w-4" />
                    <span className="text-xs font-semibold">Upload</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImageOption("ai"); setUploadedImageUrl(null); }}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 transition-all ${
                      imageOption === "ai"
                        ? "border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500"
                        : "border-border text-muted-foreground hover:border-foreground/30"
                    }`}
                  >
                    <Wand2 className="h-4 w-4" />
                    <span className="text-xs font-semibold">AI Generated</span>
                  </button>
                </div>
              </div>

              {imageOption === "ai" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="space-y-2">
                    <Label className="text-xs">Aspect Ratio</Label>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {[
                        { value: "1:1",    label: "Square",    sub: "1:1" },
                        { value: "4:5",    label: "Portrait",  sub: "4:5" },
                        { value: "9:16",   label: "Story",     sub: "9:16" },
                        { value: "16:9",   label: "Landscape", sub: "16:9" },
                        { value: "1.91:1", label: "Link",      sub: "1.91:1" },
                      ].map((r) => {
                        const active = aspectRatio === r.value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            onClick={() => setAspectRatio(r.value)}
                            className={`rounded-md border p-2 text-left text-xs transition-all ${
                              active
                                ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500"
                                : "border-border hover:border-foreground/30"
                            }`}
                          >
                            <span className={`block font-semibold ${active ? "text-purple-700" : ""}`}>{r.label}</span>
                            <span className="block text-[10px] text-muted-foreground">{r.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="image-headline" className="text-xs">
                      Headline on Image{" "}
                      <span className="text-[10px] text-muted-foreground font-normal">
                        (Optional)
                      </span>
                    </Label>
                    <Input
                      id="image-headline"
                      type="text"
                      maxLength={60}
                      placeholder="e.g. Summer Sale — 30% off"
                      value={imageHeadline}
                      onChange={(e) => setImageHeadline(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Renders this exact phrase as a clean text overlay in the
                      generated image.
                    </p>
                  </div>
                </div>
              )}

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

            </CardContent>

            {/* Sticky generate footer — stays at the bottom of the fixed-height card */}
            <div className="px-6 pt-3 shrink-0 border-t bg-background">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || creditsRemaining === 0}
                className="w-full h-12 text-base font-bold gap-2 shadow-sm transition-all bg-purple-500 hover:bg-purple-600 text-white"
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
            </div>
          </Card>
        </div>

        <Card className="relative border-purple-200 overflow-hidden">
          {/* Purple accent stripe */}
          <div className="absolute inset-x-0 top-0 h-1 bg-purple-500" />
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="text-purple-600">
                Generated Post
              </span>
              <Badge variant="secondary" className="capitalize">{selectedPlatform}</Badge>
            </CardTitle>
            <CardDescription>
              Review and edit the AI-generated content below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedContent ? (
              <>
                {/* Variation switcher — only when 2+ captions are returned */}
                {variations.length > 1 && (
                  <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50/50 px-3 py-2">
                    <span className="text-xs font-medium text-purple-700">
                      Caption variation
                    </span>
                    <div className="flex gap-1">
                      {variations.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setVariationIndex(i);
                            setGeneratedContent(variations[i].content);
                            setGeneratedHashtags(variations[i].hashtags);
                          }}
                          className={`px-3 py-1 text-xs font-semibold rounded transition-all ${
                            variationIndex === i
                              ? "bg-purple-500 text-white"
                              : "bg-background text-muted-foreground hover:bg-purple-100"
                          }`}
                        >
                          V{i + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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

                {getDisplayImageUrl() ? (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={getDisplayImageUrl()!}
                      alt="Post image"
                      className="w-full "
                    />
                  </div>
                ) : isImagePending ? (
                  <div className="rounded-lg border bg-muted/40 h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <p className="text-sm">Generating image…</p>
                    <p className="text-xs">This usually takes 30–60 seconds.</p>
                  </div>
                ) : null}

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
              <div className="flex min-h-100 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-purple-50/50 p-8 text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500 text-white shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </span>
                <h3 className="text-lg font-semibold">No post yet</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Fill in the topic and pick a platform on the left, then hit Generate.
                  The AI will craft a platform-native post you can edit, schedule, or publish live.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unified Publish Dialog — 3 sections: platforms, schedule, confirm */}
      <Dialog open={isPublishModalOpen} onOpenChange={(o) => { setIsPublishModalOpen(o); if (!o) setPublishProgress({}); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Publish Post
            </DialogTitle>
            <DialogDescription>
              Choose platforms and schedule, then publish.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* ── Section 1: Platform selection ── */}
            {(() => {
              const SOCIAL_PLATFORMS: Record<string, { label: string; icon: React.ReactNode; bg: string }> = {
                facebook:  { label: "Facebook",   icon: <Facebook className="h-4 w-4" />,      bg: "bg-[#1877F2]" },
                instagram: { label: "Instagram",  icon: <Instagram className="h-4 w-4" />,     bg: "bg-[#E4405F]" },
                linkedin:  { label: "LinkedIn",   icon: <Linkedin className="h-4 w-4" />,      bg: "bg-[#0A66C2]" },
                reddit:    { label: "Reddit",     icon: <MessageSquare className="h-4 w-4" />, bg: "bg-[#FF4500]" },
                youtube:   { label: "YouTube",    icon: <Youtube className="h-4 w-4" />,       bg: "bg-[#FF0000]" },
                devto:     { label: "Dev.to",     icon: <Code2 className="h-4 w-4" />,         bg: "bg-[#0A0A0A]" },
              };
              const socialProviders = providers.filter(p => SOCIAL_PLATFORMS[p.platform]);
              return (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    1 — Select Platforms
                  </p>
                  {socialProviders.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      No platforms connected yet.
                      <button
                        className="underline hover:text-foreground ml-auto shrink-0"
                        onClick={() => { setIsPublishModalOpen(false); router.push("/settings"); }}
                      >
                        Connect in Settings
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {socialProviders.map(p => {
                        const cfg = SOCIAL_PLATFORMS[p.platform]!;
                        const selected = publishPlatforms.includes(p.platform);
                        const progress = publishProgress[p.platform];
                        // Status-based border color overrides the default selected state
                        const borderClass =
                          progress?.status === "publishing" ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" :
                          progress?.status === "success" ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" :
                          progress?.status === "failed" ? "border-red-500 bg-red-50 ring-1 ring-red-500" :
                          selected ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500" : "hover:bg-muted/50";
                        return (
                          <button
                            key={p.platform}
                            disabled={isPublishing}
                            onClick={() => {
                              if (isPublishing) return;
                              setPublishPlatforms(prev =>
                                prev.includes(p.platform) ? prev.filter(x => x !== p.platform) : [...prev, p.platform]
                              );
                            }}
                            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${borderClass} disabled:cursor-not-allowed`}
                            title={progress?.error}
                          >
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white ${cfg.bg}`}>
                              {cfg.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium">{cfg.label}</p>
                              {progress?.status === "publishing" && (
                                <p className="text-[11px] text-blue-600 truncate">{scheduleValue ? "Scheduling…" : "Publishing…"}</p>
                              )}
                              {progress?.status === "success" && (
                                <p className="text-[11px] text-emerald-600 truncate">{scheduleValue ? "Scheduled ✓" : "Published ✓"}</p>
                              )}
                              {progress?.status === "failed" && (
                                <p className="text-[11px] text-red-600 line-clamp-2 wrap-break-word">{progress.error || "Failed"}</p>
                              )}
                              {!progress && p.page_name && <p className="text-[11px] text-muted-foreground truncate">{p.page_name}</p>}
                            </div>
                            {/* Right-side status indicator */}
                            {progress?.status === "publishing" ? (
                              <RefreshCw className="h-4 w-4 text-blue-600 shrink-0 animate-spin" />
                            ) : progress?.status === "success" ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                            ) : progress?.status === "failed" ? (
                              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                            ) : selected ? (
                              <CheckCircle2 className="h-4 w-4 text-purple-600 shrink-0" />
                            ) : !p.connected ? (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setIsPublishModalOpen(false); router.push("/settings"); }}
                                className="text-[11px] font-medium text-amber-600 hover:underline shrink-0 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-pointer"
                              >
                                Connect
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {publishPlatforms.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {publishPlatforms.length} platform{publishPlatforms.length > 1 ? "s" : ""} selected
                    </p>
                  )}

                  {/* Failed-platform error details — show full message inline */}
                  {Object.entries(publishProgress).filter(([, v]) => v.status === "failed").length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-red-700">Errors</p>
                      {Object.entries(publishProgress)
                        .filter(([, v]) => v.status === "failed")
                        .map(([platform, v]) => (
                          <div key={platform} className="text-xs text-red-700">
                            <span className="font-medium capitalize">{platform}:</span>{" "}
                            <span className="wrap-break-word">{v.error || "Unknown error"}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Section 2: Schedule (optional) ── */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                2 — Schedule (Optional)
              </p>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Pick a date/time to auto-publish. Leave empty to publish now.
                </p>
                <DateTimePicker value={scheduleValue} onChange={setScheduleValue} />
              </div>
            </div>

            {/* ── Section 3: Confirm ── */}
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 gap-1.5 bg-purple-500 hover:bg-purple-600 text-white"
                disabled={publishPlatforms.length === 0 || isPublishing}
                onClick={handleConfirmPublish}
              >
                {isPublishing
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {scheduleValue ? "Scheduling…" : "Publishing…"}</>
                  : <><Send className="h-3.5 w-3.5" /> {scheduleValue ? "Schedule" : "Publish Now"}</>
                }
              </Button>
              <Button variant="outline" onClick={() => setIsPublishModalOpen(false)}>
                Cancel
              </Button>
            </div>
            {publishPlatforms.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">Select at least one platform above</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
