"use client";

import { useState, useEffect, useRef } from "react";
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
  ExternalLink,
  ScrollText,
  ClipboardList,
} from "lucide-react";
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

interface SEOBriefResponse {
  topic: string;
  primary_keyword: string;
  secondary_keywords: string[];
  keyword_data: KeywordVolume[];
  competitor_insights: CompetitorInsight[];
  h2_outline: H2Section[];
  meta_suggestions: MetaSuggestion[];
  schema_markup: Record<string, unknown>;
  serp_preview: { title: string; url: string; description: string };
  recommendations: string[];
  draft_score?: DraftScore;
}

const WORD_COUNT_OPTIONS = [
  { value: "800", label: "800 — Short" },
  { value: "1200", label: "1,200 — Medium" },
  { value: "1500", label: "1,500 — Standard" },
  { value: "2000", label: "2,000 — Long" },
  { value: "3000", label: "3,000 — In-depth" },
];

const CONTENT_TYPE_OPTIONS = [
  { value: "blog_post", label: "Blog Post" },
  { value: "how_to_guide", label: "How-To Guide" },
  { value: "listicle", label: "Listicle" },
  { value: "product_page", label: "Product Page" },
  { value: "landing_page", label: "Landing Page" },
  { value: "news_article", label: "News Article" },
];

const LOADING_STEPS = [
  "Researching keywords…",
  "Estimating search volumes…",
  "Discovering competitor pages…",
  "Scraping and verifying competitors…",
  "Scoring competitor readability…",
  "Generating meta tags…",
  "Building schema markup…",
  "AI-enriching H2 outline…",
  "Building SERP preview…",
  "Compiling recommendations…",
];

type TabId = "outline" | "keywords" | "volumes" | "meta" | "competitors" | "schema" | "recommendations" | "draft";

function buildTabs(hasDraft: boolean): { id: TabId; label: string; icon: React.ElementType }[] {
  const base: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: "outline", label: "Outline", icon: FileText },
    { id: "keywords", label: "Keywords", icon: Hash },
    { id: "volumes", label: "Volumes", icon: BarChart2 },
    { id: "meta", label: "Meta Tags", icon: Tag },
    { id: "competitors", label: "Competitors", icon: Globe },
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

function CopyBtn({ text, className }: { text: string; className?: string }) {
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
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function CharBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const ok = value <= max;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
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
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all hover:scale-105 active:scale-95",
        primary
          ? "bg-foreground text-background border-foreground"
          : "bg-muted/60 text-foreground border-border hover:border-foreground/40"
      )}
    >
      {done && <CheckCheck className="h-3 w-3 text-emerald-400" />}
      {kw}
    </button>
  );
}

function H2Item({ section, index }: { section: H2Section; index: number }) {
  const [open, setOpen] = useState(index < 3);
  return (
    <div className="rounded-lg border overflow-hidden transition-colors hover:border-foreground/20">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-medium leading-snug">{section.heading}</span>
        <div className="flex items-center gap-2 shrink-0">
          <CopyBtn text={section.heading} />
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
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
    <div className="flex flex-col items-center justify-center gap-6 py-16">
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

export default function SEOBriefPage() {
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState("blog_post");
  const [wordCount, setWordCount] = useState("1500");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [competitorsOpen, setCompetitorsOpen] = useState(false);
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [brief, setBrief] = useState<SEOBriefResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("outline");
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Please enter a topic"); return; }
    setIsLoading(true);
    setBrief(null);
    try {
      const urls = competitorUrls.split("\n").map((u) => u.trim()).filter(Boolean);
      const res = await api.post<SEOBriefResponse>("/api/seo/brief", {
        topic: topic.trim(),
        target_word_count: parseInt(wordCount) || 1500,
        competitor_urls: urls,
        content_draft: draft.trim(),
      });
      setBrief(res.data);
      setActiveTab(res.data.draft_score ? "draft" : "outline");
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "Failed to generate SEO brief");
    } finally {
      setIsLoading(false);
    }
  };

  const schemaString = brief ? JSON.stringify(brief.schema_markup, null, 2) : "";
  const outlineText = brief ? brief.h2_outline.map((s, i) => `## ${i + 1}. ${s.heading}\n-> ${s.notes}`).join("\n\n") : "";
  const allKeywords = brief ? [brief.primary_keyword, ...brief.secondary_keywords] : [];
  const TABS = buildTabs(!!brief?.draft_score);

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-card">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SEO Brief Generator</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Enter a topic — get keywords, H2 outline, meta tags, schema markup, and competitor insights.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card shadow-sm divide-y">
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="topic" className="text-sm font-semibold">
                Topic / Keyword <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="topic"
                  placeholder="e.g. how to start a dropshipping business"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  className="pl-9 h-11 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Content Type</Label>
                <Select value={contentType} onValueChange={setContentType}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Target Word Count</Label>
                <Select value={wordCount} onValueChange={setWordCount}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORD_COUNT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div>
            <button
              className="w-full flex items-center justify-between px-6 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              onClick={() => setDraftOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 font-medium">
                <ClipboardList className="h-4 w-4" />
                Add existing draft
                <Badge variant="outline" className="text-xs">Optional</Badge>
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", draftOpen && "rotate-180")} />
            </button>
            {draftOpen && (
              <div className="px-6 pb-4 pt-2 bg-muted/20">
                <p className="text-xs text-muted-foreground mb-2">Paste existing content to score its readability and keyword density.</p>
                <textarea
                  rows={5}
                  placeholder="Paste your draft here..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
            )}
          </div>

          <div>
            <button
              className="w-full flex items-center justify-between px-6 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              onClick={() => setCompetitorsOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 font-medium">
                <Globe className="h-4 w-4" />
                Add competitor URLs
                <Badge variant="outline" className="text-xs">Optional</Badge>
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", competitorsOpen && "rotate-180")} />
            </button>
            {competitorsOpen && (
              <div className="px-6 pb-4 pt-2 bg-muted/20">
                <p className="text-xs text-muted-foreground mb-2">One URL per line. We will scrape them and surface their word count, readability, and top keywords.</p>
                <textarea
                  rows={3}
                  placeholder={"https://competitor1.com/article\nhttps://competitor2.com/post"}
                  value={competitorUrls}
                  onChange={(e) => setCompetitorUrls(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                />
              </div>
            )}
          </div>

          <div className="px-6 py-4">
            <Button onClick={handleGenerate} disabled={isLoading || !topic.trim()} className="w-full h-11 font-semibold gap-2">
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate SEO Brief</>
              )}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="rounded-xl border bg-card shadow-sm">
            <LoadingState />
          </div>
        )}

        {brief && !isLoading && (
          <div ref={resultsRef} className="space-y-4">
            <div className="rounded-xl border bg-card shadow-sm p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                <div className="flex-1 space-y-3 min-w-0">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Primary Keyword</p>
                    <KwChip kw={brief.primary_keyword} primary />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">
                      Secondary Keywords <span className="normal-case font-normal">(click to copy)</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.secondary_keywords.map((kw) => <KwChip key={kw} kw={kw} />)}
                    </div>
                  </div>
                </div>
                <div className="flex sm:flex-col gap-4 sm:gap-3 shrink-0 text-center sm:text-right">
                  <div>
                    <p className="text-2xl font-bold">{brief.h2_outline.length}</p>
                    <p className="text-xs text-muted-foreground">sections</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{allKeywords.length}</p>
                    <p className="text-xs text-muted-foreground">keywords</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{brief.meta_suggestions.length}</p>
                    <p className="text-xs text-muted-foreground">meta variants</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="flex overflow-x-auto border-b bg-muted/30">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all -mb-px",
                        active
                          ? "border-foreground text-foreground bg-background"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="p-5">

                {activeTab === "outline" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">AI-Enriched Content Outline</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{brief.h2_outline.length} sections · target {parseInt(wordCount).toLocaleString()} words</p>
                      </div>
                      <CopyBtn text={outlineText} />
                    </div>
                    <div className="space-y-2">
                      {brief.h2_outline.map((section, i) => <H2Item key={i} section={section} index={i} />)}
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
                        {brief.secondary_keywords.map((kw, i) => (
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
                          {brief.keyword_data.map((k, i) => (
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
                    <div className="rounded-lg border p-4 bg-white">
                      <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Google Preview</p>
                      <p className="text-[#1a0dab] text-base font-medium leading-snug truncate">{brief.serp_preview.title}</p>
                      <p className="text-[#006621] text-xs mt-0.5">{brief.serp_preview.url}</p>
                      <p className="text-[#545454] text-sm mt-1 leading-snug line-clamp-2">{brief.serp_preview.description}</p>
                    </div>
                    {brief.meta_suggestions.map((m, i) => (
                      <div key={i} className="rounded-lg border overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Option {i + 1}</span>
                        </div>
                        <div className="p-4 space-y-4">
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium leading-snug flex-1">{m.title}</p>
                              <CopyBtn text={m.title} />
                            </div>
                            <CharBar value={m.title_length} max={60} label="Title length" />
                          </div>
                          <Separator />
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm text-muted-foreground leading-snug flex-1">{m.description}</p>
                              <CopyBtn text={m.description} />
                            </div>
                            <CharBar value={m.description_length} max={155} label="Description length" />
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
                        {brief.competitor_insights.length > 0
                          ? `${brief.competitor_insights.length} pages auto-discovered and verified`
                          : "No competitors could be verified for this topic"}
                      </p>
                    </div>
                    {brief.competitor_insights.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                        <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
                        <p className="text-sm font-medium">No competitors verified</p>
                        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                          AI searched for competitors but none responded. Add specific URLs above for manual analysis.
                        </p>
                        <button
                          onClick={() => { setCompetitorsOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                          className="mt-2 inline-flex items-center gap-1.5 text-xs text-foreground underline underline-offset-2"
                        >
                          Add URLs manually <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {brief.competitor_insights.map((c, i) => (
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
                      <p className="text-xs text-muted-foreground mt-0.5">{brief.recommendations.length} actionable tips for this topic</p>
                    </div>
                    <ul className="space-y-3">
                      {brief.recommendations.map((rec, i) => (
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
      </div>
    </div>
  );
}
