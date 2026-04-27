"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Film,
  AlertTriangle,
  RefreshCw,
  Send,
  Trash2,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Copy,
  Check,
  Link2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { useSubscription } from "@/hooks/use-subscription";
import type { Reel, VoiceOption, VoicesResponse } from "@/types";

const REEL_CREDIT_COST = 4;

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "witty", label: "Witty" },
  { value: "casual", label: "Casual" },
  { value: "inspiring", label: "Inspiring" },
  { value: "educational", label: "Educational" },
];

const DURATIONS = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "60 seconds" },
];

// Status progress mapping
const STATUS_PROGRESS: Record<string, { progress: number; label: string }> = {
  pending: { progress: 5, label: "Initializing..." },
  generating_script: { progress: 15, label: "Generating script..." },
  script_ready: { progress: 100, label: "Script ready — review & generate video" },
  generating_audio: { progress: 30, label: "Creating voiceover..." },
  fetching_videos: { progress: 45, label: "Finding stock videos..." },
  generating_ai_video: { progress: 55, label: "Generating AI video..." },
  downloading_videos: { progress: 60, label: "Downloading videos..." },
  processing_video: { progress: 70, label: "Processing video..." },
  composing_video: { progress: 80, label: "Composing final video..." },
  ready: { progress: 100, label: "Ready!" },
  published: { progress: 100, label: "Published" },
  failed: { progress: 0, label: "Failed" },
  publish_failed: { progress: 100, label: "Publish failed" },
};

export default function ReelsPage() {
  const router = useRouter();
  const {
    canUseCredits,
    creditsRemaining,
    planSlug,
    refresh: refreshSubscription,
  } = useSubscription();

  // Form state
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [topicError, setTopicError] = useState("");
  const [tone, setTone] = useState("professional");
  const [voice, setVoice] = useState("en-US-JennyNeural");
  const [duration, setDuration] = useState(30);
  const [bioLink, setBioLink] = useState("");
  const [seoSaveId, setSeoSaveId] = useState<string>("");
  const [savedBriefs, setSavedBriefs] = useState<{ id: string; title: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // SEO caption state — keyed by reel id so we don't refetch on every selection.
  const [seoCaptions, setSeoCaptions] = useState<Record<string, {
    caption: string;
    primary_keyword: string;
    hashtags: string[];
    loading: boolean;
  }>>({});
  const [copiedCaption, setCopiedCaption] = useState(false);

  // Restore bio link from localStorage once on mount.
  useEffect(() => {
    const stored = localStorage.getItem("reel_bio_link");
    if (stored) setBioLink(stored);
  }, []);

  // Load the user's saved SEO briefs so they can reuse one for keyword grounding.
  useEffect(() => {
    api.get<{ id: string; type: string; title: string }[]>("/api/seo/saves")
      .then((res) => {
        setSavedBriefs(
          res.data.filter((s) => s.type === "brief").map((s) => ({ id: s.id, title: s.title })),
        );
      })
      .catch(() => { /* non-critical */ });
  }, []);
  useEffect(() => {
    localStorage.setItem("reel_bio_link", bioLink);
  }, [bioLink]);

  // Data state
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [loadingReels, setLoadingReels] = useState(true);
  const [selectedReel, setSelectedReel] = useState<Reel | null>(null);
  const [publishingReelId, setPublishingReelId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  // Fetch available voices
  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await api.get<VoicesResponse>("/api/reels/voices");
        setVoices(response.data.voices);
      } catch {
        console.error("Failed to load voices");
      }
    }
    fetchVoices();
  }, []);

  // Fetch user's reels
  const fetchReels = useCallback(async () => {
    setLoadingReels(true);
    try {
      const response = await api.get<Reel[]>("/api/reels");
      setReels(response.data);
      // Update selected reel without adding it as a dependency
      setSelectedReel(prev => {
        if (!prev) return prev;
        return response.data.find(r => r.id === prev.id) ?? prev;
      });
    } catch {
      toast.error("Failed to load reels");
    } finally {
      setLoadingReels(false);
    }
  }, []);

  useEffect(() => {
    fetchReels();
  }, []);

  // Poll for updates only while at least one reel is still processing
  useEffect(() => {
    const TERMINAL = ["script_ready", "ready", "published", "failed", "publish_failed"];
    const POLL_WINDOW_MS = 30 * 60 * 1000; // only poll reels created within last 30 minutes
    const now = Date.now();

    const hasRecentlyProcessing = reels.some(r => {
      if (TERMINAL.includes(r.status)) return false;
      const age = now - new Date(r.created_at).getTime();
      return age < POLL_WINDOW_MS;
    });

    if (!hasRecentlyProcessing) return;

    const interval = setInterval(async () => {
      try {
        const response = await api.get<Reel[]>("/api/reels");
        const fetched = response.data;
        setReels(fetched);
        setSelectedReel(prev => {
          if (!prev) return prev;
          return fetched.find(r => r.id === prev.id) ?? prev;
        });
        const stillProcessing = fetched.some(r => {
          if (TERMINAL.includes(r.status)) return false;
          const age = Date.now() - new Date(r.created_at).getTime();
          return age < POLL_WINDOW_MS;
        });
        if (!stillProcessing) clearInterval(interval);
      } catch {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [reels]);

  const validateTopic = (): boolean => {
    if (!topic.trim()) {
      setTopicError("Topic is required");
      return false;
    }
    setTopicError("");
    return true;
  };

  const handleGenerate = async () => {
    if (!validateTopic()) {
      toast.error("Please enter a topic for your reel");
      return;
    }
    if (!canUseCredits(REEL_CREDIT_COST)) {
      toast.error(`You'll need ${REEL_CREDIT_COST} credits to render the video.`);
      return;
    }

    setIsGenerating(true);
    try {
      const response = await api.post<Reel>("/api/reels", {
        topic,
        description,
        tone,
        voice,
        duration_target: duration,
        ...(seoSaveId ? { seo_save_id: seoSaveId } : {}),
      });

      setReels(prev => [response.data, ...prev]);
      setSelectedReel(response.data);
      setTopic("");
      setDescription("");
      toast.success("Script ready — review, then click Generate Video Reel.");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string }; status?: number } };
      if (err.response?.status === 402) {
        toast.error("Not enough credits! Upgrade your plan to continue.");
      } else {
        toast.error(err.response?.data?.detail || "Failed to generate script");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async (reel: Reel) => {
    if (!canUseCredits(REEL_CREDIT_COST)) {
      toast.error(`Not enough credits! Video rendering requires ${REEL_CREDIT_COST} credits.`);
      return;
    }
    setIsGeneratingVideo(true);
    try {
      const response = await api.post<Reel>(`/api/reels/${reel.id}/generate-video`);
      setReels(prev => prev.map(r => r.id === reel.id ? response.data : r));
      if (selectedReel?.id === reel.id) setSelectedReel(response.data);
      toast.success(`Video generation started. ${REEL_CREDIT_COST} credits used.`);
      refreshSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string }; status?: number } };
      if (err.response?.status === 402) {
        toast.error("Not enough credits! Upgrade your plan to continue.");
      } else {
        toast.error(err.response?.data?.detail || "Failed to start video generation");
      }
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handlePublish = async (reel: Reel) => {
    setPublishingReelId(reel.id);
    try {
      const captionOverride = seoCaptions[reel.id]?.caption || undefined;
      const response = await api.post<Reel>(
        `/api/reels/${reel.id}/publish`,
        captionOverride ? { caption_override: captionOverride } : {},
      );
      setReels(prev => prev.map(r => r.id === reel.id ? response.data : r));
      if (selectedReel?.id === reel.id) {
        setSelectedReel(response.data);
      }
      toast.success("Reel published to Instagram!");
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to publish reel");
    } finally {
      setPublishingReelId(null);
    }
  };

  const handleDelete = async (reel: Reel) => {
    if (!confirm("Are you sure you want to delete this reel?")) return;

    setIsDeleting(true);
    try {
      await api.delete(`/api/reels/${reel.id}`);
      setReels(prev => prev.filter(r => r.id !== reel.id));
      if (selectedReel?.id === reel.id) setSelectedReel(null);
      toast.success("Reel deleted");
    } catch {
      toast.error("Failed to delete reel");
    } finally {
      setIsDeleting(false);
    }
  };

  const deriveHook = (script: string): string => {
    const clean = script.replace(/\s+/g, " ").trim();
    const match = clean.match(/^(.+?[.!?])(\s|$)/);
    const first = (match ? match[1] : clean).trim();
    return first.length > 160 ? first.slice(0, 157).trimEnd() + "…" : first;
  };

  const buildSeoCaption = useCallback(
    (hook: string, hashtags: string[], link: string): string => {
      const tagLine = hashtags.map((h) => `#${h}`).join(" ");
      const cta = link.trim()
        ? `Link in bio 👇 ${link.trim()}`
        : "Link in bio 👇";
      return [hook, "", cta, "", tagLine].filter((l) => l !== undefined).join("\n");
    },
    [],
  );

  useEffect(() => {
    if (!selectedReel || !selectedReel.script) return;
    if (seoCaptions[selectedReel.id]) return;
    const reelId = selectedReel.id;
    const script = selectedReel.script;

    const storedHashtags = (selectedReel.hashtags || "")
      .split(/\s+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 5);

    if (selectedReel.primary_keyword && storedHashtags.length) {
      const hook = deriveHook(script);
      const caption = buildSeoCaption(hook, storedHashtags, bioLink);
      setSeoCaptions((prev) => ({
        ...prev,
        [reelId]: {
          caption,
          primary_keyword: selectedReel.primary_keyword || "",
          hashtags: storedHashtags,
          loading: false,
        },
      }));
      return;
    }

    // Legacy reel — fetch keywords fresh.
    const topicForReel = selectedReel.topic;
    setSeoCaptions((prev) => ({
      ...prev,
      [reelId]: { caption: "", primary_keyword: "", hashtags: [], loading: true },
    }));
    api
      .post<{ primary_keyword: string; hashtags: string[] }>(
        "/api/seo/keywords",
        { topic: topicForReel },
      )
      .then((res) => {
        const hook = deriveHook(script);
        const caption = buildSeoCaption(hook, res.data.hashtags, bioLink);
        setSeoCaptions((prev) => ({
          ...prev,
          [reelId]: {
            caption,
            primary_keyword: res.data.primary_keyword,
            hashtags: res.data.hashtags,
            loading: false,
          },
        }));
      })
      .catch(() => {
        setSeoCaptions((prev) => ({
          ...prev,
          [reelId]: { caption: "", primary_keyword: "", hashtags: [], loading: false },
        }));
      });
  }, [selectedReel, bioLink, buildSeoCaption, seoCaptions]);

  // Rebuild the caption text when the user edits the bio link, without refetching.
  useEffect(() => {
    setSeoCaptions((prev) => {
      const next: typeof prev = {};
      let changed = false;
      for (const [id, entry] of Object.entries(prev)) {
        if (!entry.hashtags.length) { next[id] = entry; continue; }
        const reel = reels.find((r) => r.id === id);
        if (!reel?.script) { next[id] = entry; continue; }
        const hook = deriveHook(reel.script);
        const rebuilt = buildSeoCaption(hook, entry.hashtags, bioLink);
        if (rebuilt !== entry.caption) changed = true;
        next[id] = { ...entry, caption: rebuilt };
      }
      return changed ? next : prev;
    });
  }, [bioLink, reels, buildSeoCaption]);

  const copySeoCaption = async (caption: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 1500);
      toast.success("SEO caption copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const getStatusBadge = (status: string) => {
    const statusInfo = STATUS_PROGRESS[status] || { label: status };

    if (status === "script_ready") {
      return <Badge className="bg-violet-500"><Sparkles className="h-3 w-3 mr-1" /> Script ready</Badge>;
    }
    if (status === "ready") {
      return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Ready</Badge>;
    }
    if (status === "published") {
      return <Badge className="bg-blue-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Published</Badge>;
    }
    if (status === "failed" || status === "publish_failed") {
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> {statusInfo.label}</Badge>;
    }
    return (
      <Badge variant="secondary">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        {statusInfo.label}
      </Badge>
    );
  };

  const showLowCreditsWarning = creditsRemaining !== Infinity && creditsRemaining < REEL_CREDIT_COST && creditsRemaining > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Create Reel</h1>
        <p className="text-muted-foreground">
          Generate AI-powered Instagram Reels with voiceover and stock videos.
        </p>
      </div>

      {showLowCreditsWarning && (
        <Alert variant="destructive" className="bg-yellow-50 border-yellow-200 text-yellow-800">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              You have {creditsRemaining} credit{creditsRemaining !== 1 ? "s" : ""} remaining.
              Reel generation requires {REEL_CREDIT_COST} credits.
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

      {creditsRemaining < REEL_CREDIT_COST && creditsRemaining !== Infinity && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Not enough credits for reel generation. You need at least {REEL_CREDIT_COST} credits.
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

      <Tabs defaultValue="create" className="space-y-4">
        <TabsList>
          <TabsTrigger value="create">Create New</TabsTrigger>
          <TabsTrigger value="history">
            My Reels {reels.length > 0 && `(${reels.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Film className="h-5 w-5" />
                  Reel Settings
                </CardTitle>
                <CardDescription>
                  Configure your reel. Generation costs {REEL_CREDIT_COST} credits.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">
                    Topic <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="topic"
                    placeholder="e.g., Launching a new project-management tool"
                    value={topic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      if (topicError) setTopicError("");
                    }}
                    rows={2}
                    className={topicError ? "border-red-500" : ""}
                  />
                  {topicError && (
                    <p className="text-sm text-red-500">{topicError}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Add context the AI should use — e.g. 'Kanban-style SaaS for remote teams, charges $12/user/mo, launching Friday, key differentiator is offline sync.'"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={800}
                  />
                  <p className="text-xs text-muted-foreground">
                    The script will reflect these details accurately. {description.length}/800
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tone</Label>
                    <Select value={tone} onValueChange={setTone}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TONES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Duration</Label>
                    <Select
                      value={duration.toString()}
                      onValueChange={(v) => setDuration(parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATIONS.map((d) => (
                          <SelectItem key={d.value} value={d.value.toString()}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Voice</Label>
                  <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {voices.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <div className="flex items-center gap-2">
                            <span>{v.name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({v.gender}, {v.language})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {voices.find(v => v.id === voice)?.description && (
                    <p className="text-xs text-muted-foreground">
                      {voices.find(v => v.id === voice)?.description}
                    </p>
                  )}
                </div>

                {savedBriefs.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      Connect SEO brief (optional)
                    </Label>
                    <Select value={seoSaveId || "none"} onValueChange={(v) => setSeoSaveId(v === "none" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="None — derive keywords from topic" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None — derive keywords from topic</SelectItem>
                        {savedBriefs.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Reuses the brief&apos;s primary keyword so your Reel, Blog, and Social stay aligned.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="bio-link" className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />
                    Bio link (optional)
                  </Label>
                  <Input
                    id="bio-link"
                    type="url"
                    placeholder="https://your-site.com/landing-page"
                    value={bioLink}
                    onChange={(e) => setBioLink(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Added to the SEO caption as a &ldquo;Link in bio&rdquo; CTA. Saved locally.
                  </p>
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || creditsRemaining < REEL_CREDIT_COST}
                  className="w-full gap-2"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Generating Script...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Script (Free — {REEL_CREDIT_COST} credits for video)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Right: Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>
                  {selectedReel
                    ? "Your reel preview and status"
                    : "Select a reel or generate a new one"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedReel ? (
                  <div className="space-y-4">
                    {/* Status */}
                    <div className="flex items-center justify-between">
                      {getStatusBadge(selectedReel.status)}
                      <span className="text-xs text-muted-foreground">
                        {new Date(selectedReel.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Progress bar for processing (hidden on terminal states) */}
                    {!["script_ready", "ready", "published", "failed", "publish_failed"].includes(selectedReel.status) && (
                      <div className="space-y-2">
                        <Progress value={STATUS_PROGRESS[selectedReel.status]?.progress || 0} />
                        <p className="text-sm text-center text-muted-foreground">
                          {STATUS_PROGRESS[selectedReel.status]?.label || "Processing..."}
                        </p>
                      </div>
                    )}

                    {/* Error message */}
                    {selectedReel.error_message && (
                      <Alert variant="destructive">
                        <AlertDescription>{selectedReel.error_message}</AlertDescription>
                      </Alert>
                    )}

                    {/* Video preview */}
                    {selectedReel.video_url && (
                      <div className="relative aspect-[9/16] bg-black rounded-lg overflow-hidden max-h-[400px]">
                        <video
                          src={selectedReel.video_url}
                          controls
                          className="w-full h-full object-contain"
                          poster={selectedReel.thumbnail_url || undefined}
                        />
                      </div>
                    )}

                    {/* Script */}
                    {selectedReel.script && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Script</Label>
                          {selectedReel.primary_keyword && (
                            <span className="text-xs text-muted-foreground">
                              Primary keyword:{" "}
                              <span className="font-medium text-foreground">
                                {selectedReel.primary_keyword}
                              </span>
                            </span>
                          )}
                        </div>
                        <div className="p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                          {selectedReel.script}
                        </div>
                      </div>
                    )}

                    {/* Hashtags */}
                    {selectedReel.hashtags && (
                      <div className="space-y-2">
                        <Label>Hashtags</Label>
                        <div className="p-3 bg-muted rounded-lg text-sm">
                          {selectedReel.hashtags}
                        </div>
                      </div>
                    )}

                    {/* SEO Caption — keyword-rich caption with bio-link CTA */}
                    {selectedReel.script && (() => {
                      const entry = seoCaptions[selectedReel.id];
                      return (
                        <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                          <div className="flex items-center justify-between">
                            <Label className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400">
                              <Sparkles className="h-3.5 w-3.5" />
                              SEO Caption
                            </Label>
                            {entry?.caption && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copySeoCaption(entry.caption)}
                                className="h-7 gap-1.5 text-xs"
                              >
                                {copiedCaption ? (
                                  <><Check className="h-3 w-3" /> Copied</>
                                ) : (
                                  <><Copy className="h-3 w-3" /> Copy</>
                                )}
                              </Button>
                            )}
                          </div>
                          {entry?.loading ? (
                            <p className="text-xs text-muted-foreground flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Building keyword-rich caption…
                            </p>
                          ) : entry?.caption ? (
                            <>
                              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                                {entry.caption}
                              </pre>
                              {entry.primary_keyword && (
                                <p className="text-xs text-muted-foreground">
                                  Primary keyword:{" "}
                                  <span className="font-medium text-foreground">
                                    {entry.primary_keyword}
                                  </span>
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Couldn&apos;t build SEO caption — script will still publish as-is.
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {(selectedReel.status === "script_ready" || selectedReel.status === "failed") && (
                        <Button
                          onClick={() => handleGenerateVideo(selectedReel)}
                          disabled={isGeneratingVideo || creditsRemaining < REEL_CREDIT_COST}
                          className="flex-1 gap-2"
                        >
                          {isGeneratingVideo ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              Starting...
                            </>
                          ) : (
                            <>
                              <Film className="h-4 w-4" />
                              {selectedReel.status === "failed" ? "Retry" : "Generate"} Video Reel ({REEL_CREDIT_COST} credits)
                            </>
                          )}
                        </Button>
                      )}
                      {selectedReel.status === "ready" && (
                        <Button
                          onClick={() => handlePublish(selectedReel)}
                          disabled={publishingReelId === selectedReel.id}
                          className="flex-1 gap-2"
                        >
                          {publishingReelId === selectedReel.id ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              Publishing...
                            </>
                          ) : (
                            <>
                              <Send className="h-4 w-4" />
                              Publish to Instagram
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => handleDelete(selectedReel)}
                        disabled={isDeleting}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Film className="h-12 w-12 mb-4 opacity-50" />
                    <p>No reel selected</p>
                    <p className="text-sm">Create a new reel or select from history</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>My Reels</CardTitle>
              <CardDescription>
                View and manage your generated reels
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingReels ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : reels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Film className="h-8 w-8 mb-2 opacity-50" />
                  <p>No reels yet</p>
                  <p className="text-sm">Create your first reel above</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {reels.map((reel) => (
                    <Card
                      key={reel.id}
                      className={`cursor-pointer transition-colors hover:bg-accent ${
                        selectedReel?.id === reel.id ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={() => setSelectedReel(reel)}
                    >
                      <CardContent className="p-4">
                        {/* Thumbnail */}
                        <div className="relative aspect-[9/16] bg-muted rounded-lg overflow-hidden mb-3 max-h-[200px]">
                          {reel.thumbnail_url ? (
                            <img
                              src={reel.thumbnail_url}
                              alt={reel.topic}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              {["ready", "published"].includes(reel.status) ? (
                                <Play className="h-8 w-8 text-muted-foreground" />
                              ) : (
                                <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                              )}
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="space-y-2">
                          <p className="font-medium line-clamp-2 text-sm">
                            {reel.topic}
                          </p>
                          <div className="flex items-center justify-between">
                            {getStatusBadge(reel.status)}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {reel.duration_target}s
                            </span>
                          </div>

                          {/* Generate Video button for script-ready reels */}
                          {reel.status === "script_ready" && (
                            <Button
                              size="sm"
                              className="w-full gap-2 mt-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateVideo(reel);
                              }}
                              disabled={isGeneratingVideo || creditsRemaining < REEL_CREDIT_COST}
                            >
                              <Film className="h-3 w-3" />
                              Generate Video ({REEL_CREDIT_COST})
                            </Button>
                          )}
                          {/* Publish button for ready reels */}
                          {reel.status === "ready" && (
                            <Button
                              size="sm"
                              className="w-full gap-2 mt-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePublish(reel);
                              }}
                              disabled={publishingReelId === reel.id}
                            >
                              {publishingReelId === reel.id ? (
                                <>
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  Publishing...
                                </>
                              ) : (
                                <>
                                  <Send className="h-3 w-3" />
                                  Publish to Instagram
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
