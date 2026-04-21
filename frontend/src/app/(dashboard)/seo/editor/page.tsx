"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { analyzeContent, type SEOAnalysisResult } from "@/lib/seo-analysis";
import { cn } from "@/lib/utils";
import { RichEditor } from "@/components/ui/rich-editor";
import api from "@/lib/api";
import { toast } from "sonner";
import Link from "next/dist/client/link";

const MIN_WORDS_FOR_TIPS = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ScoreResponse re-exported from seo-analysis for local use
type ScoreResponse = SEOAnalysisResult;

interface Tip {
    category: string;
    priority: "high" | "medium" | "low";
    tip: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
    optimal: "text-emerald-500",
    easy: "text-emerald-500",
    under: "text-amber-500",
    moderate: "text-amber-500",
    over: "text-red-500",
    difficult: "text-red-500",
    missing: "text-red-500",
    no_content: "text-zinc-400",
};

// ---------------------------------------------------------------------------
// Score ring â€” large, used for Overall
// ---------------------------------------------------------------------------

function ScoreRing({ value, label }: { value: number; label: string }) {
    const r = 44;
    const circ = 2 * Math.PI * r;
    const dash = Math.min(value / 100, 1) * circ;
    const color = value >= 70 ? "#22c55e" : value >= 45 ? "#f59e0b" : "#ef4444";
    return (
        <div className="flex flex-col items-center gap-1">
            <svg width="108" height="108" viewBox="0 0 108 108">
                <circle cx="54" cy="54" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
                <circle
                    cx="54" cy="54" r={r} fill="none"
                    stroke={color} strokeWidth="8"
                    strokeDasharray={`${dash} ${circ - dash}`}
                    strokeLinecap="round"
                    transform="rotate(-90 54 54)"
                    style={{ transition: "stroke-dasharray 0.5s ease" }}
                />
                <text x="54" y="50" textAnchor="middle" fill={color} fontSize="24" fontWeight="700">{value}</text>
                <text x="54" y="66" textAnchor="middle" fill={color} fontSize="11" fontWeight="600">{label}</text>
            </svg>
            <span className="text-xs text-muted-foreground">Overall Score</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Stat row
// ---------------------------------------------------------------------------

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={cn("text-xs font-semibold", highlight ?? "text-foreground")}>{value}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Score bar â€” used in 7-component breakdown
// ---------------------------------------------------------------------------

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: string }) {
    const color = score >= 70 ? "bg-emerald-500" : score >= 45 ? "bg-amber-500" : "bg-red-500";
    return (
        <div className="space-y-0.5">
            <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/60 text-[10px]">{weight}</span>
                    <span className={cn("font-semibold", score >= 70 ? "text-emerald-500" : score >= 45 ? "text-amber-500" : "text-red-500")}>{score}</span>
                </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${score}%` }} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Placement check row
// ---------------------------------------------------------------------------

function PlacementRow({ label, ok }: { label: string; ok: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={cn("text-xs font-bold", ok ? "text-emerald-500" : "text-red-500")}>
                {ok ? "âœ“" : "âœ—"}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PRIORITY_STYLE: Record<string, string> = {
    high: "border-l-red-500 bg-red-500/5",
    medium: "border-l-amber-500 bg-amber-500/5",
    low: "border-l-emerald-500 bg-emerald-500/5",
};
const PRIORITY_LABEL: Record<string, string> = {
    high: "text-red-500", medium: "text-amber-500", low: "text-emerald-500",
};

function SEOEditorContent() {
    const searchParams = useSearchParams();
    const [content, setContent] = useState("");      // HTML (editor value)
    const [plainText, setPlainText] = useState("");  // plain text for tips API
    const [targetWords, setTargetWords] = useState("1500");
    const [score, setScore] = useState<ScoreResponse | null>(null);
    const [isScoring, setIsScoring] = useState(false);
    const [tips, setTips] = useState<Tip[]>([]);
    const [isTipping, setIsTipping] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Sidebar tabs
    const [sidebarTab, setSidebarTab] = useState<"score" | "tips">("score");
    // Meta fields
    const [metaTitle, setMetaTitle] = useState("");
    const [metaDesc, setMetaDesc] = useState("");
    const [focusKeyword, setFocusKeyword] = useState("");
    const [relatedKeywords, setRelatedKeywords] = useState("");
    const [isLoadingDraft, setIsLoadingDraft] = useState(() => {
        // initialise true only when a ?draft= param is present
        if (typeof window !== "undefined") {
            return new URLSearchParams(window.location.search).has("draft");
        }
        return false;
    });

    // Load draft from saved ID if ?draft= param is present
    useEffect(() => {
        const draftId = searchParams.get("draft");
        if (!draftId) return;
        setIsLoadingDraft(true);
        api.get<{ data: { content?: string; metaTitle?: string; metaDesc?: string; focusKeyword?: string; relatedKeywords?: string } }>(`/api/seo/saves/${draftId}`)
            .then((res) => {
                const d = res.data.data;
                if (d.content) setContent(d.content);
                if (d.metaTitle) setMetaTitle(d.metaTitle);
                if (d.metaDesc) setMetaDesc(d.metaDesc);
                if (d.focusKeyword) setFocusKeyword(d.focusKeyword);
                if (d.relatedKeywords) setRelatedKeywords(d.relatedKeywords);
                setSaveId(draftId);
            })
            .catch(() => toast.error("Failed to load saved draft"))
            .finally(() => setIsLoadingDraft(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runScore = useCallback(
        (
            html: string,
            kw: string,
            title: string,
            desc: string,
            related: string,
            wc: string,
        ): SEOAnalysisResult | null => {
            const stripped = html.replace(/<[^>]+>/g, "").trim();
            if (!stripped) {
                setScore(null);
                setTips([]);
                return null;
            }
            setIsScoring(true);
            try {
                const result = analyzeContent(
                    html,
                    kw,
                    title,
                    desc,
                    related,
                    parseInt(wc) || 1500,
                );
                setScore(result);
                return result;
            } finally {
                setIsScoring(false);
            }
        },
        []
    );

    const runTips = useCallback(
        async (text: string, kw: string, s: ScoreResponse) => {
            // Only call if content is substantial (>100 words)
            const wc = text.trim().split(/\s+/).length;
            if (wc < MIN_WORDS_FOR_TIPS) return;
            setIsTipping(true);
            try {
                const res = await api.post<{ tips: Tip[] }>("/api/seo/tips", {
                    content: text,
                    primary_keyword: kw,
                    overall_score: s.overall,
                    readability_status: s.readability.status,
                    keyword_status: s.keyword_density.status,
                    structure_issues: s.structure.issues,
                });
                setTips(res.data.tips ?? []);
            } catch {
                // Silently fail
            } finally {
                setIsTipping(false);
            }
        },
        []
    );

    // Score: debounce 400ms â€” fires on any content or meta change
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            runScore(content, focusKeyword, metaTitle, metaDesc, relatedKeywords, targetWords);
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [content, focusKeyword, metaTitle, metaDesc, relatedKeywords, targetWords, runScore]);

    const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
    const overallLabel = !score ? "-" : score.overall >= 70 ? "Good" : score.overall >= 45 ? "Fair" : "Weak";
    const [isSaving, setIsSaving] = useState(false);
    const [saveId, setSaveId] = useState<string | null>(null);

    const saveDraft = useCallback(async () => {
        if (!content.trim()) { toast.error("Nothing to save â€” editor is empty"); return; }
        setIsSaving(true);
        const title = metaTitle.trim() || focusKeyword.trim() || "Untitled draft";
        const data = { content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score: score?.overall ?? null };
        try {
            if (saveId) {
                await api.put(`/api/seo/saves/${saveId}`, { type: "draft", title, data });
            } else {
                const res = await api.post<{ id: string }>("/api/seo/saves", { type: "draft", title, data });
                setSaveId(res.data.id);
            }
            toast.success("Draft saved");
        } catch {
            toast.error("Failed to save draft");
        } finally {
            setIsSaving(false);
        }
    }, [content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score, saveId]);

    if (isLoadingDraft) {
        return (
            <div className="flex h-[calc(100vh-6rem)] gap-6 overflow-hidden animate-pulse">
                {/* Left skeleton */}
                <div className="flex flex-1 flex-col gap-4 min-w-0 pr-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                            <div className="h-3 w-24 rounded bg-muted" />
                            <div className="h-7 w-48 rounded bg-muted" />
                            <div className="h-3 w-72 rounded bg-muted" />
                        </div>
                        <div className="h-8 w-24 rounded-md bg-muted shrink-0" />
                    </div>
                    <div className="flex-1 rounded-xl border bg-muted/30" />
                </div>
                {/* Right sidebar skeleton */}
                <div className="w-96 shrink-0 flex flex-col gap-4 border-l pl-4 pt-4">
                    <div className="h-8 w-full rounded bg-muted" />
                    <div className="flex flex-col items-center gap-3 pt-6">
                        <div className="h-28 w-28 rounded-full bg-muted" />
                        <div className="h-3 w-32 rounded bg-muted" />
                    </div>
                    <div className="space-y-3 px-2 pt-4">
                        {[1,2,3,4,5,6,7].map((n) => (
                            <div key={n} className="space-y-1">
                                <div className="flex justify-between">
                                    <div className="h-2.5 w-32 rounded bg-muted" />
                                    <div className="h-2.5 w-8 rounded bg-muted" />
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-muted" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-6rem)] overflow-hidden">

            {/* â”€â”€ LEFT: Editor panel â”€â”€ */}
            <div className="flex flex-1 flex-col min-w-0 pr-6 gap-4">
                {/* Header row â€” this is actually the scores ring, editor header is in the left panel */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
                            <Link href="/seo" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                                SEO
                            </Link>
                            <span>/</span>
                            <span className="text-foreground font-medium">Editor</span>
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">Live SEO Editor</h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            Paste or write your content. SEO score updates as you type.
                        </p>
                    </div>
                    <button
                        onClick={saveDraft}
                        disabled={isSaving || !content.trim()}
                        className={cn(
                            "shrink-0 rounded-md px-4 py-2 text-xs font-semibold transition-colors",
                            isSaving || !content.trim()
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-emerald-500 text-white hover:bg-emerald-600"
                        )}
                    >
                        {isSaving ? "Savingâ€¦" : "Save Draft"}
                    </button>
                </div>

                {/* Rich editor fills remaining height */}
                <div className="relative flex-1 min-h-0 flex flex-col">
                    <RichEditor
                        value={content}
                        onChange={(html, text) => {
                            setContent(html);
                            setPlainText(text);
                        }}
                        placeholder="Paste your blog post, article, or any content hereâ€¦"
                        minHeight="100%"
                        className="flex-1 h-full"
                        meta={{
                            title: metaTitle,
                            description: metaDesc,
                            focusKeyword: focusKeyword,
                            relatedKeywords: relatedKeywords
                        }}
                        onMetaChange={(m) => {
                            setMetaTitle(m.title);
                            setMetaDesc(m.description);
                            if (m.focusKeyword !== undefined) setFocusKeyword(m.focusKeyword);
                            if (m.relatedKeywords !== undefined) setRelatedKeywords(m.relatedKeywords);
                        }}
                    />
                    {isScoring && (
                        <div className="absolute bottom-3 right-3 pointer-events-none">
                            <span className="text-xs text-muted-foreground animate-pulse">Scoringâ€¦</span>
                        </div>
                    )}
                </div>
            </div>

            {/* â”€â”€ RIGHT: Sidebar â”€â”€ */}
            <div className="w-96 shrink-0 flex flex-col gap-0 border-l bg-card ">

                {/* Tab bar */}
                <div className="flex border-b shrink-0 sticky top-0 bg-card z-10">
                    {(["score", "tips"] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setSidebarTab(tab)}
                            className={cn(
                                "flex-1 py-3 text-xs font-semibold uppercase tracking-widest border-b-2 transition-all",
                                sidebarTab === tab
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {tab === "score" ? "Score" : "AI Tips"}
                        </button>
                    ))}
                </div>

                {/* â”€â”€ AI TIPS TAB â”€â”€ */}
                {sidebarTab === "tips" && (
                    <div className="flex flex-col overflow-y-auto flex-1">
                        {/* Generate button */}
                        <div className="px-5 pt-5 pb-3 border-b">
                            <button
                                type="button"
                                disabled={isTipping || wordCount < MIN_WORDS_FOR_TIPS}
                                onClick={() => score && runTips(plainText, focusKeyword, score)}
                                className={cn(
                                    "w-full rounded-md px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-all",
                                    isTipping
                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                        : wordCount < MIN_WORDS_FOR_TIPS
                                            ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                                            : "bg-foreground text-background hover:opacity-90 active:scale-[0.98]"
                                )}
                            >
                                {isTipping ? "Analysingâ€¦" : wordCount < MIN_WORDS_FOR_TIPS ? `${MIN_WORDS_FOR_TIPS - wordCount} more words needed` : "âœ¨ Generate AI Tips"}
                            </button>
                            {score && wordCount >= 100 && tips.length > 0 && (
                                <p className="text-[10px] text-muted-foreground text-center mt-1.5">Click to regenerate with latest content</p>
                            )}
                        </div>

                        <div className="px-5 py-4">
                            {!score && (
                                <p className="text-xs text-muted-foreground">Start writing to enable AI analysis.</p>
                            )}

                            {score && tips.length === 0 && !isTipping && (
                                <p className="text-xs text-muted-foreground">
                                    {wordCount < MIN_WORDS_FOR_TIPS
                                        ? `Write ${MIN_WORDS_FOR_TIPS - wordCount} more words to unlock AI tips.`
                                        : "Click \u2728 Generate AI Tips above to analyse your content."}
                                </p>
                            )}

                            {tips.length > 0 && (
                                <ul className="space-y-2">
                                    {tips.map((tip, i) => (
                                        <li
                                            key={i}
                                            className={cn(
                                                "rounded-md border-l-2 px-3 py-2 text-xs leading-relaxed",
                                                PRIORITY_STYLE[tip.priority] ?? "border-l-muted bg-muted/10"
                                            )}
                                        >
                                            <span className={cn("font-semibold block mb-0.5", PRIORITY_LABEL[tip.priority])}>
                                                {tip.category} Â· {tip.priority}
                                            </span>
                                            {tip.tip}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                {/* â”€â”€ SCORE TAB â”€â”€ */}
                {sidebarTab === "score" && <div className="flex flex-col overflow-y-auto flex-1">
                    {/* Overall score ring */}
                    <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 border-b">
                        {score ? (
                            <ScoreRing value={score.overall} label={overallLabel} />
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <div className="h-27 w-27 rounded-full border-8 border-muted/30 flex items-center justify-center">
                                    <span className="text-2xl font-bold text-muted-foreground">-</span>
                                </div>
                                <span className="text-xs text-muted-foreground">Overall Score</span>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                            {!score
                                ? "Start typing to see your SEO score"
                                : score.overall >= 70
                                    ? "Ready to publish"
                                    : score.overall >= 45
                                        ? "Needs improvement"
                                        : "Significant SEO issues"}
                        </p>
                    </div>

                    {/* 7-component score breakdown */}
                    <div className="px-5 py-4 border-b space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Score Breakdown</p>
                        <ScoreBar label="Keyword Optimisation" score={score?.keyword_score ?? 0} weight="25%" />
                        <ScoreBar label="Content Coverage" score={score?.coverage_score ?? 0} weight="20%" />
                        <ScoreBar label="Readability" score={score?.readability_score ?? 0} weight="15%" />
                        <ScoreBar label="Structure" score={score?.structure_score ?? 0} weight="15%" />
                        <ScoreBar label="Links" score={score?.links_score ?? 0} weight="10%" />
                        <ScoreBar label="Meta Tags" score={score?.meta_score ?? 0} weight="10%" />
                        <ScoreBar label="Content Length" score={score?.length_score ?? 0} weight="5%" />
                    </div>

                    {/* Meta detail */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Meta Tags</p>
                        {!metaTitle && !metaDesc ? (
                            <p className="text-xs text-muted-foreground">Fill in Title and Description in the SEO Details panel to score.</p>
                        ) : (
                            <>
                                <PlacementRow label="Title present" ok={metaTitle.length > 0} />
                                <PlacementRow label="Keyword in title" ok={score?.meta_detail.keyword_in_title ?? false} />
                                <PlacementRow label="Title length â‰¤60" ok={score?.meta_detail.title_ok ?? false} />
                                <PlacementRow label="Description present" ok={metaDesc.length > 0} />
                                <PlacementRow label="Keyword in description" ok={score?.meta_detail.keyword_in_description ?? false} />
                                <PlacementRow label="Description length â‰¤155" ok={score?.meta_detail.description_ok ?? false} />
                            </>
                        )}
                    </div>

                    {/* Keyword: density + placement */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Keyword</p>
                        {focusKeyword ? (
                            <>
                                <StatRow
                                    label="Density"
                                    value={score ? `${score.keyword_density.density}%` : "-"}
                                    highlight={score ? STATUS_COLORS[score.keyword_density.status] : undefined}
                                />
                                <StatRow label="Occurrences" value={score ? String(score.keyword_density.occurrences) : "-"} />
                                <p className="text-xs text-muted-foreground mt-2 mb-1.5">Placement</p>
                                <PlacementRow label="In H1 heading" ok={score?.keyword_placement.in_h1 ?? false} />
                                <PlacementRow label="In H2 heading" ok={score?.keyword_placement.in_h2 ?? false} />
                                <PlacementRow label="In first paragraph" ok={score?.keyword_placement.in_first_paragraph ?? false} />
                            </>
                        ) : (
                            <p className="text-xs text-muted-foreground">Enter a keyword to track density and placement.</p>
                        )}
                    </div>

                    {/* Readability */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Readability</p>
                        <StatRow label="Flesch score" value={score ? String(score.readability.flesch_score) : "-"} highlight={score ? STATUS_COLORS[score.readability.status] : undefined} />
                        <StatRow label="Grade level" value={score ? String(score.readability.grade_level) : "-"} />
                        <StatRow label="Avg sentence" value={score ? `${score.readability.avg_words_per_sentence} words` : "-"} />
                    </div>

                    {/* Content Coverage (LSI) */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Content Coverage</p>
                        <StatRow label="Unique terms" value={score ? String(score.lsi.unique_terms) : "-"} />
                        {score && score.lsi.top_terms.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {score.lsi.top_terms.slice(0, 6).map((t) => (
                                    <span key={t.term} className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted/40">
                                        {t.term}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Structure */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Structure</p>
                        <div className="grid grid-cols-3 gap-2 text-center mb-3">
                            {[
                                { label: "H1", count: score?.structure.h1_count ?? 0 },
                                { label: "H2", count: score?.structure.h2_count ?? 0 },
                                { label: "H3", count: score?.structure.h3_count ?? 0 },
                            ].map(({ label, count }) => (
                                <div key={label} className="rounded-lg border py-2">
                                    <p className={cn("text-base font-bold", count === 0 ? "text-muted-foreground" : "")}>{count}</p>
                                    <p className="text-xs text-muted-foreground">{label}</p>
                                </div>
                            ))}
                        </div>
                        {score && score.structure.issues.length > 0 && (
                            <ul className="space-y-1.5">
                                {score.structure.issues.map((issue, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
                                        <span className="shrink-0 mt-0.5">âš </span>{issue}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {score && score.structure.issues.length === 0 && (
                            <p className="text-xs text-emerald-500">âœ“ Structure looks good</p>
                        )}
                    </div>

                    {/* Links */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Links</p>
                        <StatRow label="Internal links" value={score ? String(score.links.internal_count) : "-"} />
                        <StatRow label="External links" value={score ? String(score.links.external_count) : "-"} />
                    </div>

                    {/* Target word count */}
                    <div className="px-5 py-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Target Word Count</p>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="100"
                                max="10000"
                                step="100"
                                value={targetWords}
                                onChange={(e) => setTargetWords(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">words</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                                className={cn("h-full rounded-full transition-all duration-500",
                                    wordCount >= (parseInt(targetWords) || 1500) ? "bg-emerald-500" :
                                        wordCount >= (parseInt(targetWords) || 1500) * 0.6 ? "bg-amber-500" : "bg-muted-foreground/40"
                                )}
                                style={{ width: `${Math.min(100, (wordCount / (parseInt(targetWords) || 1500)) * 100)}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{wordCount} / {parseInt(targetWords) || 1500} words</p>
                    </div>
                </div>}
            </div>
        </div>
    );
}

export default function SEOEditorPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin h-6 w-6 rounded-full border-2 border-foreground border-t-transparent" /></div>}>
            <SEOEditorContent />
        </Suspense>
    );
}
