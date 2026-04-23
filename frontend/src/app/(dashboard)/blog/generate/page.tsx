"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  ArrowLeft,
  BookOpen,
  Copy,
  CheckCheck,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import api from "@/lib/api";
import { markdownToSafeHtml } from "@/lib/markdown";

interface H2Section {
  heading: string;
  notes: string;
}

interface BlogPrefill {
  topic: string;
  primary_keyword: string;
  secondary_keywords: string[];
  h2_outline: H2Section[];
  content_gaps?: string[];
  recommendations?: string[];
  serp_results?: { title: string; link: string; snippet: string }[];
  competitor_insights?: { url: string; title: string; top_keywords: string[]; content_summary?: string; headings?: string[] }[];
  nlp_terms?: string[];
  tone?: string;
}

interface BlogResult {
  title: string;
  content: string;
  word_count: number;
  primary_keyword: string;
  meta_title: string;
  meta_description: string;
  schema_markup: Record<string, unknown>;
  save_id?: string | null;
}

const WORD_COUNTS = [
  { value: "800", label: "800 — Short" },
  { value: "1200", label: "1,200 — Medium" },
  { value: "1500", label: "1,500 — Standard" },
  { value: "2000", label: "2,000 — Long" },
  { value: "3000", label: "3,000 — In-depth" },
];

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "witty", label: "Witty" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
];

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
    >
      {done ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied!" : label}
    </button>
  );
}

// Markdown is rendered via `markdownToSafeHtml` (marked + DOMPurify).
// Styling comes from the `prose` wrapper on the render div.

function BlogGenerateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedId = searchParams.get("id");

  const [currentSaveId, setCurrentSaveId] = useState<string | null>(savedId);
  const [topic, setTopic] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([]);
  const [contentGaps, setContentGaps] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [serpResults, setSerpResults] = useState<{ title: string; link: string; snippet: string }[]>([]);
  const [competitorInsights, setCompetitorInsights] = useState<{ url: string; title: string; top_keywords: string[] }[]>([]);
  const [nlpTerms, setNlpTerms] = useState<string[]>([]);
  const [wordCount, setWordCount] = useState("1500");
  const [tone, setTone] = useState("professional");
  const [outlineText, setOutlineText] = useState("");
  const [showOutline, setShowOutline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<BlogResult | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  // Tracks whether `blog_prefill` set tone on this mount, so the brand-kit
  // async fetch doesn't later clobber the brief's explicit choice.
  const toneFromPrefillRef = useRef(false);

  // Silently load brand kit for business context
  const [businessContext, setBusinessContext] = useState<{
    business_name: string; niche: string; location: string;
    target_audience: string; products: string; brand_voice: string;
  } | null>(null);

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
          // Use brand-kit tone only if the brief prefill didn't already set one,
          // so we don't race-overwrite the user's explicit choice.
          if (res.data.tone && !toneFromPrefillRef.current) setTone(res.data.tone);
        }
      })
      .catch(() => {}); // silent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load prefill from sessionStorage (coming from SEO brief).
  // A fresh brief → fresh blog record: clear any saved-blog linkage that
  // might otherwise UPSERT the brief's new content over an unrelated blog.
  useEffect(() => {
    const raw = sessionStorage.getItem("blog_prefill");
    if (!raw) return;
    try {
      const prefill: BlogPrefill = JSON.parse(raw);
      setTopic(prefill.topic || "");
      setPrimaryKeyword(prefill.primary_keyword || "");
      if (prefill.secondary_keywords?.length) setSecondaryKeywords(prefill.secondary_keywords);
      if (prefill.content_gaps?.length) setContentGaps(prefill.content_gaps);
      if (prefill.recommendations?.length) setRecommendations(prefill.recommendations);
      if (prefill.serp_results?.length) setSerpResults(prefill.serp_results);
      if (prefill.competitor_insights?.length) setCompetitorInsights(prefill.competitor_insights);
      if (prefill.nlp_terms?.length) setNlpTerms(prefill.nlp_terms);
      if (prefill.tone) { setTone(prefill.tone); toneFromPrefillRef.current = true; }
      if (prefill.h2_outline?.length) {
        setOutlineText(prefill.h2_outline.map((s) => s.heading).join("\n"));
        setShowOutline(true);
      }
      // New brief means a new blog — disconnect from any previously loaded save.
      setCurrentSaveId(null);
      setResult(null);
    } catch { /* ignore */ }
    sessionStorage.removeItem("blog_prefill");
  }, []);

  // Load saved blog if ?id= param present — restore BOTH the result and the
  // configuration that produced it, so the user can tweak and regenerate
  // in place rather than retype everything.
  useEffect(() => {
    if (!savedId) return;
    setIsLoading(true);
    api.get(`/api/blog/saves/${savedId}`)
      .then((res) => {
        const d = res.data.data;
        if (d) {
          setResult({
            title: d.title,
            content: d.content,
            word_count: d.word_count,
            primary_keyword: d.primary_keyword,
            meta_title: d.meta_title,
            meta_description: d.meta_description,
            schema_markup: d.schema_markup,
            save_id: savedId,
          });
          setTopic(d.topic || d.title || "");
          if (d.primary_keyword) setPrimaryKeyword(d.primary_keyword);
          if (Array.isArray(d.secondary_keywords) && d.secondary_keywords.length) {
            setSecondaryKeywords(d.secondary_keywords);
          }
          if (d.tone) setTone(d.tone);
          if (d.word_count) {
            // Snap to nearest preset so the <Select> has a match.
            const presets = WORD_COUNTS.map((w) => parseInt(w.value));
            const nearest = presets.reduce((p, c) =>
              Math.abs(c - d.word_count) < Math.abs(p - d.word_count) ? c : p
            );
            setWordCount(String(nearest));
          }
          setCurrentSaveId(savedId);
        }
      })
      .catch(() => toast.error("Failed to load saved blog"))
      .finally(() => setIsLoading(false));
  }, [savedId]);

  const parseOutline = (): H2Section[] => {
    if (!outlineText.trim()) return [];
    return outlineText
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean)
      .map((heading) => ({ heading, notes: "" }));
  };

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Please enter a topic"); return; }
    setIsLoading(true);
    setResult(null);
    try {
      const res = await api.post<BlogResult>("/api/blog/generate", {
        topic: topic.trim(),
        primary_keyword: primaryKeyword.trim(),
        secondary_keywords: secondaryKeywords,
        nlp_terms: nlpTerms,
        content_gaps: contentGaps,
        seo_recommendations: recommendations,
        serp_results: serpResults,
        competitor_insights: competitorInsights,
        h2_outline: parseOutline(),
        word_count: parseInt(wordCount) || 1500,
        tone,
        save_id: currentSaveId,          // updates in place if present
        ...(businessContext && { business_context: businessContext }),
      }, { timeout: 120_000 });
      setResult(res.data);

      const returnedId = res.data.save_id;
      if (returnedId && returnedId !== currentSaveId) {
        setCurrentSaveId(returnedId);
        // Put the id in the URL so a refresh resumes this blog.
        router.replace(`/blog/generate?id=${returnedId}`, { scroll: false });
      }
      toast.success(
        currentSaveId ? "Blog updated in your library" : "Saved to your library",
        returnedId ? { description: "Find it in /blog" } : undefined,
      );
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e.response?.data?.detail || "Failed to generate blog");
    } finally {
      setIsLoading(false);
    }
  };

  const openInEditor = () => {
    if (!result) return;
    // Prepend the blog title as <h1> — the generator prompt intentionally
    // skips H1 in body, so without this the editor's Structure score would
    // always report "Missing H1". metaTitle still carries the SERP title.
    const titleEscaped = result.title
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const body = markdownToSafeHtml(result.content);
    const html = `<h1>${titleEscaped}</h1>\n${body}`;

    // Structured prefill: HTML + meta + keywords + target word count.
    // The editor's legacy string-prefill path still works as a fallback.
    const prefill = {
      content: html,
      metaTitle: result.meta_title,
      metaDesc: result.meta_description,
      focusKeyword: result.primary_keyword,
      relatedKeywords: secondaryKeywords.join(", "),
      targetWords: String(result.word_count || parseInt(wordCount) || 1500),
    };
    sessionStorage.setItem("seo_editor_prefill", JSON.stringify(prefill));
    router.push("/seo/editor");
  };

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
        <span className="text-foreground font-medium">Blog Generator</span>
      </div>

      <div className="mx-auto py-4 space-y-8">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-blue-500/10 border-blue-500/20">
            <BookOpen className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Blog Generator</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Enter a topic to generate a full SEO-optimised blog post — or come from the SEO Brief for best results.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

          {/* Left — Output */}
          <div ref={resultRef} className="space-y-4 min-w-0">
            {isLoading && (
              <div className="rounded-xl border bg-card p-8 flex flex-col items-center justify-center gap-4 min-h-[300px]">
                <div className="relative">
                  <div className="h-12 w-12 rounded-full border-4 border-muted" />
                  <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-t-blue-500 animate-spin" />
                  <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-blue-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Writing your blog post…</p>
                  <p className="text-xs text-muted-foreground mt-1">This takes 15-30 seconds</p>
                </div>
              </div>
            )}

            {!isLoading && !result && (
              <div className="rounded-xl border bg-card p-10 flex flex-col items-center justify-center gap-3 min-h-[300px] text-center">
                <FileText className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Your blog post will appear here</p>
              </div>
            )}

            {result && (
              <div className="rounded-xl border bg-card overflow-hidden">
                {/* Title bar */}
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold leading-snug">{result.title}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{result.word_count} words</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <CopyBtn text={result.content} label="Copy Blog" />
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={openInEditor}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in Editor
                    </Button>
                  </div>
                </div>

                {/* Blog content */}
                <div
                  className="blog-rendered px-6 py-5 text-sm"
                  dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(result.content) }}
                />

                {/* Meta tags */}
                <div className="px-6 py-4 border-t bg-muted/20 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meta Tags</p>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase mb-0.5">Title</p>
                        <p className="text-xs">{result.meta_title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{result.meta_title.length} / 60 chars</p>
                      </div>
                      <CopyBtn text={result.meta_title} />
                    </div>
                    <div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase mb-0.5">Description</p>
                        <p className="text-xs">{result.meta_description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{result.meta_description.length} / 155 chars</p>
                      </div>
                      <CopyBtn text={result.meta_description} />
                    </div>
                  </div>
                </div>

                {/* Schema markup — collapsible */}
                <div className="px-6 py-3 border-t">
                  <button
                    onClick={() => setShowSchema((v) => !v)}
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    {showSchema ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    Schema Markup (JSON-LD)
                  </button>
                  {showSchema && (
                    <div className="mt-3 relative">
                      <pre className="rounded-md bg-muted/40 border p-3 text-xs overflow-x-auto">
                        {JSON.stringify(result.schema_markup, null, 2)}
                      </pre>
                      <div className="absolute top-2 right-2">
                        <CopyBtn text={JSON.stringify(result.schema_markup, null, 2)} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right — Controls */}
          <div className="rounded-xl border bg-card overflow-hidden sticky top-4">
            <div className="px-5 py-4 border-b bg-muted/30">
              <p className="text-sm font-semibold">Configuration</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="topic" className="text-xs font-medium">Topic *</Label>
                <Input
                  id="topic"
                  placeholder="e.g., How to grow your dental practice"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="keyword" className="text-xs font-medium">Primary Keyword</Label>
                <Input
                  id="keyword"
                  placeholder="e.g., dental practice marketing"
                  value={primaryKeyword}
                  onChange={(e) => setPrimaryKeyword(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Word Count</Label>
                <Select value={wordCount} onValueChange={setWordCount}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORD_COUNTS.map((w) => (
                      <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* H2 Outline — collapsible */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowOutline((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {showOutline ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  H2 Outline {outlineText.trim() && <span className="text-emerald-500">(prefilled)</span>}
                </button>
                {showOutline && (
                  <Textarea
                    placeholder={"One heading per line:\nWhat is dental marketing?\nSocial media strategies for dentists\n..."}
                    value={outlineText}
                    onChange={(e) => setOutlineText(e.target.value)}
                    rows={6}
                    className="text-xs resize-none"
                  />
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t">
              <Button
                onClick={handleGenerate}
                disabled={isLoading || !topic.trim()}
                className="w-full h-11 font-semibold gap-2 bg-blue-500 hover:bg-blue-600 text-white disabled:bg-muted disabled:text-muted-foreground"
              >
                <BookOpen className="h-4 w-4" />
                {isLoading ? "Writing Blog…" : "Generate Blog"}
              </Button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function BlogGeneratePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    }>
      <BlogGenerateContent />
    </Suspense>
  );
}
