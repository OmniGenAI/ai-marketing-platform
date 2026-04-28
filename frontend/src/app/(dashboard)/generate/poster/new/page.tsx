"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { DownloadButton } from "@/components/poster/DownloadButton";
import { PosterPreview } from "@/components/poster/PosterPreview";
import { TemplateSelector } from "@/components/poster/TemplateSelector";

import api from "@/lib/api";
import {
  POSTER_ASPECT_RATIOS,
  POSTER_CAPTION_TONES,
  getPosterTemplate,
} from "@/lib/poster/templates";
import { useSubscription } from "@/hooks/use-subscription";
import type {
  Poster,
  PosterAspectRatio,
  PosterCaptionTone,
  PosterGenerateRequest,
  PosterGenerateResponse,
  PosterTemplateStyle,
} from "@/types";

const POSTER_CREDIT_COST = 1;

function PosterNewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPosterId = searchParams.get("id");
  const { canUseCredits, creditsRemaining, refresh: refreshSubscription } =
    useSubscription();

  // ---- form state ----
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("");
  const [optionalText, setOptionalText] = useState("");
  const [templateStyle, setTemplateStyle] = useState<PosterTemplateStyle>("minimal");
  const [aspectRatio, setAspectRatio] = useState<PosterAspectRatio>("1:1");
  const [captionTone, setCaptionTone] = useState<PosterCaptionTone>("professional");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [ctaVerbHint, setCtaVerbHint] = useState<string>("");

  // ---- runtime ----
  const [poster, setPoster] = useState<Poster | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [inputCollapsed, setInputCollapsed] = useState(false);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const template = useMemo(() => getPosterTemplate(templateStyle), [templateStyle]);

  // Pre-fill brand colors + logo from saved Brand Kit
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ website_context: string | null }>("/api/business-config")
      .then((res) => {
        if (cancelled || !res.data?.website_context) return;
        try {
          const ctx = JSON.parse(res.data.website_context) as {
            primary_color?: string;
            secondary_color?: string;
            logo_url?: string;
            favicon_url?: string;
          };
          if (ctx.primary_color) setPrimaryColor(ctx.primary_color);
          if (ctx.secondary_color) setSecondaryColor(ctx.secondary_color);
          setLogoUrl(ctx.logo_url || ctx.favicon_url || null);
        } catch {
          /* ignore malformed brand kit JSON */
        }
      })
      .catch(() => {
        /* user may not have a brand kit yet — silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load existing poster when ?id=... is in URL
  useEffect(() => {
    if (!urlPosterId) return;
    if (poster?.id === urlPosterId) return;
    (async () => {
      try {
        const res = await api.get<Poster>(`/api/posters/${urlPosterId}`);
        const p = res.data;
        setPoster(p);
        setTitle(p.title);
        setTheme(p.theme || "");
        setOptionalText(p.optional_text || "");
        setTemplateStyle(p.template_style as PosterTemplateStyle);
        setAspectRatio(p.aspect_ratio as PosterAspectRatio);
        setCaptionTone(p.caption_tone as PosterCaptionTone);
        if (p.primary_color) setPrimaryColor(p.primary_color);
        if (p.secondary_color) setSecondaryColor(p.secondary_color);
        setShowLogo(p.show_logo === "true");
      } catch {
        toast.error("Couldn't load that poster — it may have been deleted.");
        router.replace("/generate/poster/new");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPosterId]);

  // Elapsed counter while generating
  useEffect(() => {
    if (!isGenerating && !isRegenerating) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(
      () => setElapsedSeconds((prev) => prev + 1),
      1000,
    );
    return () => clearInterval(interval);
  }, [isGenerating, isRegenerating]);

  const validate = (): string | null => {
    if (!title.trim()) return "Title is required.";
    return null;
  };

  const handleGenerate = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (!canUseCredits(POSTER_CREDIT_COST)) {
      toast.error("Not enough credits! Upgrade your plan.");
      return;
    }

    setIsGenerating(true);
    try {
      const payload: PosterGenerateRequest = {
        title: title.trim(),
        theme: theme.trim(),
        optional_text: optionalText.trim() || null,
        template_style: templateStyle,
        aspect_ratio: aspectRatio,
        caption_tone: captionTone,
        primary_color: primaryColor.trim() || null,
        secondary_color: secondaryColor.trim() || null,
        show_logo: showLogo,
        cta_verb_hint: ctaVerbHint.trim() || null,
      };
      const res = await api.post<PosterGenerateResponse>(
        "/api/posters/generate",
        payload,
      );
      setPoster(res.data.poster);
      router.replace(`/generate/poster/new?id=${res.data.poster.id}`, {
        scroll: false,
      });
      if (res.data.background_generation_failed) {
        toast.warning(
          "Copy generated, but the background image failed. Hit “Regenerate Background” to try again.",
        );
      } else {
        toast.success(
          `Poster generated — ${POSTER_CREDIT_COST} credit${
            POSTER_CREDIT_COST === 1 ? "" : "s"
          } used.`,
        );
      }
      refreshSubscription();
    } catch (error: unknown) {
      const e = error as {
        response?: { status?: number; data?: { detail?: string | { msg: string }[] } };
      };
      const detail = e.response?.data?.detail;
      if (e.response?.status === 402) {
        toast.error("Not enough credits! Upgrade your plan.");
      } else if (e.response?.status === 400 && typeof detail === "string") {
        toast.error(detail);
      } else if (e.response?.status === 422 && Array.isArray(detail) && detail[0]?.msg) {
        toast.error(detail[0].msg);
      } else if (!e.response) {
        toast.error("Network error: Cannot reach the server.");
      } else {
        toast.error(
          typeof detail === "string"
            ? detail
            : "Failed to generate poster. Please try again.",
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateBackground = async () => {
    if (!poster) return;
    if (!canUseCredits(POSTER_CREDIT_COST)) {
      toast.error("Not enough credits to regenerate.");
      return;
    }
    setIsRegenerating(true);
    try {
      const res = await api.post<PosterGenerateResponse>(
        `/api/posters/${poster.id}/regenerate-background`,
      );
      // Preserve user-edited text — backend only rotates the background.
      setPoster((prev) =>
        prev
          ? {
              ...prev,
              background_image_url: res.data.poster.background_image_url,
              error_message: null,
            }
          : res.data.poster,
      );
      toast.success("Background regenerated — 1 credit used.");
      refreshSubscription();
    } catch (error: unknown) {
      const e = error as {
        response?: { status?: number; data?: { detail?: string } };
      };
      const detail = e.response?.data?.detail;
      if (e.response?.status === 402) {
        toast.error("Not enough credits to regenerate.");
      } else {
        toast.error(
          typeof detail === "string"
            ? detail
            : "Failed to regenerate background. Please try again.",
        );
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSaveText = async () => {
    if (!poster) return;
    setIsSaving(true);
    try {
      const res = await api.patch<Poster>(`/api/posters/${poster.id}`, {
        title: poster.title,
        headline: poster.headline ?? "",
        tagline: poster.tagline ?? "",
        cta: poster.cta ?? "",
        caption: poster.caption ?? "",
        event_meta: poster.event_meta ?? "",
        features: poster.features ?? [],
        brand_label: poster.brand_label ?? "",
      });
      setPoster(res.data);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save edits.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloaded = async () => {
    if (!poster) return;
    try {
      await api.patch(`/api/posters/${poster.id}`, { status: "exported" });
      setPoster((prev) => (prev ? { ...prev, status: "exported" } : prev));
    } catch {
      /* non-critical — the file is already downloaded */
    }
  };

  const handleCopyCaption = () => {
    if (!poster?.caption) return;
    navigator.clipboard.writeText(poster.caption);
    toast.success("Caption copied to clipboard");
  };

  const handleNewPoster = () => {
    setPoster(null);
    setTitle("");
    setTheme("");
    setOptionalText("");
    setTemplateStyle("minimal");
    setAspectRatio("1:1");
    setCaptionTone("professional");
    setCtaVerbHint("");
    router.replace("/generate/poster/new");
  };

  const showLowCredits =
    creditsRemaining !== Infinity && creditsRemaining <= 3 && creditsRemaining > 0;
  const noCredits = creditsRemaining === 0;
  const busy = isGenerating || isRegenerating;

  return (
    <div className="relative">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={() => router.push("/generate/poster")}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span>/</span>
        <span className="text-foreground font-medium">Generate Poster</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 my-2">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-linear-to-br from-violet-600 via-fuchsia-500 to-rose-500 text-white shadow-sm">
              <ImageIcon className="h-5 w-5" />
            </span>
            <span>
              Generate Poster
            </span>
          </h1>
          <p className="text-muted-foreground">
            Pick a style, generate a clean text-free background, then overlay
            perfectly-spelled text in the live preview.
          </p>
        </div>
        {poster && (
          <Button
            variant="outline"
            className="gap-2 border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-50 shrink-0"
            onClick={handleNewPoster}
          >
            <Plus className="h-4 w-4" />
            New Poster
          </Button>
        )}
      </div>

      {(showLowCredits || noCredits) && (
        <span className="absolute top-0 right-0 flex items-center gap-3 w-fit">
          {showLowCredits && (
            <Alert
              variant="destructive"
              className="w-fit bg-yellow-50 border-yellow-200 text-yellow-800"
            >
              <AlertTriangle className="h-4 w-4 mt-2" />
              <AlertDescription className="flex items-center justify-between">
                <span>You have {creditsRemaining} credits remaining.</span>
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
          {noCredits && (
            <Alert
              variant="destructive"
              className="w-fit bg-red-50 border-red-200 text-red-800"
            >
              <AlertTriangle className="h-4 w-4 mt-1" />
              <AlertDescription className="flex items-center justify-between">
                <span>You have no credits remaining.</span>
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
        </span>
      )}

      <div
        className={`grid gap-6 ${
          inputCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[440px_1fr]"
        } relative`}
      >
        {/* Collapse rail (desktop only) */}
        {!busy && (
          <button
            type="button"
            onClick={() => setInputCollapsed((v) => !v)}
            title={inputCollapsed ? "Show input panel" : "Hide input panel"}
            className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 z-20 h-16 w-5 items-center justify-center rounded-r-md border border-l-0 border-fuchsia-200 bg-white text-fuchsia-700 shadow-sm hover:bg-fuchsia-50 transition-all ${
              inputCollapsed ? "left-0" : "left-109.75"
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
          className={`relative border-fuchsia-200 h-[calc(100vh-13rem)] flex flex-col gap-0 overflow-hidden ${
            inputCollapsed ? "hidden" : ""
          }`}
        >
          {/* Top accent stripe — Canva-style gradient */}
          <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500" />
          <CardHeader className="shrink-0 mb-3 border-b">
            <CardTitle className="bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500 bg-clip-text text-transparent">
              Poster Inputs
            </CardTitle>
            <CardDescription>
              Title + theme drive the AI image. Template + brand colors decide
              the look.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto space-y-5 pb-6 scrollbar-thin">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="poster-title">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="poster-title"
                placeholder="e.g. Learn AWS"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </div>

            {/* Theme */}
            <div className="space-y-1.5">
              <Label htmlFor="poster-theme">Theme</Label>
              <Input
                id="poster-theme"
                placeholder="e.g. tech, futuristic"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                disabled={busy}
              />
            </div>

            {/* Optional text */}
            <div className="space-y-1.5">
              <Label htmlFor="poster-optional">Optional context</Label>
              <Textarea
                id="poster-optional"
                placeholder="Tagline, date, key benefit, anything you want the AI copy to lean on…"
                rows={3}
                value={optionalText}
                onChange={(e) => setOptionalText(e.target.value)}
                disabled={busy}
              />
            </div>

            <Separator />

            {/* Template */}
            <div className="space-y-2">
              <Label>
                Template style <span className="text-red-500">*</span>
              </Label>
              <TemplateSelector
                value={templateStyle}
                onChange={setTemplateStyle}
                disabled={busy}
              />
            </div>

            {/* Aspect ratio */}
            <div className="space-y-2">
              <Label>Aspect ratio</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {POSTER_ASPECT_RATIOS.map((r) => {
                  const selected = aspectRatio === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={busy}
                      onClick={() => setAspectRatio(r.id as PosterAspectRatio)}
                      className={`rounded-md border p-2 text-left text-xs transition-all ${
                        selected
                          ? "border-fuchsia-500 bg-fuchsia-50 ring-1 ring-fuchsia-500"
                          : "border-border hover:border-foreground/30"
                      } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <span className="font-semibold">{r.label}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {r.id}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Caption tone */}
            <div className="space-y-1.5">
              <Label className="text-xs">Caption tone</Label>
              <Select
                value={captionTone}
                onValueChange={(v) => setCaptionTone(v as PosterCaptionTone)}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSTER_CAPTION_TONES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CTA verb hint — bans generic "Learn More" / "Get Started" */}
            <div className="space-y-2">
              <Label className="text-xs">CTA verb</Label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "", label: "Auto" },
                  { v: "Enroll", label: "Enroll" },
                  { v: "Register", label: "Register" },
                  { v: "Join", label: "Join" },
                  { v: "Reserve", label: "Reserve" },
                  { v: "Start", label: "Start" },
                  { v: "Shop", label: "Shop" },
                  { v: "Book", label: "Book" },
                ].map((c) => {
                  const selected = ctaVerbHint === c.v;
                  return (
                    <button
                      key={c.v || "auto"}
                      type="button"
                      disabled={busy}
                      onClick={() => setCtaVerbHint(c.v)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                        selected
                          ? "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Forces the AI to start the CTA with this verb (e.g. &quot;Enroll
                Now&quot;). &quot;Auto&quot; lets the AI pick a fitting one.
              </p>
            </div>

            <Separator />

            {/* Brand colors */}
            <div className="space-y-2">
              <Label className="text-xs">Brand colors (Brand Kit)</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                  <input
                    type="color"
                    value={normalizeColor(primaryColor) || "#0066ff"}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                    disabled={busy}
                    aria-label="Primary color"
                  />
                  <Input
                    placeholder="#0066FF"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    disabled={busy}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                  <input
                    type="color"
                    value={normalizeColor(secondaryColor) || "#ffaa00"}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                    disabled={busy}
                    aria-label="Secondary color"
                  />
                  <Input
                    placeholder="#FFAA00"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    disabled={busy}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Logo toggle */}
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-fuchsia-600"
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
                disabled={busy}
              />
              Show brand logo on poster (from Brand Kit)
            </label>
          </CardContent>

          <div className="px-6 pt-3 shrink-0 border-t">
            <Button
              onClick={handleGenerate}
              disabled={busy || noCredits}
              className="w-full gap-2 text-white bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500 hover:opacity-90 transition-opacity shadow-sm disabled:opacity-60"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Generating — {elapsedSeconds}s
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {poster ? "Regenerate Poster" : `Generate Poster (${POSTER_CREDIT_COST} Credit)`}
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* OUTPUT */}
        <div className="space-y-4 h-[calc(100vh-13rem)] overflow-y-auto scrollbar-thin pr-1">
          {!poster ? (
            <PreviewEmptyState />
          ) : (
            <>
              {/* Meta bar */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="text-white border-transparent bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500 hover:opacity-90">
                  Style: {template.label}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-fuchsia-200 text-fuchsia-700"
                >
                  {poster.aspect_ratio}
                </Badge>
                {poster.error_message === "background_generation_failed" && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 text-amber-700"
                  >
                    Background failed — regenerate
                  </Badge>
                )}
                {poster.status === "exported" && (
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-transparent">
                    Exported
                  </Badge>
                )}
              </div>

              {/* Live preview — html-to-image captures THIS node */}
              <div className="rounded-xl border bg-card p-4">
                <div className="mx-auto max-w-130">
                  <PosterPreview
                    ref={previewRef}
                    template={template}
                    aspectRatio={aspectRatio}
                    backgroundUrl={poster.background_image_url}
                    headline={poster.headline ?? ""}
                    tagline={poster.tagline ?? ""}
                    cta={poster.cta ?? ""}
                    eyebrow={poster.event_meta ?? ""}
                    features={poster.features ?? []}
                    brandLabel={poster.brand_label ?? ""}
                    logoUrl={showLogo ? logoUrl : null}
                    editable
                    onEditHeadline={(v) =>
                      setPoster((prev) => (prev ? { ...prev, headline: v } : prev))
                    }
                    onEditTagline={(v) =>
                      setPoster((prev) => (prev ? { ...prev, tagline: v } : prev))
                    }
                    onEditCta={(v) =>
                      setPoster((prev) => (prev ? { ...prev, cta: v } : prev))
                    }
                    onEditEyebrow={(v) =>
                      setPoster((prev) => (prev ? { ...prev, event_meta: v } : prev))
                    }
                    onEditFeature={(idx, v) =>
                      setPoster((prev) => {
                        if (!prev) return prev;
                        const next = [...(prev.features ?? [])];
                        next[idx] = v;
                        return { ...prev, features: next };
                      })
                    }
                    onEditBrandLabel={(v) =>
                      setPoster((prev) => (prev ? { ...prev, brand_label: v } : prev))
                    }
                  />
                </div>
              </div>

              {/* Inline text editors (mirror the poster — easier on mobile) */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Text Overlay</CardTitle>
                  <CardDescription className="text-xs">
                    Edit every text block — preview updates live.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Eyebrow / Event meta</Label>
                    <Input
                      placeholder="30-Day Bootcamp · Self-paced · Starts May 1"
                      value={poster.event_meta ?? ""}
                      onChange={(e) =>
                        setPoster((prev) =>
                          prev ? { ...prev, event_meta: e.target.value } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Headline</Label>
                    <Input
                      value={poster.headline ?? ""}
                      onChange={(e) =>
                        setPoster((prev) =>
                          prev ? { ...prev, headline: e.target.value } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tagline</Label>
                    <Input
                      value={poster.tagline ?? ""}
                      onChange={(e) =>
                        setPoster((prev) =>
                          prev ? { ...prev, tagline: e.target.value } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Features ({(poster.features ?? []).length}/4)
                    </Label>
                    <div className="space-y-1.5">
                      {(poster.features ?? []).map((feature, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input
                            placeholder={`Benefit ${i + 1}`}
                            value={feature}
                            onChange={(e) =>
                              setPoster((prev) => {
                                if (!prev) return prev;
                                const next = [...(prev.features ?? [])];
                                next[i] = e.target.value;
                                return { ...prev, features: next };
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-red-500"
                            onClick={() =>
                              setPoster((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      features: (prev.features ?? []).filter(
                                        (_, idx) => idx !== i,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                            aria-label={`Remove benefit ${i + 1}`}
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                      {(poster.features ?? []).length < 4 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setPoster((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    features: [...(prev.features ?? []), ""],
                                  }
                                : prev,
                            )
                          }
                        >
                          + Add benefit
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Call to Action</Label>
                    <Input
                      value={poster.cta ?? ""}
                      onChange={(e) =>
                        setPoster((prev) =>
                          prev ? { ...prev, cta: e.target.value } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Brand label (footer)</Label>
                    <Input
                      placeholder="Your Brand · yoursite.com · @handle"
                      value={poster.brand_label ?? ""}
                      onChange={(e) =>
                        setPoster((prev) =>
                          prev ? { ...prev, brand_label: e.target.value } : prev,
                        )
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Caption */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Social Caption</CardTitle>
                    <CardDescription className="text-xs">
                      Suggested copy for the post that goes alongside the
                      poster.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyCaption}
                    disabled={!poster.caption}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </Button>
                </CardHeader>
                <CardContent>
                  <Textarea
                    rows={5}
                    value={poster.caption ?? ""}
                    onChange={(e) =>
                      setPoster((prev) =>
                        prev ? { ...prev, caption: e.target.value } : prev,
                      )
                    }
                  />
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <DownloadButton
                  targetRef={previewRef}
                  title={poster.title}
                  onDownloaded={handleDownloaded}
                  className="text-white bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500 hover:opacity-90 transition-opacity shadow-sm"
                  disabled={!poster.background_image_url}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveText}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Edits
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegenerateBackground}
                  disabled={busy || noCredits}
                >
                  {isRegenerating ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Regenerate Background ({POSTER_CREDIT_COST} Credit)
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewEmptyState() {
  return (
    <div className="flex h-full min-h-100 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-linear-to-br from-violet-50 via-fuchsia-50/40 to-rose-50/40 p-8 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-violet-600 via-fuchsia-500 to-rose-500 text-white shadow-sm">
        <Sparkles className="h-6 w-6" />
      </span>
      <h3 className="text-lg font-semibold">No poster yet</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Fill in the title and theme on the left, pick a template, then hit
        Generate. The AI will produce a clean text-free background and a
        matching headline / tagline / CTA you can edit live.
      </p>
    </div>
  );
}

/** Coerce a stored color string into a 7-char hex `<input type="color">` accepts. */
function normalizeColor(c: string): string {
  if (!c) return "";
  const trimmed = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "";
}

export default function PosterNewPage() {
  return (
    <Suspense fallback={null}>
      <PosterNewPageInner />
    </Suspense>
  );
}
