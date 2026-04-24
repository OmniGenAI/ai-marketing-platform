"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search,
  Copy,
  CheckCheck,
  Loader2,
  Hash,
  BarChart2,
  Globe,
  FileText,
  Tag,
  Code2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Sparkles,
  TrendingUp,
  Target,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  ScrollText,
  Brain,
  AlertTriangle,
  List,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

interface MetaSuggestion {
  title: string;
  title_length: number;
  title_ok: boolean;
  description: string;
  description_length: number;
  description_ok: boolean;
}

interface H2Section {
  heading: string;
  notes: string;
}

interface KeywordVolume {
  keyword: string;
  estimated_volume: string;
  difficulty: string;
}

interface CompetitorInsight {
  url: string;
  title: string;
  word_count: number;
  readability_score: number;
  top_keywords: string[];
}

interface DraftScore {
  overall: number;
  readability: {
    flesch_score: number;
    grade_level: number;
    word_count: number;
    avg_words_per_sentence: number;
    status: string;
  };
  keyword_density: {
    density: number;
    occurrences: number;
    status: string;
  };
  structure: {
    h1_count: number;
    h2_count: number;
    h3_count: number;
    issues: string[];
  };
}

interface SerpResult {
  title: string;
  link: string;
  snippet: string;
}

interface SEOBriefResponse {
  topic: string;
  search_intent: string;
  primary_keyword: string;
  secondary_keywords: string[];
  nlp_terms: string[];
  keyword_data: KeywordVolume[];
  serp_results: SerpResult[];
  competitor_insights: CompetitorInsight[];
  content_gaps: string[];
  h2_outline: H2Section[];
  meta_suggestions: MetaSuggestion[];
  schema_markup: Record<string, unknown>;
  serp_preview: { title: string; url: string; description: string };
  recommendations: string[];
  draft_score?: DraftScore;
  save_id?: string | null;
}

const WORD_COUNT_OPTIONS = [
  { value: "800", label: "800 — Short" },
  { value: "1200", label: "1,200 — Medium" },
  { value: "1500", label: "1,500 — Standard" },
  { value: "2000", label: "2,000 — Long" },
  { value: "3000", label: "3,000 — In-depth" },
];

const COUNTRY_OPTIONS = [
  { value: "", label: "Global" },
  { value: "us", label: "United States" },
  { value: "in", label: "India" },
  { value: "gb", label: "United Kingdom" },
  { value: "ca", label: "Canada" },
  { value: "au", label: "Australia" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "br", label: "Brazil" },
  { value: "jp", label: "Japan" },
  { value: "sg", label: "Singapore" },
  { value: "ae", label: "UAE" },
  { value: "pk", label: "Pakistan" },
  { value: "sa", label: "Saudi Arabia" },
];

const LOADING_STEPS = [
  "Searching Google via Serper…",
  "Fetching SERP results…",
  "Launching Playwright browser…",
  "Scraping competitor pages…",
  "Cleaning HTML with BeautifulSoup…",
  "Extracting headings & content…",
  "Aggregating competitor data…",
  "Analysing with Gemini AI…",
  "Generating outline & keywords…",
  "Building SEO brief…",
];

type TabId = "outline" | "keywords" | "volumes" | "serp" | "meta" | "competitors" | "gaps" | "schema" | "recommendations" | "draft";

function buildTabs(hasDraft: boolean): { id: TabId; label: string; icon: React.ElementType }[] {
  const base: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "outline", label: "Outline", icon: FileText },
    { id: "keywords", label: "Keywords", icon: Hash },
    { id: "volumes", label: "Volumes", icon: BarChart2 },
    { id: "serp", label: "SERP", icon: List },
    { id: "meta", label: "Meta Tags", icon: Tag },
    { id: "competitors", label: "Competitors", icon: Globe },
    { id: "gaps", label: "Gaps", icon: AlertTriangle },
    { id: "schema", label: "Schema", icon: Code2 },
    { id: "recommendations", label: "Tips", icon: Lightbulb },
  ];
  if (hasDraft) base.push({ id: "draft", label: "Draft Analysis", icon: ScrollText });
  return base;
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function DiffBadge({ difficulty }: { difficulty: string }) {
  const style =
    difficulty === "Easy"
      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
      : difficulty === "Hard"
        ? "bg-red-500/10 text-red-500 border-red-500/30"
        : "bg-amber-500/10 text-amber-500 border-amber-500/30";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", style)}>
      {difficulty}
    </span>
  );
}

function CopyBtn({ text, className, lebel }: { text: string; className?: string; lebel?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors select-none",
        className
      )}
    >
      {done ? (
        <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {done && lebel ? "Copied" : "Copy"}
    </button>
  );
}

function CharBar({ value, max }: { value: number; max: number; }) {
  const pct = Math.min((value / max) * 100, 100);
  const ok = value <= max;
  return (
    <div className="space-y-0.5 w-30">
      <div className="flex justify-end text-xs">
        <span className={ok ? "text-emerald-500" : "text-red-500"}>{value}/{max}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


function KwChip({ kw, primary }: { kw: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(kw);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title="Click to copy"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all hover:bg-muted/80 active:scale-95",
        primary
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-muted/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {done && <CheckCheck className="h-3 w-3 text-emerald-500" />}
      {kw}
    </button>
  );
}

function H2Item({ section, index }: { section: H2Section; index: number }) {
  const [open, setOpen] = useState(index < 3);
  return (
    <div className="rounded-lg border overflow-hidden transition-colors hover:border-foreground/20">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
      >
        <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-medium leading-snug">{section.heading}</span>
        <div className="flex items-center gap-2 shrink-0">
          <CopyBtn text={section.heading} />
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-3 pt-2 border-t bg-muted/10">
          <p className="text-sm text-muted-foreground leading-relaxed flex items-start gap-1.5">
            <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
            {section.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  const [step, setStep] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    ref.current = setInterval(() => setStep((s) => (s + 1) % LOADING_STEPS.length), 1200);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 h-full overflow-y-auto">
      <div className="relative">
        <div className="h-16 w-16 rounded-full border-4 border-muted" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-t-foreground animate-spin" />
        <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-foreground" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-semibold">Building your SEO brief…</p>
        <p className="text-xs text-muted-foreground min-h-4">{LOADING_STEPS[step]}</p>
      </div>
      <div className="flex gap-1.5">
        {LOADING_STEPS.map((_, i) => (
          <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i <= step ? "bg-foreground w-4" : "bg-muted w-1.5")} />
        ))}
      </div>
    </div>
  );
}

function SEOBriefContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const savedBriefId = searchParams.get("id");

  const [topic, setTopic] = useState("");
  const [wordCount, setWordCount] = useState("1500");
  const [country, setCountry] = useState("");
  const [businessContext, setBusinessContext] = useState<{
    business_name: string;
    niche: string;
    location: string;
    target_audience: string;
    products: string;
    brand_voice: string;
  } | null>(null);
  const [brandKitCompetitors, setBrandKitCompetitors] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(!!savedBriefId);
  const [brief, setBrief] = useState<SEOBriefResponse | null>(null);
  // Tracks the row id this brief is persisted to, so re-generating updates in place.
  const [currentSaveId, setCurrentSaveId] = useState<string | null>(savedBriefId);
  const [activeTab, setActiveTab] = useState<TabId>("outline");
  const [showAllNlp, setShowAllNlp] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load saved brief if ID is in query params
  useEffect(() => {
    if (!savedBriefId) return;
    setIsLoading(true);
    api.get<{ id: string; type: string; title: string; data: SEOBriefResponse }>(`/api/seo/saves/${savedBriefId}`)
      .then((res) => {
        const briefData = res.data.data as SEOBriefResponse;
        setBrief(briefData);
        setTopic(briefData.topic || "");
        setCurrentSaveId(res.data.id);
        setActiveTab(briefData.draft_score ? "draft" : "outline");
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      })
      .catch(() => toast.error("Failed to load saved brief"))
      .finally(() => setIsLoading(false));
  }, [savedBriefId]);

  // Silently load brand kit context on mount
  useEffect(() => {
    api.get("/api/brand-kit")
      .then((res) => {
        if (res.data) {
          setBusinessContext({
            business_name: res.data.business_name || "",
            niche: res.data.niche || "",
            location: res.data.location || "",
            target_audience: res.data.target_audience || "",
            products: res.data.products || "",
            brand_voice: res.data.brand_voice || "",
          });

          // Auto-fill competitor URLs from brand kit
          if (res.data.competitors) {
            const urls = (res.data.competitors as string)
              .split(",")
              .map((u: string) => u.trim())
              .filter((u: string) => u.startsWith("http"));
            if (urls.length > 0) {
              setBrandKitCompetitors(urls);
            }
          }
        }
      })
      .catch(() => {}); // silent — brand kit is optional
  }, []);

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Please enter a topic"); return; }
    setIsLoading(true);
    setBrief(null);
    try {
      const res = await api.post<SEOBriefResponse>("/api/seo/brief", {
        topic: topic.trim(),
        target_word_count: parseInt(wordCount) || 1500,
        country,
        competitor_urls: brandKitCompetitors,
        content_draft: "",
        ...(businessContext && { business_context: businessContext }),
        ...(currentSaveId ? { save_id: currentSaveId } : {}),
      }, { timeout: 180_000 }); // 3 min — scraping + AI takes time
      setBrief(res.data);
      setActiveTab(res.data.draft_score ? "draft" : "outline");
      // Persist the id in the URL so reloads / "open" from list land back here.
      if (res.data.save_id && res.data.save_id !== savedBriefId) {
        setCurrentSaveId(res.data.save_id);
        router.replace(`/seo/brief?id=${res.data.save_id}`, { scroll: false });
      } else if (res.data.save_id) {
        setCurrentSaveId(res.data.save_id);
      }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "Failed to generate SEO brief");
    } finally {
      setIsLoading(false);
    }
  };

  const schemaString = brief ? JSON.stringify(brief.schema_markup, null, 2) : "";
  const outlineText = brief && brief.h2_outline ? brief.h2_outline.map((s, i) => `## ${i + 1}. ${s.heading}\n-> ${s.notes}`).join("\n\n") : "";
  const allKeywords = brief ? [brief.primary_keyword, ...(brief.secondary_keywords || [])] : [];
  const TABS = buildTabs(!!brief?.draft_score);

  return (
    <div className="min-h-full bg-background">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <span>/</span>
        <span className="text-foreground font-medium">SEO Brief</span>
      </div>
      <div className="mx-auto py-4 space-y-8">


        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-violet-500/10 border-violet-500/20">
            <Search className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight dark:text-white">SEO Brief Generator</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Enter a topic — get keywords, H2 outline, meta tags, schema markup, and competitor insights.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

          {/* Left: results / loading / empty state */}
          <div ref={resultsRef} className="space-y-4 min-w-0 overflow-y-auto max-h-[calc(100vh-14.4rem)] pr-1">
            {isLoading && (
              <div className="rounded-xl border bg-card shadow-sm">
                <LoadingState />
              </div>
            )}

            {!isLoading && !brief && (
              <div className="rounded-xl border border-dashed border-violet-500/20 bg-violet-500/5 flex flex-col items-center justify-center gap-3 py-24 text-center">
                <Sparkles className="h-10 w-10 text-violet-500/40" />
                <p className="text-sm font-medium text-muted-foreground">Your SEO brief will appear here</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Fill in the topic on the right and click <span className="font-semibold">Generate SEO Brief</span> to get started.
                </p>
              </div>
            )}

            {brief && !isLoading && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_min-content] gap-4">
                  {/* Left stats card - Text heavy */}
                  <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
                    {/* Search Intent badge */}
                    {brief.search_intent && (
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-violet-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Search Intent</span>
                        <Badge variant="secondary" className="text-xs font-medium px-2 py-0.5 bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors capitalize">{brief.search_intent}</Badge>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Focus</p>
                        <KwChip kw={brief.primary_keyword} primary />
                      </div>

                      {brief.nlp_terms && brief.nlp_terms.length > 0 && (
                        <div className="space-y-2.5">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Semantic Density (NLP)</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(showAllNlp ? brief.nlp_terms : brief.nlp_terms.slice(0, 5)).map((term) => (
                              <span key={term} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">{term}</span>
                            ))}
                            {brief.nlp_terms.length > 5 && (
                              <button
                                onClick={() => setShowAllNlp((v) => !v)}
                                className="text-xs text-primary hover:underline px-1 py-0.5"
                              >
                                {showAllNlp ? "show less" : `+${brief.nlp_terms.length - 5} more`}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Secondary Targets</p>
                      </div>
                      <div className="flex flex-wrap gap-y-2 gap-x-1.5">
                        {(brief.secondary_keywords || []).map((kw) => <KwChip key={kw} kw={kw} />)}
                      </div>
                    </div>
                  </div>

                  {/* Right stats mini-cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-3 min-w-[280px]">
                    <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-center gap-1 hover:border-violet-500/40 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <FileText className="h-4 w-4 text-violet-500" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight dark:text-white">{brief.h2_outline?.length || 0}</p>
                      <p className="text-xs font-medium text-muted-foreground">Outline Sections</p>
                    </div>

                    <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-center gap-1 hover:border-violet-500/40 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <Hash className="h-4 w-4 text-violet-500" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight dark:text-white">{allKeywords.length}</p>
                      <p className="text-xs font-medium text-muted-foreground">Total Keywords</p>
                    </div>

                    <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-center gap-1 hover:border-violet-500/40 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <List className="h-4 w-4 text-violet-500" />
                      </div>
                      <p className="text-2xl font-bold tracking-tight dark:text-white">{brief.serp_results?.length || 0}</p>
                      <p className="text-xs font-medium text-muted-foreground">SERP Results</p>
                    </div>

                    <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-center gap-1 hover:border-violet-500/40 transition-colors">
                      <div className="flex items-center justify-between text-muted-foreground mb-1">
                        <AlertTriangle className={cn("h-4 w-4", (brief.content_gaps?.length || 0) > 0 ? "text-amber-500" : "")} />
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{(brief.content_gaps?.length || 0)}</p>
                      <p className="text-xs font-medium text-muted-foreground">Content Gaps</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
                  <div className="p-2 border-b bg-muted/20 overflow-x-auto">
                    <div className="flex inline-flex bg-muted/50 p-1 rounded-lg gap-1 min-w-max">
                      {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                              active
                                ? "bg-violet-500 text-white shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-5">

                    {activeTab === "outline" && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm">AI-Enriched Content Outline</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{brief.h2_outline?.length || 0} sections · target {parseInt(wordCount).toLocaleString()} words</p>
                          </div>
                          <CopyBtn text={outlineText} />
                        </div>
                        <div className="space-y-2">
                          {brief.h2_outline?.map((section, i) => <H2Item key={i} section={section} index={i} />)}
                        </div>
                      </div>
                    )}

                    {activeTab === "keywords" && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm">Keyword Research</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{allKeywords.length} keywords — click any chip to copy</p>
                          </div>
                          <CopyBtn text={allKeywords.join(", ")} />
                        </div>
                        <div className="rounded-lg border p-4 space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <Target className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="font-semibold">{brief.primary_keyword}</p>
                            <KwChip kw={brief.primary_keyword} primary />
                          </div>
                        </div>
                        <div className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secondary</span>
                          </div>
                          <div className="divide-y">
                            {(brief.secondary_keywords || []).map((kw, i) => (
                              <div key={i} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                                <span className="text-sm">{kw}</span>
                                <KwChip kw={kw} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "volumes" && (
                      <div className="space-y-4">
                        <div>
                          <p className="font-semibold text-sm">Keyword Volume &amp; Difficulty</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Estimated search data for each keyword</p>
                        </div>
                        <div className="rounded-lg border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/40">
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left px-4 py-2.5 font-semibold">Keyword</th>
                                <th className="text-left px-4 py-2.5 font-semibold">Est. Volume</th>
                                <th className="text-left px-4 py-2.5 font-semibold">Difficulty</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {(brief.keyword_data || []).map((k, i) => (
                                <tr key={i} className="hover:bg-muted/20 transition-colors">
                                  <td className="px-4 py-3 font-medium text-sm">{k.keyword}</td>
                                  <td className="px-4 py-3 text-muted-foreground text-sm">{k.estimated_volume}</td>
                                  <td className="px-4 py-3"><DiffBadge difficulty={k.difficulty} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {activeTab === "meta" && (
                      <div className="space-y-5">
                        <div>
                          <p className="font-semibold text-sm">Meta Tags &amp; SERP Preview</p>
                          <p className="text-xs text-muted-foreground mt-0.5">3 variants — pick the best fit</p>
                        </div>
                        {brief.serp_preview && (
                          <div className="rounded-lg border p-4 bg-white">
                            <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Google Preview</p>
                            <p className="text-[#1a0dab] text-base font-medium leading-snug truncate">{brief.serp_preview.title}</p>
                            <p className="text-[#006621] text-xs mt-0.5">{brief.serp_preview.url}</p>
                            <p className="text-[#545454] text-sm mt-1 leading-snug line-clamp-2">{brief.serp_preview.description}</p>
                          </div>
                        )}
                        {(brief.meta_suggestions || []).map((m, i) => (
                          <div key={i} className="rounded-lg border overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Option {i + 1}</span>
                            </div>
                            <div className="p-4 space-y-4">
                              <div className="space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium leading-snug flex-1 group">{m.title} <CopyBtn text={m.title} className="group-hover:visible invisible ml-2 pt-2" /></p>
                                    <CharBar value={m.title_length} max={60} />
                                  
                                </div>
                              </div>
                              <Separator />
                              <div className="space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm text-muted-foreground leading-snug flex-1  group">{m.description} <CopyBtn text={m.description} className="group-hover:visible invisible ml-2 pt-2" /></p>
                                  <CharBar value={m.description_length} max={155} />
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === "competitors" && (
                      <div className="space-y-4">
                        <div>
                          <p className="font-semibold text-sm">Competitor Insights</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(brief.competitor_insights?.length || 0) > 0
                              ? `${brief.competitor_insights.length} pages auto-discovered and verified`
                              : "No competitors could be verified for this topic"}
                          </p>
                        </div>
                        {(brief.competitor_insights?.length || 0) === 0 ? (
                          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                            <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
                            <p className="text-sm font-medium">No competitors verified</p>
                            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                              AI searched for competitors but none responded. Add specific URLs above for manual analysis.
                            </p>

                          </div>
                        ) : (
                          <div className="space-y-3">
                            {(brief.competitor_insights || []).map((c, i) => (
                              <div key={i} className="rounded-lg border p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-medium text-sm leading-snug">{c.title}</p>
                                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{c.url}</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="rounded-md bg-muted/40 px-3 py-2 text-center">
                                    <p className="font-bold text-base">{c.word_count.toLocaleString()}</p>
                                    <p className="text-xs text-muted-foreground">words</p>
                                  </div>
                                  <div className="rounded-md bg-muted/40 px-3 py-2 text-center">
                                    <p className="font-bold text-base">{c.readability_score}</p>
                                    <p className="text-xs text-muted-foreground">readability</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {c.top_keywords.map((kw) => <Badge key={kw} variant="secondary" className="text-xs">{kw}</Badge>)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "serp" && (
                      <div className="space-y-4">
                        <div>
                          <p className="font-semibold text-sm">Google SERP Results</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {brief.serp_results?.length || 0} organic results fetched via Serper.dev
                          </p>
                        </div>
                        {brief.serp_results && brief.serp_results.length > 0 ? (
                          <div className="space-y-2">
                            {brief.serp_results.map((s, i) => (
                              <div key={i} className="rounded-lg border p-4 hover:bg-muted/20 transition-colors space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-3 min-w-0">
                                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium leading-snug truncate">{s.title}</p>
                                      <p className="text-xs text-emerald-600 truncate mt-0.5">{s.link}</p>
                                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.snippet}</p>
                                    </div>
                                  </div>
                                  <a href={s.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                            <List className="h-8 w-8 text-muted-foreground mx-auto" />
                            <p className="text-sm font-medium">No SERP results</p>
                            <p className="text-xs text-muted-foreground">Serper API key may not be configured.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "gaps" && (
                      <div className="space-y-4">
                        <div>
                          <p className="font-semibold text-sm">Content Gaps</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Topics that competitors missed or covered poorly — your opportunity to stand out.
                          </p>
                        </div>
                        {brief.content_gaps && brief.content_gaps.length > 0 ? (
                          <ul className="space-y-2">
                            {brief.content_gaps.map((gap, i) => (
                              <li key={i} className="flex items-start gap-3 rounded-lg border p-4 hover:bg-muted/20 transition-colors">
                                <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 text-xs font-bold">!</span>
                                <p className="text-sm leading-relaxed">{gap}</p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto" />
                            <p className="text-sm font-medium">No gaps detected</p>
                            <p className="text-xs text-muted-foreground">Competitors seem to cover the topic comprehensively.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "schema" && (
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-sm">Schema Markup (JSON-LD)</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Paste inside a script tag with type application/ld+json
                            </p>
                          </div>
                          <CopyBtn text={`<script type="application/ld+json">\n${schemaString}\n</script>`} />
                        </div>
                        <pre className="rounded-lg bg-muted/60 p-4 text-xs overflow-x-auto leading-relaxed border">{schemaString}</pre>
                      </div>
                    )}

                    {activeTab === "recommendations" && (
                      <div className="space-y-4">
                        <div>
                          <p className="font-semibold text-sm">SEO Recommendations</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{(brief.recommendations?.length || 0)} actionable tips for this topic</p>
                        </div>
                        <ul className="space-y-3">
                          {(brief.recommendations || []).map((rec, i) => (
                            <li key={i} className="flex items-start gap-3 rounded-lg border p-4 hover:bg-muted/20 transition-colors">
                              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">{i + 1}</span>
                              <p className="text-sm leading-relaxed">{rec}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activeTab === "draft" && brief.draft_score && (() => {
                      const ds = brief.draft_score;
                      const targetSections = Math.max(4, (parseInt(wordCount) || 1500) / 300);
                      const rows: { label: string; yours: string; target: string; ok: boolean }[] = [
                        {
                          label: "Overall score",
                          yours: `${ds.overall}/100`,
                          target: "≥ 70",
                          ok: ds.overall >= 70,
                        },
                        {
                          label: "Readability (Flesch)",
                          yours: `${ds.readability.flesch_score} — ${ds.readability.status}`,
                          target: "≥ 70 (Easy)",
                          ok: ds.readability.flesch_score >= 70,
                        },
                        {
                          label: "Keyword density",
                          yours: `${ds.keyword_density.density}% — ${ds.keyword_density.status}`,
                          target: "1–3% (Optimal)",
                          ok: ds.keyword_density.status === "optimal",
                        },
                        {
                          label: "Word count",
                          yours: `${ds.readability.word_count.toLocaleString()} words`,
                          target: `≥ ${parseInt(wordCount).toLocaleString()}`,
                          ok: ds.readability.word_count >= (parseInt(wordCount) || 1500),
                        },
                        {
                          label: "H1 headings",
                          yours: String(ds.structure.h1_count),
                          target: "Exactly 1",
                          ok: ds.structure.h1_count === 1,
                        },
                        {
                          label: "H2 headings",
                          yours: String(ds.structure.h2_count),
                          target: `≥ ${Math.round(targetSections)}`,
                          ok: ds.structure.h2_count >= targetSections,
                        },
                        {
                          label: "Keyword in draft",
                          yours: `${ds.keyword_density.occurrences} times`,
                          target: "≥ 3 times",
                          ok: ds.keyword_density.occurrences >= 3,
                        },
                      ];

                      return (
                        <div className="space-y-5">
                          <div>
                            <p className="font-semibold text-sm">Draft Analysis</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Your draft scored against <span className="font-medium text-foreground">&ldquo;{brief.primary_keyword}&rdquo;</span>
                            </p>
                          </div>

                          {/* Overall score bar */}
                          <div className="rounded-lg border p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold">Overall Draft Score</span>
                              <span className={cn(
                                "text-2xl font-bold",
                                ds.overall >= 70 ? "text-emerald-500" : ds.overall >= 45 ? "text-amber-500" : "text-red-500"
                              )}>
                                {ds.overall}<span className="text-sm font-normal text-muted-foreground">/100</span>
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  ds.overall >= 70 ? "bg-emerald-500" : ds.overall >= 45 ? "bg-amber-500" : "bg-red-500"
                                )}
                                style={{ width: `${ds.overall}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {ds.overall >= 70
                                ? "Your draft is well-optimised for this brief."
                                : ds.overall >= 45
                                  ? "Your draft needs some SEO improvements before publishing."
                                  : "Significant gaps — use the brief to rewrite key sections."}
                            </p>
                          </div>

                          {/* Comparison table */}
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/40">
                                <tr className="text-xs text-muted-foreground">
                                  <th className="text-left px-4 py-2.5 font-semibold">Check</th>
                                  <th className="text-left px-4 py-2.5 font-semibold">Your Draft</th>
                                  <th className="text-left px-4 py-2.5 font-semibold">Target</th>
                                  <th className="px-4 py-2.5"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {rows.map((row, i) => (
                                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                                    <td className="px-4 py-3 font-medium text-sm">{row.label}</td>
                                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.yours}</td>
                                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.target}</td>
                                    <td className="px-4 py-3 text-center">
                                      <span className={cn(
                                        "inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold",
                                        row.ok ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
                                      )}>
                                        {row.ok ? "✓" : "✗"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Structure issues */}
                          {ds.structure.issues.length > 0 && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                              <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Structure Issues</p>
                              <ul className="space-y-1.5">
                                {ds.structure.issues.map((issue, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                                    {issue}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                </div>
              </div>
            )}
          </div>{/* end left column */}

          {/* Right: sticky input sidebar */}
          <div className="lg:sticky lg:top-4 overflow-y-auto max-h-[calc(100vh-2rem)] hide-scrollbar">
            <div className="rounded-xl border bg-card shadow-lg bg-gradient-to-b from-card to-card/50 ring-1 ring-border/5">
              <div className="p-6 border-b bg-violet-500/5 border-violet-500/10">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 rounded-full bg-violet-500/10 items-center justify-center text-violet-500">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h2 className="font-semibold text-base">{savedBriefId ? "Saved Brief" : "Configure Brief"}</h2>
                </div>
                {savedBriefId && (
                  <p className="text-xs text-muted-foreground mt-2">Viewing saved content</p>
                )}
              </div>
              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="topic" className="text-sm font-semibold tracking-tight text-foreground/90">
                    Topic / Keyword <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary pointer-events-none" />
                    <Input
                      id="topic"
                      placeholder="how to start a business"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                      disabled={false}
                      className="pl-9 h-11 text-sm bg-background border-muted-foreground/20 focus-visible:ring-primary/20 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium tracking-tight text-foreground/80">Target Word Count</Label>
                    <Select value={wordCount} onValueChange={setWordCount} disabled={false}>
                      <SelectTrigger className="h-10 text-sm bg-background/50 border-muted-foreground/20 disabled:opacity-60 disabled:cursor-not-allowed">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WORD_COUNT_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium tracking-tight text-foreground/80">Country</Label>
                    <Select value={country || "global"} onValueChange={(v) => setCountry(v === "global" ? "" : v)} disabled={false}>
                      <SelectTrigger className="h-10 text-sm bg-background/50 border-muted-foreground/20 disabled:opacity-60 disabled:cursor-not-allowed">
                        <SelectValue placeholder="Global" />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRY_OPTIONS.map((o) => (
                          <SelectItem key={o.value || "global"} value={o.value || "global"} className="text-sm">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="p-6 pt-2 space-y-2">
                <Button
                  onClick={handleGenerate}
                  disabled={isLoading || !topic.trim()}
                  className="w-full h-12 font-semibold gap-2 shadow-md hover:shadow-lg transition-all bg-violet-500 hover:bg-violet-600 text-white disabled:bg-muted disabled:text-muted-foreground"
                >
                  {isLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating Magic...</>
                  ) : currentSaveId ? (
                    <><Brain className="h-4 w-4" /> Regenerate Brief</>
                  ) : (
                    <><Brain className="h-4 w-4" /> Generate AI Brief</>
                  )}
                </Button>
                {brief && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => {
                      sessionStorage.setItem("blog_prefill", JSON.stringify({
                        topic: brief.topic,
                        primary_keyword: brief.primary_keyword,
                        secondary_keywords: brief.secondary_keywords,
                        h2_outline: brief.h2_outline,
                        content_gaps: brief.content_gaps || [],
                        recommendations: brief.recommendations || [],
                        serp_results: (brief.serp_results || []).slice(0, 8).map((s: { title: string; link: string; snippet: string }) => ({
                          title: s.title,
                          link: s.link,
                          snippet: s.snippet,
                        })),
                        competitor_insights: (brief.competitor_insights || []).slice(0, 4).map((c: { url: string; title: string; top_keywords: string[]; content_summary?: string; headings?: string[] }) => ({
                          url: c.url,
                          title: c.title,
                          top_keywords: c.top_keywords,
                          content_summary: c.content_summary || "",
                          headings: c.headings || [],
                        })),
                        nlp_terms: brief.nlp_terms || [],
                      }));
                      router.push("/blog/generate");
                    }}
                  >
                    <BookOpen className="h-4 w-4" />
                    Generate Blog from Brief
                  </Button>
                )}
                {savedBriefId && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      sessionStorage.removeItem("blog_prefill");
                      setTopic("");
                      setWordCount("1500");
                      setCountry("");
                      setBrief(null);
                      setCurrentSaveId(null);
                      setActiveTab("outline");
                      setShowAllNlp(false);
                      router.push("/seo/brief");
                    }}
                    className="w-full"
                  >
                    ← Generate New Brief
                  </Button>
                )}
              </div>
            </div>
          </div>{/* end right sidebar */}

        </div>{/* end grid */}
      </div>
    </div>
  );
}
export default function SEOBriefPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="h-8 w-8 rounded-full border-4 border-t-violet-500 animate-spin" /></div>}>
      <SEOBriefContent />
    </Suspense>
  );
}