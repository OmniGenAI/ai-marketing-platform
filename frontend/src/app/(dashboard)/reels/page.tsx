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
  Coins,
  AlertTriangle,
  RefreshCw,
  Send,
  Trash2,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
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
  generating_audio: { progress: 30, label: "Creating voiceover..." },
  fetching_videos: { progress: 45, label: "Finding stock videos..." },
  downloading_videos: { progress: 60, label: "Downloading videos..." },
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
  const [topicError, setTopicError] = useState("");
  const [tone, setTone] = useState("professional");
  const [voice, setVoice] = useState("en-US-JennyNeural");
  const [duration, setDuration] = useState(30);
  const [isGenerating, setIsGenerating] = useState(false);

  // Data state
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [loadingReels, setLoadingReels] = useState(true);
  const [selectedReel, setSelectedReel] = useState<Reel | null>(null);
  const [publishingReelId, setPublishingReelId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    const TERMINAL = ["ready", "published", "failed", "publish_failed"];
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
      toast.error(`Not enough credits! Reel generation requires ${REEL_CREDIT_COST} credits.`);
      return;
    }

    setIsGenerating(true);
    try {
      const response = await api.post<Reel>("/api/reels", {
        topic,
        tone,
        voice,
        duration_target: duration,
      });

      setReels(prev => [response.data, ...prev]);
      setSelectedReel(response.data);
      setTopic("");
      toast.success(`Reel generation started! ${REEL_CREDIT_COST} credits used.`);
      refreshSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string }; status?: number } };
      if (err.response?.status === 402) {
        toast.error("Not enough credits! Upgrade your plan to continue.");
      } else {
        toast.error(err.response?.data?.detail || "Failed to start reel generation");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = async (reel: Reel) => {
    setPublishingReelId(reel.id);
    try {
      const response = await api.post<Reel>(`/api/reels/${reel.id}/publish`);
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

  const formatCredits = (credits: number) => {
    if (credits === Infinity || credits === -1) return "Unlimited";
    return credits.toString();
  };

  const getStatusBadge = (status: string) => {
    const statusInfo = STATUS_PROGRESS[status] || { label: status };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Create Reel</h1>
          <p className="text-muted-foreground">
            Generate AI-powered Instagram Reels with voiceover and stock videos.
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
                    placeholder="e.g., Street Food Business Tips, Morning Coffee Routine, Fitness Motivation..."
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

                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || creditsRemaining < REEL_CREDIT_COST}
                  className="w-full gap-2"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Starting Generation...
                    </>
                  ) : (
                    <>
                      <Film className="h-4 w-4" />
                      Generate Reel ({REEL_CREDIT_COST} Credits)
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

                    {/* Progress bar for processing */}
                    {!["ready", "published", "failed", "publish_failed"].includes(selectedReel.status) && (
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
                        <Label>Script</Label>
                        <div className="p-3 bg-muted rounded-lg text-sm">
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

                    {/* Actions */}
                    <div className="flex gap-2">
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
