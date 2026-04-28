"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Globe,
  CheckCircle2,
  Building2,
  MapPin,
  Megaphone,
  Users,
  Hash,
  Link2,
  Swords,
  Mic2,
  ShoppingBag,
  Save,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";

interface BrandKitState {
  business_name: string;
  niche: string;
  location: string;
  tone: string;
  products: string;
  brand_voice: string;
  target_audience: string;
  hashtags: string;
  competitors: string;
  website: string;
  website_context: string | null;
}

const TONES = [
  { value: "professional", label: "Professional", desc: "Polished and credible" },
  { value: "friendly", label: "Friendly", desc: "Warm and approachable" },
  { value: "witty", label: "Witty", desc: "Clever and entertaining" },
  { value: "formal", label: "Formal", desc: "Authoritative and precise" },
  { value: "casual", label: "Casual", desc: "Relaxed and conversational" },
];

function FieldRow({
  icon,
  label,
  hint,
  children,
  iconBg = "bg-muted",
  iconColor = "text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
}) {
  return (
    <div className="flex gap-4 py-5 border-b border-border last:border-0">
      <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          {hint && <span className="text-xs text-muted-foreground ml-3">{hint}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
  accent = "border-border",
  titleColor = "text-foreground",
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  accent?: string;
  titleColor?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card overflow-hidden w-full ${accent}`}>
      <div className="px-6 py-4 border-b border-border bg-muted/30">
        <h2 className={`text-sm font-semibold ${titleColor}`}>{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="px-6">{children}</div>
    </div>
  );
}

function CompletionBar({ config }: { config: BrandKitState }) {
  const fields = [
    config.business_name,
    config.niche,
    config.location,
    config.tone,
    config.products,
    config.target_audience,
    config.brand_voice,
    config.hashtags,
    config.competitors,
    config.website,
    config.website_context,
  ];
  const filled = fields.filter(Boolean).length;
  const pct = Math.round((filled / fields.length) * 100);
  const color = pct < 40 ? "bg-red-500" : pct < 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-muted-foreground w-12 text-right">{pct}% done</span>
    </div>
  );
}

export default function BrandKitPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [websiteSummary, setWebsiteSummary] = useState<{
    business_type?: string;
    key_offerings?: string[];
    target_audience?: string;
    location?: string;
    tone?: string;
    highlights?: string[];
  } | null>(null);
  const [scrapedContext, setScrapedContext] = useState<{
    title?: string;
    meta_description?: string;
    logo_url?: string | null;
    favicon_url?: string | null;
    primary_color?: string | null;
    secondary_color?: string | null;
    color_palette?: string[];
    social_links?: Record<string, string>;
    contact_info?: string;
    top_keywords?: string[];
    pages_scraped?: string[];
  } | null>(null);
  const [config, setConfig] = useState<BrandKitState>({
    business_name: "",
    niche: "",
    location: "",
    tone: "professional",
    products: "",
    brand_voice: "",
    target_audience: "",
    hashtags: "",
    competitors: "",
    website: "",
    website_context: null,
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get("/api/brand-kit");
        if (response.data) {
          setConfig((prev) => ({
            ...prev,
            ...response.data,
            location: response.data.location || "",
            competitors: response.data.competitors || "",
            website: response.data.website || "",
          }));
          // Rehydrate previously saved scraped context (logo, colors, etc.)
          if (response.data.website_context) {
            try {
              const ctx = JSON.parse(response.data.website_context);
              setScrapedContext(ctx);
              if (ctx.ai_summary) {
                try {
                  setWebsiteSummary(JSON.parse(ctx.ai_summary));
                } catch {
                  /* ignore */
                }
              }
            } catch {
              /* ignore malformed JSON */
            }
          }
        }
      } catch (error: unknown) {
        const err = error as { response?: { status?: number } };
        if (err.response?.status !== 404) {
          toast.error("Failed to load brand kit");
        }
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, []);

  const handleChange = (field: string, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.post("/api/brand-kit", {
        ...config,
        location: config.location || null,
        competitors: config.competitors || null,
        website: config.website || null,
      });
      toast.success("Brand kit saved!");
    } catch {
      toast.error("Failed to save brand kit");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeWebsite = async () => {
    if (!config.website) {
      toast.error("Please enter a website URL first");
      return;
    }
    setIsAnalyzing(true);
    try {
      const response = await api.post("/api/brand-kit/scrape-website", {
        url: config.website,
      });
      if (response.data.success) {
        toast.success("Website analyzed!");
        setConfig((prev) => ({
          ...prev,
          website_context: JSON.stringify(response.data.context),
        }));
        setScrapedContext(response.data.context || null);
        if (response.data.summary) {
          try {
            setWebsiteSummary(JSON.parse(response.data.summary));
          } catch {
            setWebsiteSummary(null);
          }
        }
      } else {
        toast.error(response.data.message || "Failed to analyze website");
      }
    } catch {
      toast.error("Failed to analyze website");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isFetching) {
    return (
      <div className="space-y-6 pb-16">
        {/* Header skeleton */}
        <div className="pt-2 space-y-3">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>

        {/* Two-column section skeletons */}
        <div className="flex gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden w-full">
              <div className="px-6 py-4 border-b border-border bg-muted/30 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="px-6">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="flex gap-4 py-5 border-b border-border last:border-0">
                    <Skeleton className="shrink-0 w-8 h-8 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-9 w-full rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Full-width section skeleton */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="px-6">
            {[0, 1].map((j) => (
              <div key={j} className="flex gap-4 py-5 border-b border-border last:border-0">
                <Skeleton className="shrink-0 w-8 h-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className=" space-y-6 pb-16">

        {/* PAGE HEADER */}
        <div className="pt-2 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Brand Kit</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The source of truth for every post, reel, blog and poster the AI generates.
              </p>
            </div>
            <Button type="submit" disabled={isLoading} className="gap-2 shrink-0">
              <Save className="h-4 w-4" />
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </div>
          <CompletionBar config={config} />
        </div>

        <div className="flex gap-4">
        {/* SECTION 1: IDENTITY */}
        <Section
          title="Identity"
          subtitle="Core facts the AI puts in every piece of content."
        >
          <FieldRow icon={<Building2 className="h-4 w-4" />} label="Business Name" hint="required" iconBg="bg-blue-500/15" iconColor="text-blue-500">
            <Input
              placeholder="e.g., Sunrise Dental Clinic"
              value={config.business_name}
              onChange={(e) => handleChange("business_name", e.target.value)}
              required
            />
          </FieldRow>

          <FieldRow icon={<ShoppingBag className="h-4 w-4" />} label="Industry / Niche" hint="required" iconBg="bg-violet-500/15" iconColor="text-violet-500">
            <Input
              placeholder="e.g., Healthcare, Dental"
              value={config.niche}
              onChange={(e) => handleChange("niche", e.target.value)}
              required
            />
          </FieldRow>

          <FieldRow icon={<MapPin className="h-4 w-4" />} label="Location" hint="local SEO" iconBg="bg-rose-500/15" iconColor="text-rose-500">
            <Input
              placeholder="e.g., Mumbai, India"
              value={config.location}
              onChange={(e) => handleChange("location", e.target.value)}
            />
          </FieldRow>

          <FieldRow icon={<Megaphone className="h-4 w-4" />} label="Brand Tone" iconBg="bg-orange-500/15" iconColor="text-orange-500">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TONES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleChange("tone", t.value)}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                    config.tone === t.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  <span className="font-medium block">{t.label}</span>
                  <span className="text-xs opacity-70">{t.desc}</span>
                </button>
              ))}
            </div>
          </FieldRow>
        </Section>

        {/* SECTION 2: CONTENT */}
        <Section
          title="Content Context"
          subtitle="What the AI needs to write relevant, specific content."
        >
          <FieldRow icon={<ShoppingBag className="h-4 w-4" />} label="Products / Services" hint="required" iconBg="bg-emerald-500/15" iconColor="text-emerald-500">
            <Textarea
              placeholder="e.g., Teeth cleaning, root canal, braces, whitening, dental implants..."
              value={config.products}
              onChange={(e) => handleChange("products", e.target.value)}
              rows={3}
              className="resize-none"
            />
          </FieldRow>

          <FieldRow icon={<Users className="h-4 w-4" />} label="Target Audience" hint="required" iconBg="bg-cyan-500/15" iconColor="text-cyan-500">
            <Textarea
              placeholder="e.g., Families and working professionals aged 25-50 in Mumbai looking for affordable dental care"
              value={config.target_audience}
              onChange={(e) => handleChange("target_audience", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </FieldRow>

          <FieldRow icon={<Mic2 className="h-4 w-4" />} label="Brand Voice" iconBg="bg-purple-500/15" iconColor="text-purple-500">
            <Textarea
              placeholder="e.g., Warm, reassuring, and educational. We make dental visits stress-free."
              value={config.brand_voice}
              onChange={(e) => handleChange("brand_voice", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </FieldRow>

          <FieldRow icon={<Hash className="h-4 w-4" />} label="Preferred Hashtags" iconBg="bg-fuchsia-500/15" iconColor="text-fuchsia-500">
            <Input
              placeholder="#dentalcare #healthysmile #mumbaidentist"
              value={config.hashtags}
              onChange={(e) => handleChange("hashtags", e.target.value)}
            />
          </FieldRow>
        </Section>
        </div>

        {/* SECTION 3: SEO */}
        <Section
          title="SEO and Competitors"
          subtitle="Feeds the SEO Brief generator to find gaps you can win."
        >
          <FieldRow icon={<Swords className="h-4 w-4" />} label="Competitor URLs" hint="comma-separated" iconBg="bg-red-500/15" iconColor="text-red-500">
            <Textarea
              placeholder="https://competitor1.com, https://competitor2.com"
              value={config.competitors}
              onChange={(e) => handleChange("competitors", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </FieldRow>

          <FieldRow icon={<Link2 className="h-4 w-4" />} label="Your Website" iconBg="bg-sky-500/15" iconColor="text-sky-500">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://www.yourbusiness.com"
                  value={config.website}
                  onChange={(e) => handleChange("website", e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAnalyzeWebsite}
                  disabled={isAnalyzing || !config.website}
                  className="shrink-0 gap-1.5"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {isAnalyzing ? "Reading..." : "Analyze"}
                </Button>
              </div>
              {config.website_context ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium">AI context extracted from your website</span>
                  </div>

                  {/* Brand Identity card: logo + colors + meta */}
                  {scrapedContext && (
                    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <Sparkles className="h-3.5 w-3.5 text-sky-500" />
                        Brand Identity Detected
                      </div>

                      <div className="flex items-start gap-4">
                        {/* Logo preview */}
                        {(scrapedContext.logo_url || scrapedContext.favicon_url) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={scrapedContext.logo_url || scrapedContext.favicon_url || ""}
                            alt="Brand logo"
                            className="w-16 h-16 rounded-lg border border-border bg-white object-contain p-2 shrink-0"
                            onError={(e) => {
                              const img = e.currentTarget;
                              if (scrapedContext.favicon_url && img.src !== scrapedContext.favicon_url) {
                                img.src = scrapedContext.favicon_url;
                              } else {
                                img.style.display = "none";
                              }
                            }}
                          />
                        )}
                        <div className="flex-1 min-w-0 space-y-1">
                          {scrapedContext.title && (
                            <p className="text-sm font-semibold truncate">{scrapedContext.title}</p>
                          )}
                          {scrapedContext.meta_description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{scrapedContext.meta_description}</p>
                          )}
                        </div>
                      </div>

                      {/* Color palette */}
                      {(scrapedContext.primary_color || (scrapedContext.color_palette?.length ?? 0) > 0) && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Colors</div>
                          <div className="flex flex-wrap gap-2">
                            {scrapedContext.primary_color && (
                              <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-border bg-background">
                                <span
                                  className="w-5 h-5 rounded border border-border shrink-0"
                                  style={{ backgroundColor: scrapedContext.primary_color }}
                                />
                                <span className="text-[11px] font-mono">{scrapedContext.primary_color}</span>
                                <span className="text-[10px] text-muted-foreground">primary</span>
                              </div>
                            )}
                            {scrapedContext.secondary_color && (
                              <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-border bg-background">
                                <span
                                  className="w-5 h-5 rounded border border-border shrink-0"
                                  style={{ backgroundColor: scrapedContext.secondary_color }}
                                />
                                <span className="text-[11px] font-mono">{scrapedContext.secondary_color}</span>
                                <span className="text-[10px] text-muted-foreground">secondary</span>
                              </div>
                            )}
                            {(scrapedContext.color_palette || [])
                              .filter((c) => c !== scrapedContext.primary_color && c !== scrapedContext.secondary_color)
                              .slice(0, 4)
                              .map((c) => (
                                <div
                                  key={c}
                                  className="flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-border bg-background"
                                  title={c}
                                >
                                  <span className="w-4 h-4 rounded border border-border" style={{ backgroundColor: c }} />
                                  <span className="text-[10px] font-mono text-muted-foreground">{c}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Top keywords */}
                      {Array.isArray(scrapedContext.top_keywords) && scrapedContext.top_keywords.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Top Keywords</div>
                          <div className="flex flex-wrap gap-1.5">
                            {scrapedContext.top_keywords.slice(0, 8).map((k, i) => (
                              <span key={i} className="inline-block px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[11px] font-medium">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Social links */}
                      {scrapedContext.social_links && Object.keys(scrapedContext.social_links).length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Social</div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(scrapedContext.social_links).map(([net, url]) => (
                              <a
                                key={net}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block px-2 py-0.5 rounded-md bg-muted text-foreground/80 hover:text-primary text-[11px] font-medium capitalize transition-colors"
                              >
                                {net}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pages scraped + contact */}
                      {(scrapedContext.contact_info || (scrapedContext.pages_scraped?.length ?? 0) > 0) && (
                        <div className="pt-1 space-y-1 text-[11px] text-muted-foreground border-t border-border">
                          {scrapedContext.contact_info && (
                            <p className="pt-2"><span className="font-semibold">Contact:</span> {scrapedContext.contact_info}</p>
                          )}
                          {(scrapedContext.pages_scraped?.length ?? 0) > 0 && (
                            <p className={scrapedContext.contact_info ? "" : "pt-2"}>
                              <span className="font-semibold">Pages read:</span> {scrapedContext.pages_scraped!.length}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {websiteSummary && (
                    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                        AI Summary
                      </div>
                      {websiteSummary.business_type && (
                        <p className="text-sm font-medium">{websiteSummary.business_type as string}</p>
                      )}
                      {websiteSummary.target_audience && (
                        <p className="text-xs text-muted-foreground">{websiteSummary.target_audience as string}</p>
                      )}
                      {Array.isArray(websiteSummary.key_offerings) && websiteSummary.key_offerings.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(websiteSummary.key_offerings as string[]).map((o, i) => (
                            <span key={i} className="inline-block px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium">{o}</span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(websiteSummary.highlights) && websiteSummary.highlights.length > 0 && (
                        <ul className="space-y-1">
                          {(websiteSummary.highlights as string[]).map((h, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                              <span className="text-emerald-500 shrink-0">&#10003;</span>{h}
                            </li>
                          ))}
                        </ul>
                      )}
                      {websiteSummary.location && (
                        <p className="text-xs text-muted-foreground">Location: {websiteSummary.location as string}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  AI reads your website and uses it as the top-priority context for all generated content.
                </p>
              )}
            </div>
          </FieldRow>
        </Section>



      </div>
    </form>
  );
}
