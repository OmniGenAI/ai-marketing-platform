"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Recycle,
  Copy,
  Link as LinkIcon,
  FileText,
  Sparkles,
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings2,
  FolderOpen,
} from "lucide-react";

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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible } from "@/components/ui/collapsible";

import { GoalSelector } from "@/components/repurpose/GoalSelector";
import { VoiceTileGrid } from "@/components/repurpose/VoiceTileGrid";
import { PlatformChips } from "@/components/repurpose/PlatformChips";
import { HookVariationsCard } from "@/components/repurpose/HookVariationsCard";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import { PostPreviewLinkedIn } from "@/components/repurpose/PostPreviewLinkedIn";
import { PostPreviewTwitter } from "@/components/repurpose/PostPreviewTwitter";
import { PostPreviewInstagram } from "@/components/repurpose/PostPreviewInstagram";
import { PostPreviewFacebook } from "@/components/repurpose/PostPreviewFacebook";
import { PostPreviewEmail } from "@/components/repurpose/PostPreviewEmail";
import { PostPreviewYouTube } from "@/components/repurpose/PostPreviewYouTube";
import { PostPreviewQuotes } from "@/components/repurpose/PostPreviewQuotes";
import { PostPreviewCarousel } from "@/components/repurpose/PostPreviewCarousel";

import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import { useRepurposeAutosave, type SaveStatus } from "@/hooks/use-repurpose-autosave";
import type {
  BlogSaveItem,
  ContentGoal,
  CtaStyle,
  PlatformKey,
  RegenerateResponse,
  RepurposeResponse,
  RewritePreset,
  RewriteSection,
  VoicePreset,
} from "@/types";

type SourceMode = "paste" | "saved";

const ALL_PLATFORMS: PlatformKey[] = [
  "linkedin", "twitter", "email", "youtube", "instagram", "facebook", "quotes", "carousel",
];

const CTA_STYLES: { value: CtaStyle; label: string }[] = [
  { value: "soft", label: "Soft — 'Read more →'" },
  { value: "hard", label: "Hard — 'Sign up / Try it'" },
  { value: "curiosity", label: "Curiosity gap" },
  { value: "none", label: "No CTA" },
];

function RepurposePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSaveId = searchParams.get("id");
  const {
    canUseCredits,
    creditsRemaining,
    planSlug,
    refresh: refreshSubscription,
  } = useSubscription();

  // Source selection
  const [sourceMode, setSourceMode] = useState<SourceMode>("saved");
  const [savedBlogs, setSavedBlogs] = useState<BlogSaveItem[]>([]);
  const [selectedBlogId, setSelectedBlogId] = useState<string>("");
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedContent, setPastedContent] = useState("");

  // Primary signals (new)
  const [goal, setGoal] = useState<ContentGoal>("authority");
  const [voice, setVoice] = useState<VoicePreset>("founder_pov");
  const [platforms, setPlatforms] = useState<PlatformKey[]>(ALL_PLATFORMS);
  const [variationsPerPlatform, setVariationsPerPlatform] = useState(1);
  const [variationsAcrossVoices, setVariationsAcrossVoices] = useState(false);
  const [includeHooks, setIncludeHooks] = useState(true);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [ctaStyle, setCtaStyle] = useState<CtaStyle>("soft");

  // Advanced SEO (collapsed by default)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [secondaryKeywordsInput, setSecondaryKeywordsInput] = useState("");

  // Runtime
  const [isRepurposing, setIsRepurposing] = useState(false);
  const [result, setResult] = useState<RepurposeResponse | null>(null);

  // Per-platform variation cursors
  const [liIndex, setLiIndex] = useState(0);
  const [igIndex, setIgIndex] = useState(0);
  const [fbIndex, setFbIndex] = useState(0);

  // Regenerate state
  const [regenSection, setRegenSection] = useState<RewriteSection | null>(null);
  const [regenPreset, setRegenPreset] = useState<RewritePreset | "fresh" | null>(null);
  const [freeRerollsRemaining, setFreeRerollsRemaining] = useState<number | null>(null);

  // Elapsed time counter
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Autosave — pause while regenerating (LLM is about to overwrite formats anyway)
  const { status: autosaveStatus, lastSavedAt } = useRepurposeAutosave({
    saveId: result?.save_id ?? null,
    formats: result?.formats ?? null,
    enabled: !isRepurposing && regenSection === null,
  });

  const selectedBlog = useMemo(
    () => savedBlogs.find((b) => b.id === selectedBlogId),
    [savedBlogs, selectedBlogId],
  );

  // Load existing repurpose save when ?id=... is in URL
  useEffect(() => {
    if (!urlSaveId) return;
    if (result?.save_id === urlSaveId) return;
    (async () => {
      try {
        const res = await api.get<RepurposeResponse>(`/api/repurpose/saves/${urlSaveId}`);
        setResult(res.data);
        setLiIndex(0);
        setIgIndex(0);
        setFbIndex(0);
        if (res.data.source_url) setSourceUrl(res.data.source_url);
        if (res.data.voice) setVoice(res.data.voice as VoicePreset);
        if (res.data.goal) setGoal(res.data.goal as ContentGoal);
        if (res.data.platforms) setPlatforms(res.data.platforms as PlatformKey[]);
      } catch {
        toast.error("Couldn't load that repurpose. It may have been deleted.");
        router.replace("/generate/repurpose/new");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSaveId]);

  const handleNewRepurpose = () => {
    setResult(null);
    setLiIndex(0);
    setIgIndex(0);
    setFbIndex(0);
    setRegenSection(null);
    setRegenPreset(null);
    setFreeRerollsRemaining(null);
    setSourceUrl("");
    setPrimaryKeyword("");
    setSecondaryKeywordsInput("");
    setVoice("founder_pov");
    setGoal("authority");
    setPlatforms(ALL_PLATFORMS);
    setPastedTitle("");
    setPastedContent("");
    router.replace("/generate/repurpose/new");
  };

  // Load saved blogs
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<BlogSaveItem[]>("/api/blog/saves");
        setSavedBlogs(res.data || []);
      } catch {
        /* silent */
      }
    })();
  }, []);

  // Persist source URL
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("repurpose_source_url") : null;
    if (saved) setSourceUrl(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("repurpose_source_url", sourceUrl);
    }
  }, [sourceUrl]);

  // Auto-fill keywords from selected blog
  useEffect(() => {
    if (!selectedBlog) return;
    if (!primaryKeyword && selectedBlog.data?.primary_keyword) {
      setPrimaryKeyword(selectedBlog.data.primary_keyword);
    }
    if (!secondaryKeywordsInput && (selectedBlog.data?.secondary_keywords || []).length) {
      setSecondaryKeywordsInput(
        (selectedBlog.data?.secondary_keywords || []).slice(0, 5).join(", "),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlogId]);

  // Elapsed time counter
  useEffect(() => {
    if (!isRepurposing) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRepurposing]);

  const validate = (): string | null => {
    if (!sourceUrl.trim()) return "Source URL is required so every format can link back.";
    if (sourceMode === "saved" && !selectedBlogId) return "Pick a saved blog or switch to Paste.";
    if (sourceMode === "paste") {
      if (!pastedContent.trim()) return "Paste the blog content.";
      if (pastedContent.trim().length < 200) return "Content needs at least 200 characters.";
    }
    if (platforms.length === 0) return "Select at least one platform.";
    return null;
  };

  const handleRepurpose = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      if (err.startsWith("Source URL")) setAdvancedOpen(true);
      return;
    }
    if (!canUseCredits(1)) {
      toast.error("Not enough credits! Upgrade your plan.");
      return;
    }

    setIsRepurposing(true);
    setResult(null);
    setLiIndex(0);
    setIgIndex(0);
    setFbIndex(0);
    try {
      const secondary_keywords = secondaryKeywordsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);

      const base = {
        source_url: sourceUrl.trim(),
        primary_keyword: primaryKeyword.trim() || null,
        secondary_keywords,
        voice,
        goal,
        cta_style: ctaStyle,
        platforms,
        variations_per_platform: variationsPerPlatform,
        variations_across_voices: variationsAcrossVoices && variationsPerPlatform > 1,
        include_hook_variations: includeHooks,
      };
      const payload =
        sourceMode === "saved"
          ? { ...base, blog_save_id: selectedBlogId }
          : { ...base, blog_title: pastedTitle.trim() || null, blog_content: pastedContent.trim() };

      const res = await api.post<RepurposeResponse>("/api/repurpose", payload);
      setResult(res.data);
      if (res.data.save_id) {
        router.replace(`/generate/repurpose/new?id=${res.data.save_id}`, { scroll: false });
      }
      toast.success(`Generated for ${res.data.platforms.length} platforms — 1 credit used.`);
      refreshSubscription();
    } catch (error: unknown) {
      const e = error as {
        response?: { status?: number; data?: { detail?: string | { msg: string }[] } };
      };
      const detail = e.response?.data?.detail;
      if (e.response?.status === 402) {
        toast.error("Not enough credits! Upgrade your plan.");
      } else if (e.response?.status === 404) {
        toast.error(typeof detail === "string" ? detail : "Blog save not found.");
      } else if (e.response?.status === 422) {
        if (Array.isArray(detail) && detail[0]?.msg) toast.error(detail[0].msg);
        else toast.error("Please fill in all required fields.");
      } else if (!e.response) {
        toast.error("Network error: Cannot reach the server.");
      } else {
        toast.error(typeof detail === "string" ? detail : "Failed to repurpose. Please try again.");
      }
    } finally {
      setIsRepurposing(false);
    }
  };

  const handleRegenerate = async (
    section: RewriteSection,
    preset: RewritePreset | null,
    variantIndex: number,
  ) => {
    if (!result?.save_id) return;
    setRegenSection(section);
    setRegenPreset(preset ?? "fresh");
    try {
      const res = await api.post<RegenerateResponse>(
        `/api/repurpose/saves/${result.save_id}/regenerate`,
        {
          section,
          variant_index: variantIndex,
          preset: preset ?? null,
          instruction: null,
        },
      );
      setResult((prev) => (prev ? { ...prev, formats: res.data.formats } : prev));
      setFreeRerollsRemaining(res.data.free_rerolls_remaining);
      if (res.data.credits_charged > 0) {
        toast.success(`${prettySection(section)} regenerated — 1 credit used.`);
        refreshSubscription();
      } else {
        toast.success(
          `${prettySection(section)} regenerated — ${res.data.free_rerolls_remaining} free reroll${res.data.free_rerolls_remaining === 1 ? "" : "s"
          } left today.`,
        );
      }
    } catch (error: unknown) {
      const e = error as {
        response?: { status?: number; data?: { detail?: string } };
      };
      const detail = e.response?.data?.detail;
      if (e.response?.status === 402) {
        toast.error(typeof detail === "string" ? detail : "Daily free rerolls used — need 1 credit.");
      } else if (e.response?.status === 404) {
        toast.error("Repurpose save not found.");
      } else {
        toast.error(typeof detail === "string" ? detail : "Regenerate failed. Please retry.");
      }
    } finally {
      setRegenSection(null);
      setRegenPreset(null);
    }
  };

  // Edit helpers — mutate the local result state
  const mutateFormats = (mut: (f: NonNullable<RepurposeResponse>["formats"]) => void) => {
    setResult((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next.formats);
      return next;
    });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  const swapLinkedInHook = (hook: string) => {
    mutateFormats((f) => {
      if (f.linkedin_posts.length === 0) return;
      const current = f.linkedin_posts[liIndex] || "";
      const lines = current.split("\n");
      if (lines.length > 0) lines[0] = hook;
      f.linkedin_posts[liIndex] = lines.join("\n");
      f.linkedin_post = f.linkedin_posts[0] || "";
    });
  };

  const swapTwitterHook = (hook: string) => {
    mutateFormats((f) => {
      if (f.twitter_thread.length === 0) f.twitter_thread = [hook];
      else f.twitter_thread[0] = hook;
    });
  };

  const showLowCreditsWarning =
    creditsRemaining !== Infinity && creditsRemaining <= 3 && creditsRemaining > 0;

  const platformSet = new Set(result?.platforms ?? []);

  return (
    <div className="relative">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={() => router.push("/generate/repurpose")}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span>/</span>
        <span className="text-foreground font-medium">Content Repurposing</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Recycle className="h-7 w-7 text-purple-600" />
            Content Repurposing
          </h1>
          <p className="text-muted-foreground">
            Turn one blog into platform-native content with your voice, goal, and hook of choice.
          </p>
        </div>
        {result && (
          <Button
            variant="outline"
            className="gap-2 border-purple-200 text-purple-700 hover:bg-purple-50 shrink-0"
            onClick={handleNewRepurpose}
          >
            <Plus className="h-4 w-4" />
            New Repurpose
          </Button>
        )}
      </div>

      {(showLowCreditsWarning || creditsRemaining === 0) && (
        <span className="absolute top-0 right-0 flex items-center gap-3 w-fit ">
          {showLowCreditsWarning && (
            <Alert variant="destructive" className="w-fit bg-yellow-50 border-yellow-200 text-yellow-800">
              <AlertTriangle className="h-4 w-4 mt-2" />
              <AlertDescription className="flex items-center justify-between">
                <span>You have {creditsRemaining} credits remaining.</span>
                <Button variant="outline" size="sm" onClick={() => router.push("/subscription")} className="ml-4">
                  Upgrade Plan
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {creditsRemaining === 0 && (
            <Alert variant="destructive" className={`w-fit bg-red-50 border-red-200 text-red-800 `}>
              <AlertTriangle className="h-4 w-4 mt-1" />
              <AlertDescription className="flex items-center justify-between">
                <span>You have no credits remaining.</span>
                <Button variant="default" size="sm" onClick={() => router.push("/subscription")} className="ml-4">
                  Upgrade Now
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </span>
      )}

      <div
        className={`grid gap-6 ${inputCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[440px_1fr]"
          } relative`}
      >
        {/* Collapse / expand rail (desktop only) */}
        {!isRepurposing && (
          <button
            type="button"
            onClick={() => setInputCollapsed((v) => !v)}
            title={inputCollapsed ? "Show input panel" : "Hide input panel"}
            className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 z-20 h-16 w-5 items-center justify-center rounded-r-md border border-l-0 border-purple-200 bg-white text-purple-700 shadow-sm hover:bg-purple-50 transition-all ${inputCollapsed ? "left-0" : "left-[439px]"
              }`}
          >
            {inputCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}

        {/* INPUT */}
        <Card
          className={`border-purple-200 h-[calc(100vh-13rem)] flex flex-col gap-0 overflow-hidden ${inputCollapsed ? "hidden" : ""
            }`}
        >
          <CardHeader className="shrink-0  mb-3 border-b">
            <CardTitle className="text-purple-900">Source & Style</CardTitle>
            <CardDescription>Paste content or pick a saved blog, then tune voice + goal.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-5 pb-6 scrollbar-thin">
            {/* Source — hero */}
            <Tabs value={sourceMode} onValueChange={(v) => setSourceMode(v as SourceMode)}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="saved">Saved blog</TabsTrigger>
                <TabsTrigger value="paste">Paste content</TabsTrigger>
              </TabsList>

              <TabsContent value="paste" className="space-y-2 mt-3">
                <Input
                  placeholder="Blog title (optional)"
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                />
                <Textarea
                  placeholder="Paste the full blog post here. Markdown or plain text — 200 chars minimum."
                  rows={7}
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  {pastedContent.length} chars{pastedContent.length < 200 ? " (need 200+)" : ""}
                </p>
              </TabsContent>

              <TabsContent value="saved" className="space-y-2 mt-3">
                <Select value={selectedBlogId} onValueChange={setSelectedBlogId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={savedBlogs.length ? "Choose a blog…" : "No blogs yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {savedBlogs.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.title || "Untitled"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {savedBlogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No saved blogs.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => router.push("/blog")}
                    >
                      Generate one
                    </button>
                    .
                  </p>
                ) : selectedBlog?.data?.primary_keyword ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-purple-600" />
                    Detected keyword:{" "}
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-transparent">
                      {selectedBlog.data.primary_keyword}
                    </Badge>
                  </p>
                ) : null}
              </TabsContent>
            </Tabs>

            <Separator />

            {/* Goal */}
            <div className="space-y-2">
              <Label>Goal</Label>
              <GoalSelector value={goal} onChange={setGoal} />
            </div>

            {/* Voice */}
            <div className="space-y-2">
              <Label>Voice</Label>
              <VoiceTileGrid value={voice} onChange={setVoice} />
            </div>

            {/* Platforms */}
            <div className="space-y-2">
              <Label>Platforms</Label>
              <PlatformChips value={platforms} onChange={setPlatforms} />
            </div>

            {/* Variations + Hooks + CTA */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Variations per LI/IG/FB</Label>
                <Select
                  value={String(variationsPerPlatform)}
                  onValueChange={(v) => setVariationsPerPlatform(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} angle{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">CTA style</Label>
                <Select value={ctaStyle} onValueChange={(v) => setCtaStyle(v as CtaStyle)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_STYLES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-purple-600"
                checked={includeHooks}
                onChange={(e) => setIncludeHooks(e.target.checked)}
              />
              Generate 5 hook variations (curiosity, contrarian, data, story, bold)
            </label>

            <label
              className={cn(
                "flex items-start gap-2 text-xs select-none rounded-md border p-2 transition",
                variationsPerPlatform > 1
                  ? "cursor-pointer border-purple-200 bg-purple-50/40 hover:bg-purple-50"
                  : "cursor-not-allowed border-muted-foreground/20 bg-muted/30 opacity-60",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-purple-600 mt-0.5"
                checked={variationsAcrossVoices && variationsPerPlatform > 1}
                disabled={variationsPerPlatform <= 1}
                onChange={(e) => setVariationsAcrossVoices(e.target.checked)}
              />
              <div className="min-w-0">
                <p className="font-semibold">Vary voice across angles (A/B mode)</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  Each LinkedIn / Instagram / Facebook angle is written in a different voice —
                  founder, contrarian, story, data, educational — so you can A/B which style
                  lands best. Still 1 credit.
                  {variationsPerPlatform <= 1 && " (Requires 2+ variations)"}
                </p>
              </div>
            </label>

            {/* Advanced SEO — collapsed */}
            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              trigger={
                <span className="flex items-center gap-2 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  Advanced SEO {sourceUrl ? <Badge variant="outline" className="ml-1">URL set</Badge> : null}
                </span>
              }
            >
              <div className="space-y-3 mt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="source-url" className="flex items-center gap-1.5 text-xs">
                    <LinkIcon className="h-3 w-3" />
                    Source URL <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="source-url"
                    type="url"
                    placeholder="https://yourblog.com/post-slug"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Primary keyword</Label>
                  <Input
                    placeholder="e.g., content marketing for SaaS"
                    value={primaryKeyword}
                    onChange={(e) => setPrimaryKeyword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Secondary keywords (comma-separated)</Label>
                  <Input
                    placeholder="content strategy, SaaS blogs, B2B marketing"
                    value={secondaryKeywordsInput}
                    onChange={(e) => setSecondaryKeywordsInput(e.target.value)}
                  />
                </div>
              </div>
            </Collapsible>
          </CardContent>
          <div className="px-6 pt-3 shrink-0 border-t">
            <Button
              onClick={handleRepurpose}
              disabled={isRepurposing || creditsRemaining === 0}
              className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              size="lg"
            >
              {isRepurposing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Repurposing — {elapsedSeconds}s
                </>
              ) : (
                <>
                  <Recycle className="h-4 w-4" />
                  Repurpose (1 Credit)
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* OUTPUT */}
        <div className="space-y-4 h-[calc(100vh-13rem)] overflow-y-auto scrollbar-thin">
          {result ? (
            <>
              {/* Meta bar */}
              <div className="flex items-center gap-2 flex-wrap ">
                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-transparent">
                  Voice: {result.voice.replace("_", " ")}
                </Badge>
                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-transparent">
                  Goal: {result.goal}
                </Badge>
                {result.keywords_used.slice(0, 3).map((k) => (
                  <Badge key={k} variant="outline" className="border-purple-200 text-purple-700">
                    {k}
                  </Badge>
                ))}
                <SaveStatusBadge status={autosaveStatus} lastSavedAt={lastSavedAt} />
              </div>


              {/* Hook variations (pinned top) */}
              {result.formats.hook_variations.length > 0 && (
                <div className="space-y-2">
                  <HookVariationsCard
                    hooks={result.formats.hook_variations}
                    onUseInLinkedIn={platformSet.has("linkedin") ? swapLinkedInHook : undefined}
                    onUseInTwitter={platformSet.has("twitter") ? swapTwitterHook : undefined}
                  />
                  <div className="px-2">
                    <RewriteControls
                      onFreshRegen={() => handleRegenerate("hook_variations", null, 0)}
                      onPreset={(p) => handleRegenerate("hook_variations", p, 0)}
                      disabled={regenSection !== null || isRepurposing}
                      isRunning={regenSection === "hook_variations"}
                      runningPreset={regenSection === "hook_variations" ? regenPreset : null}
                      freeRerollsRemaining={freeRerollsRemaining}
                    />
                  </div>
                </div>
              )}

              <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
                {platformSet.has("linkedin") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewLinkedIn
                          items={result.formats.linkedin_posts}
                          index={liIndex}
                          onIndexChange={setLiIndex}
                          onEdit={(newValue) =>
                            mutateFormats((f) => {
                              f.linkedin_posts[liIndex] = newValue;
                              f.linkedin_post = f.linkedin_posts[0] || "";
                            })
                          }
                          onCopy={(v) => copy(v, "LinkedIn post")}
                          sourceUrl={result.source_url}
                          onRegenerate={(preset) => handleRegenerate("linkedin", preset, liIndex)}
                          regenActive={regenSection === "linkedin"}
                          regenPreset={regenSection === "linkedin" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("twitter") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewTwitter
                          tweets={result.formats.twitter_thread}
                          onItemEdit={(i, v) =>
                            mutateFormats((f) => {
                              f.twitter_thread[i] = v;
                            })
                          }
                          onCopyAll={() =>
                            copy(result.formats.twitter_thread.join("\n\n"), "Twitter thread")
                          }
                          sourceUrl={result.source_url}
                          onRegenerate={(preset) => handleRegenerate("twitter_thread", preset, 0)}
                          regenActive={regenSection === "twitter_thread"}
                          regenPreset={regenSection === "twitter_thread" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("email") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewEmail
                          email={result.formats.email}
                          sourceUrl={result.source_url}
                          onSubjectEdit={(v) =>
                            mutateFormats((f) => {
                              f.email.subject = v;
                            })
                          }
                          onBodyEdit={(v) =>
                            mutateFormats((f) => {
                              f.email.body = v;
                            })
                          }
                          onCopy={copy}
                          onRegenerate={(preset) => handleRegenerate("email", preset, 0)}
                          regenActive={regenSection === "email"}
                          regenPreset={regenSection === "email" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("youtube") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewYouTube
                          description={result.formats.youtube_description}
                          sourceUrl={result.source_url}
                          onEdit={(v) =>
                            mutateFormats((f) => {
                              f.youtube_description = v;
                            })
                          }
                          onCopy={(v) => copy(v, "YouTube description")}
                          onRegenerate={(preset) => handleRegenerate("youtube", preset, 0)}
                          regenActive={regenSection === "youtube"}
                          regenPreset={regenSection === "youtube" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("instagram") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewInstagram
                          items={result.formats.instagram_captions}
                          index={igIndex}
                          onIndexChange={setIgIndex}
                          onEdit={(v) =>
                            mutateFormats((f) => {
                              f.instagram_captions[igIndex] = v;
                              f.instagram_caption = f.instagram_captions[0] || "";
                            })
                          }
                          onCopy={(v) => copy(v, "Instagram caption")}
                          sourceUrl={result.source_url}
                          onRegenerate={(preset) => handleRegenerate("instagram", preset, igIndex)}
                          regenActive={regenSection === "instagram"}
                          regenPreset={regenSection === "instagram" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("facebook") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewFacebook
                          items={result.formats.facebook_posts}
                          index={fbIndex}
                          onIndexChange={setFbIndex}
                          onEdit={(v) =>
                            mutateFormats((f) => {
                              f.facebook_posts[fbIndex] = v;
                              f.facebook_post = f.facebook_posts[0] || "";
                            })
                          }
                          onCopy={(v) => copy(v, "Facebook post")}
                          sourceUrl={result.source_url}
                          onRegenerate={(preset) => handleRegenerate("facebook", preset, fbIndex)}
                          regenActive={regenSection === "facebook"}
                          regenPreset={regenSection === "facebook" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("quotes") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewQuotes
                          items={result.formats.quote_cards}
                          sourceUrl={result.source_url}
                          onCopyAll={() => copy(result.formats.quote_cards.join("\n\n"), "Quote cards")}
                          onItemEdit={(i, v) =>
                            mutateFormats((f) => {
                              f.quote_cards[i] = v;
                            })
                          }
                          onRegenerate={(preset) => handleRegenerate("quotes", preset, 0)}
                          regenActive={regenSection === "quotes"}
                          regenPreset={regenSection === "quotes" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {platformSet.has("carousel") && (
                  <div className="break-inside-avoid mb-4">
                    <Card className="border-purple-200 py-0 shadow-sm">
                      <CardContent className="p-3">
                        <PostPreviewCarousel
                          items={result.formats.carousel_outline}
                          sourceUrl={result.source_url}
                          onCopyAll={() => copy(result.formats.carousel_outline.join("\n"), "Carousel outline")}
                          onItemEdit={(i, v) =>
                            mutateFormats((f) => {
                              f.carousel_outline[i] = v;
                            })
                          }
                          onRegenerate={(preset) => handleRegenerate("carousel", preset, 0)}
                          regenActive={regenSection === "carousel"}
                          regenPreset={regenSection === "carousel" ? regenPreset : null}
                          disableRegen={regenSection !== null || isRepurposing}
                          freeRerollsRemaining={freeRerollsRemaining}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </>
          ) :
            isRepurposing ? (
              <div className="space-y-6">
                {/* Meta bar skeleton */}
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-6 w-32" />
                </div>

                {/* Hook variations skeleton */}
                <Card className="border-purple-100 shadow-sm">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-48 mb-2" />
                    <Skeleton className="h-4 w-64" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="flex gap-3 items-start border-b border-purple-50 pb-4 last:border-0">
                        <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-[90%]" />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Grid skeleton */}
                <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4 px-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="break-inside-avoid">
                      <Card className="border-purple-100 shadow-sm overflow-hidden">
                        <CardHeader className="p-4 pb-2 flex-row items-center gap-3">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <div className="space-y-1">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-[80%]" />
                          <Skeleton className="h-40 w-full rounded-md mt-2" />
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            ) : (

              <Card className="flex h-[calc(100vh-13rem)] items-center justify-center border-dashed border-purple-300 bg-purple-50/40">
                <div className="text-center text-muted-foreground max-w-sm px-6">
                  <FileText className="h-10 w-10 mx-auto mb-3 text-purple-400" />
                  <p className="font-medium text-purple-900">Your output lands here</p>
                  <p className="text-sm mt-1">
                    5 hook variations + platform-native posts tuned to your voice & goal.
                  </p>
                </div>
              </Card>
            )
          }
        </div>
      </div >
    </div >
  );
}

export default function RepurposePage() {
  return (
    <Suspense>
      <RepurposePageInner />
    </Suspense>
  );
}

/* ────────────────────────── subcomponents ────────────────────────── */

interface RegenProps {
  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;
}

function VariantTile({
  icon,
  title,
  items,
  sourceUrl,
  index,
  onIndexChange,
  onEdit,
  onCopy,
  rows = 8,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  sourceUrl: string;
  index: number;
  onIndexChange: (i: number) => void;
  onEdit: (v: string) => void;
  onCopy: (v: string) => void;
  rows?: number;
} & RegenProps) {
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const current = items[safeIndex] || "";
  const hasVariants = items.length > 1;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
          {hasVariants && (
            <Badge variant="outline" className="ml-1 font-mono">
              {safeIndex + 1}/{items.length}
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          {hasVariants && (
            <>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onIndexChange(Math.max(0, safeIndex - 1))}
                disabled={safeIndex === 0}
                title="Previous angle"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onIndexChange(Math.min(items.length - 1, safeIndex + 1))}
                disabled={safeIndex >= items.length - 1}
                title="Next angle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2" onClick={() => onCopy(current)}>
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={current}
          onChange={(e) => onEdit(e.target.value)}
          rows={rows}
          className="text-sm font-mono leading-relaxed resize-y"
          disabled={regenActive}
        />
        <UrlFooter url={sourceUrl} present={current.includes(sourceUrl)} />
        {onRegenerate && (
          <RewriteControls
            onFreshRegen={() => onRegenerate(null)}
            onPreset={(p) => onRegenerate(p)}
            disabled={disableRegen}
            isRunning={regenActive}
            runningPreset={regenPreset}
            freeRerollsRemaining={freeRerollsRemaining}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SaveStatusBadge({
  status,
  lastSavedAt,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
}) {
  if (status === "saving") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Saving…
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="outline" className="text-[10px] text-red-600 border-red-300 gap-1">
        <AlertTriangle className="h-3 w-3" />
        Save failed
      </Badge>
    );
  }
  if (status === "saved" && lastSavedAt) {
    return (
      <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
        Saved {formatAgo(lastSavedAt)}
      </Badge>
    );
  }
  return null;
}

function formatAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

function prettySection(s: RewriteSection): string {
  const map: Record<RewriteSection, string> = {
    hook_variations: "Hooks",
    linkedin: "LinkedIn",
    twitter_thread: "Twitter thread",
    email: "Email",
    youtube: "YouTube",
    instagram: "Instagram",
    facebook: "Facebook",
    quotes: "Quotes",
    carousel: "Carousel",
  };
  return map[s];
}

function UrlFooter({ url, present }: { url: string; present: boolean }) {
  if (!url) {
    return (
      <p className="text-[10px] text-amber-600 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        No source URL configured
      </p>
    );
  }
  return (
    <div
      className={`text-[10px] flex items-center gap-1 truncate ${present ? "text-emerald-600" : "text-amber-600"
        }`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      {present ? "Backlink present →" : "Backlink missing →"}
      <span className="truncate">{url}</span>
    </div>
  );
}
