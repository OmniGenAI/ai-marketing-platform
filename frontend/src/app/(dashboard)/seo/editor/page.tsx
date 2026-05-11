"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { analyzeContent, contentLengthStatus, type SEOAnalysisResult } from "@/lib/seo-analysis";
import { cn } from "@/lib/utils";
import { RichEditor } from "@/components/ui/rich-editor";
import api from "@/lib/api";
import { toast } from "sonner";
import Link from "next/dist/client/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PenLine, Send, Code2, Loader2, Linkedin, CheckCircle2, Recycle, AlertCircle, Check, X, Undo2, Sparkles, RotateCw } from "lucide-react";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PublishToDevToDialog } from "@/components/blog/PublishToDevToDialog";

const MIN_WORDS_FOR_TIPS = 100;
const AUTOSAVE_DEBOUNCE_MS = 2000;
const TIPS_GENERATE_COOLDOWN_MS = 5_000;       // throttle Generate clicks
const UNDO_STACK_LIMIT = 10;                    // bound memory growth
const APPLY_MIN_WORDS_RATIO = 0.5;              // local guard: reject if applied output < 50% words

// Stable hash for a tip's identity (category + tip text) so dismissed tips
// don't reappear after a regenerate. Cheap, deterministic, collision-tolerant
// for our use case (small set per draft).
function hashTip(t: Tip): string {
    const s = `${t.category}::${t.tip}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return `t${(h >>> 0).toString(36)}`;
}

// Stable hash for the analysis input. Used to cache /api/seo/tips responses
// so re-clicking Generate without edits returns instantly with no API call.
function hashInput(parts: Array<string | number>): string {
    const s = parts.map(String).join("|");
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
}

type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

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
    near: "text-emerald-500",
    under: "text-amber-500",
    moderate: "text-amber-500",
    short: "text-muted-foreground",
    over: "text-red-500",
    difficult: "text-red-500",
    missing: "text-red-500",
    no_content: "text-zinc-400",
};

// Target-word-count progress bar colors � mirror the ContentLengthStatus
// bands from seo-analysis.ts so the bar color always matches the status.
const LENGTH_BAR_BG: Record<string, string> = {
    optimal: "bg-emerald-500",
    near: "bg-emerald-400",
    under: "bg-amber-500",
    short: "bg-muted-foreground/40",
};

// ---------------------------------------------------------------------------
// Score ring � large, used for Overall
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
// Score bar � used in 7-component breakdown
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

// ---------------------------------------------------------------------------
// Autosave status indicator
// ---------------------------------------------------------------------------

function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
    if (status === "idle") return null;
    const label =
        status === "saving" ? "Saving…" :
        status === "saved" ? "Saved" :
        "Autosave failed";
    const color =
        status === "saving" ? "text-muted-foreground animate-pulse" :
        status === "saved" ? "text-emerald-500" :
        "text-red-500";
    return <span className={cn("text-xs", color)}>{label}</span>;
}

function PlacementRow({ label, ok }: { label: string; ok: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={cn("inline-flex items-center justify-center h-4 w-4 rounded-full", ok ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600")}>
                {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Word-level diff — small LCS-based implementation (no external dep).
// Returns segments of `{ type: "equal" | "add" | "remove", text }` suitable
// for inline rendering. Operates on tokens that include trailing whitespace
// so the output reflows naturally.
// ---------------------------------------------------------------------------

type DiffSegment = { type: "equal" | "add" | "remove"; text: string };

function tokenize(s: string): string[] {
    // Splits text into words + whitespace runs, preserving order so we can
    // rejoin without spacing artefacts.
    return s.match(/\S+\s*|\s+/g) ?? [];
}

function diffWords(oldStr: string, newStr: string): DiffSegment[] {
    const a = tokenize(oldStr);
    const b = tokenize(newStr);
    const m = a.length;
    const n = b.length;

    // Compute LCS lengths via DP. For long inputs we trim to a safe ceiling.
    const MAX_TOKENS = 2000;
    if (m > MAX_TOKENS || n > MAX_TOKENS) {
        // Fall back to "remove all then add all" for huge diffs to avoid stalling the tab.
        return [
            { type: "remove", text: oldStr },
            { type: "add", text: newStr },
        ];
    }

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out: DiffSegment[] = [];
    const push = (type: DiffSegment["type"], text: string) => {
        const last = out[out.length - 1];
        if (last && last.type === type) last.text += text;
        else out.push({ type, text });
    };

    let i = 0, j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) { push("equal", a[i]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { push("remove", a[i]); i++; }
        else { push("add", b[j]); j++; }
    }
    while (i < m) { push("remove", a[i++]); }
    while (j < n) { push("add", b[j++]); }
    return out;
}

// Strip tags to plain text for body diffs — diffing raw HTML is too noisy.
function htmlToPlain(html: string): string {
    return html
        .replace(/<\/(?:p|div|h[1-6]|li|tr|td|th|blockquote|section|article)>/gi, "$&\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function DiffView({ before, after }: { before: string; after: string }) {
    const segments = diffWords(before, after);
    if (segments.every(s => s.type === "equal")) {
        return <p className="text-xs text-muted-foreground italic">No changes</p>;
    }
    return (
        <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
            {segments.map((seg, i) => {
                if (seg.type === "equal") return <span key={i} className="text-muted-foreground">{seg.text}</span>;
                if (seg.type === "add") return <span key={i} className="bg-emerald-100 text-emerald-800 rounded px-0.5">{seg.text}</span>;
                return <span key={i} className="bg-red-100 text-red-800 line-through rounded px-0.5">{seg.text}</span>;
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// HTML diff — produces a single HTML string that preserves the block
// structure (headings, paragraphs, lists) and wraps word-level changes in
// <ins>/<del> tags. Rendered inside the RichEditor's prose canvas so the
// diff looks visually identical to the actual editor.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Render diff segments back to HTML using <ins>/<del>/plain spans.
function segmentsToHtml(segs: DiffSegment[]): string {
    return segs.map(s => {
        const txt = escapeHtml(s.text);
        if (s.type === "add") return `<ins>${txt}</ins>`;
        if (s.type === "remove") return `<del>${txt}</del>`;
        return txt;
    }).join("");
}

// Rich-token: a chunk of inline content that knows its plain text (for
// diffing) and its HTML (for emitting). Inline marks like <strong>, <em>,
// <a> are wrapped around the original text — so equal tokens emit the
// fully-formatted HTML and only the changed words drop their marks.
type RichToken = { text: string; html: string };

const INLINE_TAGS = new Set(["STRONG", "B", "EM", "I", "U", "S", "CODE", "A", "MARK", "SPAN", "SUP", "SUB"]);

// Build the opening/closing pair for an inline element while keeping its
// safe attributes (href on <a>, etc.).
function inlineWrappers(el: Element): { open: string; close: string } {
    const tag = el.tagName.toLowerCase();
    let attrs = "";
    if (tag === "a") {
        const href = el.getAttribute("href");
        if (href) attrs += ` href="${escapeHtml(href)}"`;
        const target = el.getAttribute("target");
        if (target) attrs += ` target="${escapeHtml(target)}"`;
        const rel = el.getAttribute("rel");
        if (rel) attrs += ` rel="${escapeHtml(rel)}"`;
    }
    return { open: `<${tag}${attrs}>`, close: `</${tag}>` };
}

// Walk an element's children and emit rich tokens for inline content.
function tokenizeBlock(el: Element): RichToken[] {
    const tokens: RichToken[] = [];
    const pushText = (text: string, wrap?: { open: string; close: string }) => {
        const parts = text.match(/\S+\s*|\s+/g) ?? [];
        for (const p of parts) {
            const escaped = escapeHtml(p);
            tokens.push({
                text: p,
                html: wrap ? `${wrap.open}${escaped}${wrap.close}` : escaped,
            });
        }
    };
    const walk = (node: Node, wrap?: { open: string; close: string }) => {
        if (node.nodeType === Node.TEXT_NODE) {
            pushText(node.textContent ?? "", wrap);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const e = node as Element;
        if (INLINE_TAGS.has(e.tagName)) {
            const w = inlineWrappers(e);
            // Compose with parent wrapper if nested (e.g. <strong><em>).
            const merged = wrap
                ? { open: `${wrap.open}${w.open}`, close: `${w.close}${wrap.close}` }
                : w;
            for (const child of Array.from(e.childNodes)) walk(child, merged);
        } else if (e.tagName === "BR") {
            tokens.push({ text: " ", html: "<br>" });
        } else {
            // Unknown inline-ish container — recurse without wrapping.
            for (const child of Array.from(e.childNodes)) walk(child, wrap);
        }
    };
    for (const child of Array.from(el.childNodes)) walk(child);
    return tokens;
}

// Block representation — text blocks now carry rich tokens to preserve
// inline formatting; list items get their own token arrays per <li>.
type Block =
    | { kind: "text"; tag: string; tokens: RichToken[] }
    | { kind: "list"; tag: "ul" | "ol"; items: RichToken[][] };

function parseBlocks(html: string): Block[] {
    if (typeof window === "undefined") return [];
    const doc = new DOMParser().parseFromString(html || "<p></p>", "text/html");
    const blocks: Block[] = [];
    const textTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "BLOCKQUOTE"]);
    for (const child of Array.from(doc.body.children)) {
        const tag = child.tagName;
        if (textTags.has(tag)) {
            blocks.push({ kind: "text", tag: tag.toLowerCase(), tokens: tokenizeBlock(child) });
        } else if (tag === "UL" || tag === "OL") {
            const items = Array.from(child.children)
                .filter(c => c.tagName === "LI")
                .map(li => tokenizeBlock(li));
            blocks.push({ kind: "list", tag: tag.toLowerCase() as "ul" | "ol", items });
        }
    }
    return blocks;
}

// Diff two rich-token sequences and emit HTML. Equal tokens emit their
// original HTML (preserving bold/em/links). Changed tokens get wrapped in
// <ins>/<del> using escaped plain text so the diff stays unambiguous.
function diffRichTokens(a: RichToken[], b: RichToken[]): string {
    const m = a.length;
    const n = b.length;
    const MAX_TOKENS = 2000;
    if (m > MAX_TOKENS || n > MAX_TOKENS) {
        const allDel = a.map(t => `<del>${escapeHtml(t.text)}</del>`).join("");
        const allIns = b.map(t => t.html).join("");
        return allDel + allIns;
    }
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const parts: string[] = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (a[i].text === b[j].text) { parts.push(b[j].html); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { parts.push(`<del>${escapeHtml(a[i].text)}</del>`); i++; }
        else { parts.push(`<ins>${escapeHtml(b[j].text)}</ins>`); j++; }
    }
    while (i < m) { parts.push(`<del>${escapeHtml(a[i++].text)}</del>`); }
    while (j < n) { parts.push(`<ins>${escapeHtml(b[j++].text)}</ins>`); }
    return parts.join("");
}

// Build an HTML diff string. Walks parallel blocks; for lists, diffs each
// <li> item under a shared <ul>/<ol> wrapper so indentation is preserved.
function buildDiffHtml(beforeHtml: string, afterHtml: string): string {
    const a = parseBlocks(beforeHtml);
    const b = parseBlocks(afterHtml);
    const max = Math.max(a.length, b.length);
    const out: string[] = [];
    const tokensToHtml = (tokens: RichToken[]) => tokens.map(t => t.html).join("");
    const tokensToText = (tokens: RichToken[]) => tokens.map(t => escapeHtml(t.text)).join("");

    for (let i = 0; i < max; i++) {
        const A = a[i];
        const B = b[i];
        if (A && B && A.kind === "list" && B.kind === "list") {
            const tag = B.tag;
            const len = Math.max(A.items.length, B.items.length);
            const lis: string[] = [];
            for (let j = 0; j < len; j++) {
                const ai = A.items[j];
                const bi = B.items[j];
                if (ai !== undefined && bi !== undefined) {
                    lis.push(`<li>${diffRichTokens(ai, bi)}</li>`);
                } else if (bi !== undefined) {
                    lis.push(`<li><ins>${tokensToText(bi)}</ins></li>`);
                } else if (ai !== undefined) {
                    lis.push(`<li><del>${tokensToText(ai)}</del></li>`);
                }
            }
            out.push(`<${tag}>${lis.join("")}</${tag}>`);
        } else if (A && B && A.kind === "text" && B.kind === "text") {
            out.push(`<${B.tag}>${diffRichTokens(A.tokens, B.tokens)}</${B.tag}>`);
        } else if (B) {
            if (B.kind === "list") {
                const items = B.items.map(toks => `<li><ins>${tokensToText(toks)}</ins></li>`).join("");
                out.push(`<${B.tag}>${items}</${B.tag}>`);
            } else {
                // Preserve inline formatting on entirely-new blocks too.
                out.push(`<${B.tag}><ins>${tokensToHtml(B.tokens)}</ins></${B.tag}>`);
            }
        } else if (A) {
            if (A.kind === "list") {
                const items = A.items.map(toks => `<li><del>${tokensToText(toks)}</del></li>`).join("");
                out.push(`<${A.tag}>${items}</${A.tag}>`);
            } else {
                out.push(`<${A.tag}><del>${tokensToText(A.tokens)}</del></${A.tag}>`);
            }
        }
    }
    return out.join("");
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
    const router = useRouter();
    const pathname = usePathname();
    const [content, setContent] = useState("");      // HTML (editor value)
    const [plainText, setPlainText] = useState("");  // plain text for tips API
    const [targetWords, setTargetWords] = useState("1500");
    const [score, setScore] = useState<ScoreResponse | null>(null);
    const [isScoring, setIsScoring] = useState(false);
    const [tips, setTips] = useState<Tip[]>([]);
    const [isTipping, setIsTipping] = useState(false);
    // Dismissed/applied tip hashes — persisted in draft so they don't reappear
    // after a regenerate within the same draft session.
    const [dismissedTips, setDismissedTips] = useState<Set<string>>(new Set());
    // Per-tip apply tracking — disables the row's button + shows a loader.
    const [applyingIndexes, setApplyingIndexes] = useState<Set<number>>(new Set());
    // Cache: contentHash -> tips[]. Re-Generate without edits = instant return.
    const tipsCacheRef = useRef<Map<string, Tip[]>>(new Map());
    // Cache for /apply-tips responses keyed on (content + meta + tips signature)
    // so discarding a preview and re-applying the same tip skips the LLM call.
    const applyCacheRef = useRef<Map<string, {
        html: string;
        meta_title: string;
        meta_description: string;
        applied: number[];
        skipped: { index: number; reason: string }[];
        changes_summary: string;
    }>>(new Map());
    // Undo stack — snapshots of {content, metaTitle, metaDesc} after each apply.
    const undoStackRef = useRef<Array<{ content: string; metaTitle: string; metaDesc: string }>>([]);
    const [undoVersion, setUndoVersion] = useState(0); // bump to re-render the Undo button enabled/disabled state
    // Last-generate timestamp — used to throttle Generate clicks.
    const lastTipsGenRef = useRef<number>(0);
    // Diff preview state — holds the proposed apply result until the user confirms.
    const [diffPreview, setDiffPreview] = useState<{
        beforeContent: string;
        beforeMetaTitle: string;
        beforeMetaDesc: string;
        afterContent: string;
        afterMetaTitle: string;
        afterMetaDesc: string;
        applied: number[];
        skipped: { index: number; reason: string }[];
        changesSummary: string;
        selectedTips: Tip[];
        indexes: number[];
        oldScore: number;
    } | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Sidebar tabs
    const [sidebarTab, setSidebarTab] = useState<"score" | "tips">("score");
    // Meta fields
    const [metaTitle, setMetaTitle] = useState("");
    const [metaDesc, setMetaDesc] = useState("");
    const [focusKeyword, setFocusKeyword] = useState("");
    const [relatedKeywords, setRelatedKeywords] = useState("");
    const [isLoadingDraft, setIsLoadingDraft] = useState(false);

    // Set loading state on mount if ?draft= param is present (avoids SSR/client mismatch)
    useEffect(() => {
        if (searchParams.get("draft")) setIsLoadingDraft(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load draft from saved ID if ?draft= param is present
    // Read prefill from sessionStorage (coming from Blog Generator or similar).
    // New callers pass a JSON object with { content, metaTitle, metaDesc,
    // focusKeyword, relatedKeywords }. Legacy string callers still work �
    // we treat the raw string as HTML content.
    useEffect(() => {
        const raw = sessionStorage.getItem("seo_editor_prefill");
        if (!raw) return;
        sessionStorage.removeItem("seo_editor_prefill");
        let html = raw;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                if (typeof parsed.content === "string") html = parsed.content;
                if (typeof parsed.metaTitle === "string") setMetaTitle(parsed.metaTitle);
                if (typeof parsed.metaDesc === "string") setMetaDesc(parsed.metaDesc);
                if (typeof parsed.focusKeyword === "string") setFocusKeyword(parsed.focusKeyword);
                if (typeof parsed.relatedKeywords === "string") setRelatedKeywords(parsed.relatedKeywords);
                if (typeof parsed.targetWords === "string" && parsed.targetWords) {
                    setTargetWords(parsed.targetWords);
                } else if (typeof parsed.targetWords === "number") {
                    setTargetWords(String(parsed.targetWords));
                }
            }
        } catch {
            // raw string (legacy) � fall through
        }
        setContent(html);
        setPlainText(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const draftId = searchParams.get("draft");
        if (!draftId) return;
        setIsLoadingDraft(true);
        api.get<{ data: { content?: string; metaTitle?: string; metaDesc?: string; focusKeyword?: string; relatedKeywords?: string; scheduledAt?: string; platforms?: string[] } }>(`/api/seo/saves/${draftId}`)
            .then((res) => {
                const d = res.data.data;
                if (d.content) {
                    setContent(d.content);
                    // Seed plainText so the AI Tips button and word-count gates see the
                    // loaded content immediately (RichEditor's onChange fires later).
                    setPlainText(d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
                }
                if (d.metaTitle) setMetaTitle(d.metaTitle);
                if (d.metaDesc) setMetaDesc(d.metaDesc);
                if (d.focusKeyword) setFocusKeyword(d.focusKeyword);
                if (d.relatedKeywords) setRelatedKeywords(d.relatedKeywords);
                if (d.scheduledAt) setScheduledDate(d.scheduledAt);
                if (d.platforms?.length) setSelectedPlatforms(d.platforms);
                setSaveId(draftId);
                hasUserEditedRef.current = true; // allow autosave for loaded drafts
                // Seed the snapshot so autosave treats the loaded state as "in sync"
                // and only fires after the user actually edits something.
                lastSavedSnapshotRef.current = JSON.stringify({
                    content: d.content ?? "",
                    metaTitle: d.metaTitle ?? "",
                    metaDesc: d.metaDesc ?? "",
                    focusKeyword: d.focusKeyword ?? "",
                    relatedKeywords: d.relatedKeywords ?? "",
                });
                setAutoSaveStatus("saved");
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
        async (text: string, s: ScoreResponse) => {
            const wc = text.trim().split(/\s+/).length;
            if (wc < MIN_WORDS_FOR_TIPS) return;

            // Cooldown — stops accidental double-clicks burning LLM credits.
            const now = Date.now();
            if (now - lastTipsGenRef.current < TIPS_GENERATE_COOLDOWN_MS) {
                const left = Math.ceil((TIPS_GENERATE_COOLDOWN_MS - (now - lastTipsGenRef.current)) / 1000);
                toast.info(`Please wait ${left}s before regenerating`);
                return;
            }

            // Cache key — covers everything that influences the LLM response.
            const cacheKey = hashInput([
                content, metaTitle, metaDesc, focusKeyword, relatedKeywords, targetWords, s.overall,
            ]);
            const cached = tipsCacheRef.current.get(cacheKey);
            if (cached) {
                lastTipsGenRef.current = now;
                setTips(cached.filter(t => !dismissedTips.has(hashTip(t))));
                return;
            }

            setIsTipping(true);
            lastTipsGenRef.current = now;
            try {
                const res = await api.post<{ tips: Tip[] }>("/api/seo/tips", {
                    html: content,
                    meta_title: metaTitle,
                    meta_description: metaDesc,
                    primary_keyword: focusKeyword,
                    related_keywords: relatedKeywords,
                    target_word_count: parseInt(targetWords) || 1500,
                    analysis: s,
                });
                const fresh = res.data.tips ?? [];
                tipsCacheRef.current.set(cacheKey, fresh);
                setTips(fresh.filter(t => !dismissedTips.has(hashTip(t))));
            } catch {
                toast.error("Couldn't generate tips — please try again");
            } finally {
                setIsTipping(false);
            }
        },
        [content, metaTitle, metaDesc, focusKeyword, relatedKeywords, targetWords, dismissedTips]
    );

    const derivedText = plainText.trim() || content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = derivedText ? derivedText.split(/\s+/).length : 0;
    const overallLabel = !score ? "-" : score.overall >= 70 ? "Good" : score.overall >= 45 ? "Fair" : "Weak";
    const [isSaving, setIsSaving] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [devtoOpen, setDevtoOpen] = useState(false);
    const [scheduledDate, setScheduledDate] = useState("");
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
    const [isPublishing, setIsPublishing] = useState(false);

    // Fetch connected providers � used to populate the publish platform list dynamically.
    // Only fetched when the publish dialog is open to avoid unnecessary requests.
    const { data: providers = [] } = useQuery<{ platform: string; configured: boolean; connected: boolean; page_name: string | null }[]>({
        queryKey: ["social-providers"],
        queryFn: async () => (await api.get("/api/social/providers")).data,
        staleTime: 60 * 1000,
        enabled: publishOpen,
    });
    const [saveId, setSaveId] = useState<string | null>(null);
    const [isApplying, setIsApplying] = useState(false);
    const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
    // Only auto-create a draft after the user has actually typed/edited in the
    // editor. Prevents blog-prefilled content from being auto-saved immediately.
    const hasUserEditedRef = useRef(false);
    // Holds the in-flight POST when we auto-create a draft on first edit.
    // Acts as a mutex so concurrent callers share one create call.
    const autoCreateInFlightRef = useRef<Promise<string> | null>(null);
    // Serialised snapshot of the last state that reached the server � used by
    // autosave to skip no-op saves when nothing actually changed.
    const lastSavedSnapshotRef = useRef<string>("");
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const buildSnapshot = useCallback(
        () => JSON.stringify({ content, metaTitle, metaDesc, focusKeyword, relatedKeywords, scheduledDate }),
        [content, metaTitle, metaDesc, focusKeyword, relatedKeywords, scheduledDate],
    );

    const ensureSaveId = useCallback(async (): Promise<string | null> => {
        if (saveId) return saveId;
        if (autoCreateInFlightRef.current) return autoCreateInFlightRef.current;

        const title = metaTitle.trim() || focusKeyword.trim() || "Untitled draft";
        const data = { content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score: score?.overall ?? null, scheduledAt: scheduledDate || null };

        const snapshot = buildSnapshot();
        const p = api
            .post<{ id: string }>("/api/seo/saves", { type: "draft", title, data })
            .then((res) => {
                setSaveId(res.data.id);
                lastSavedSnapshotRef.current = snapshot;
                setAutoSaveStatus("saved");
                router.replace(`${pathname}?draft=${res.data.id}`, { scroll: false });
                return res.data.id;
            })
            .finally(() => { autoCreateInFlightRef.current = null; });

        autoCreateInFlightRef.current = p;
        try { return await p; } catch { return null; }
    }, [saveId, content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score, router, pathname, buildSnapshot]);

    // Autosave: 2s after the last edit, PUT the current state. Only runs once
    // a draft ID exists (auto-create or load handles the very first save).
    // Skipped while apply-tips is in flight to avoid saving the pre-rewrite state.
    useEffect(() => {
        if (!saveId || isApplying) return;
        const snapshot = buildSnapshot();
        if (snapshot === lastSavedSnapshotRef.current) return;

        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(async () => {
            setAutoSaveStatus("saving");
            try {
                const title = metaTitle.trim() || focusKeyword.trim() || "Untitled draft";
                const data = { content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score: score?.overall ?? null, scheduledAt: scheduledDate || null };
                await api.put(`/api/seo/saves/${saveId}`, { type: "draft", title, data });
                lastSavedSnapshotRef.current = snapshot;
                setAutoSaveStatus("saved");
            } catch {
                setAutoSaveStatus("error");
            }
        }, AUTOSAVE_DEBOUNCE_MS);

        return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    }, [saveId, isApplying, content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score, buildSnapshot]);

    // Score + auto-create: debounce 400ms � fires on any content or meta change
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            runScore(content, focusKeyword, metaTitle, metaDesc, relatedKeywords, targetWords);
            const plain = content.replace(/<[^>]+>/g, "").trim();
            if (plain.length > 0 && !saveId && !autoCreateInFlightRef.current && hasUserEditedRef.current) {
                ensureSaveId();
            }
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [content, focusKeyword, metaTitle, metaDesc, relatedKeywords, targetWords, runScore, saveId, ensureSaveId]);

    // Push a snapshot onto the undo stack, capping at UNDO_STACK_LIMIT.
    const pushUndo = useCallback((snap: { content: string; metaTitle: string; metaDesc: string }) => {
        const stack = undoStackRef.current;
        stack.push(snap);
        if (stack.length > UNDO_STACK_LIMIT) stack.shift();
        setUndoVersion(v => v + 1);
    }, []);

    const popUndo = useCallback(() => {
        const stack = undoStackRef.current;
        const snap = stack.pop();
        if (!snap) return;
        setContent(snap.content);
        setMetaTitle(snap.metaTitle);
        setMetaDesc(snap.metaDesc);
        setUndoVersion(v => v + 1);
        toast.success("Reverted last change");
    }, []);

    // Count words from HTML (used for safety guard on apply output).
    const countHtmlWords = useCallback((html: string) => {
        const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return txt ? txt.split(/\s+/).length : 0;
    }, []);

    // Phase 1: fetch the rewrite, run safety guards, and open the diff preview
    // modal. Does NOT touch editor state — that happens in commitApply().
    // When `forceRefresh` is true, the cache is bypassed and a new LLM call
    // is made — used by the Regenerate button in the diff preview.
    const applyTipSubset = useCallback(async (selectedTips: Tip[], indexes: number[], forceRefresh = false) => {
        if (!score || !content.trim() || selectedTips.length === 0) return;
        setApplyingIndexes(prev => {
            const next = new Set(prev);
            indexes.forEach(i => next.add(i));
            return next;
        });
        if (indexes.length === tips.length) setIsApplying(true);

        const oldWordCount = countHtmlWords(content);
        const oldScore = score.overall;

        // Cache key — covers everything the /apply-tips endpoint sees.
        // Tips are hashed by their (category, tip) identity, order-sensitive.
        const tipsSignature = selectedTips.map(t => hashTip(t)).join(",");
        // v3: bumped after backend added FACTS-block (length-check) prompting
        // so cached no-op responses from the old prompt are evicted.
        const applyCacheKey = hashInput([
            "v3", content, metaTitle, metaDesc, focusKeyword, relatedKeywords, targetWords, tipsSignature,
        ]);
        // On force-refresh, drop the cached entry so the next branch falls
        // through to the LLM call and a fresh result is stored.
        if (forceRefresh) applyCacheRef.current.delete(applyCacheKey);

        const openPreview = (d: {
            html: string;
            meta_title: string;
            meta_description: string;
            applied: number[];
            skipped: { index: number; reason: string }[];
            changes_summary: string;
        }) => {
            // Safety guard — protect against accidental content destruction.
            const newWordCount = countHtmlWords(d.html);
            if (oldWordCount > 0 && newWordCount < oldWordCount * APPLY_MIN_WORDS_RATIO) {
                toast.error(`Apply rejected — output (${newWordCount} words) too short vs original (${oldWordCount}). Try again or apply tips one at a time.`);
                return;
            }
            const oldH1 = (content.match(/<h1\b/gi) ?? []).length;
            const newH1 = (d.html.match(/<h1\b/gi) ?? []).length;
            if (oldH1 > 0 && newH1 === 0) {
                toast.error("Apply rejected — output is missing the H1 heading. Try again.");
                return;
            }

            // No-op detector: if the LLM returned everything unchanged, skip
            // the diff preview and surface a clear message instead of opening
            // an empty diff (confusing UX). This also catches the case where
            // the model said "already within limits" and made no edits.
            const unchanged =
                d.html === content &&
                d.meta_title === metaTitle &&
                d.meta_description === metaDesc;
            if (unchanged) {
                if (d.skipped.length > 0) {
                    const sample = d.skipped[0];
                    toast.message("No changes applied", {
                        description: sample.reason || "The AI didn't propose any edits for the selected tip(s).",
                    });
                } else {
                    toast.info("AI returned no changes — try a different tip or regenerate.");
                }
                return;
            }

            setDiffPreview({
                beforeContent: content,
                beforeMetaTitle: metaTitle,
                beforeMetaDesc: metaDesc,
                afterContent: d.html,
                afterMetaTitle: d.meta_title,
                afterMetaDesc: d.meta_description,
                applied: d.applied,
                skipped: d.skipped,
                changesSummary: d.changes_summary,
                selectedTips,
                indexes,
                oldScore,
            });
        };

        // Cache hit → skip LLM call entirely (no token cost, instant preview).
        const cached = applyCacheRef.current.get(applyCacheKey);
        if (cached) {
            openPreview(cached);
            setApplyingIndexes(prev => {
                const next = new Set(prev);
                indexes.forEach(i => next.delete(i));
                return next;
            });
            setIsApplying(false);
            return;
        }

        try {
            const res = await api.post<{
                html: string;
                meta_title: string;
                meta_description: string;
                applied: number[];
                skipped: { index: number; reason: string }[];
                changes_summary: string;
            }>("/api/seo/apply-tips", {
                html: content,
                meta_title: metaTitle,
                meta_description: metaDesc,
                primary_keyword: focusKeyword,
                related_keywords: relatedKeywords,
                target_word_count: parseInt(targetWords) || 1500,
                tips: selectedTips,
                analysis: score,
            });
            applyCacheRef.current.set(applyCacheKey, res.data);
            openPreview(res.data);
        } catch {
            toast.error("Couldn't apply tips — please try again");
        } finally {
            setApplyingIndexes(prev => {
                const next = new Set(prev);
                indexes.forEach(i => next.delete(i));
                return next;
            });
            setIsApplying(false);
        }
    }, [tips, score, content, metaTitle, metaDesc, focusKeyword, relatedKeywords, targetWords, countHtmlWords]);

    // Phase 2: user confirmed the preview — commit the rewrite to the editor.
    const commitApply = useCallback(() => {
        const p = diffPreview;
        if (!p) return;
        const snapshot = { content: p.beforeContent, metaTitle: p.beforeMetaTitle, metaDesc: p.beforeMetaDesc };

        pushUndo(snapshot);
        setContent(p.afterContent);
        setMetaTitle(p.afterMetaTitle);
        setMetaDesc(p.afterMetaDesc);

        // Drop tips that the server marked applied.
        const selectedApplied = p.applied.map(i => p.selectedTips[i]).filter(Boolean);
        if (selectedApplied.length) {
            setTips(prev => prev.filter(t => !selectedApplied.some(s => s.tip === t.tip && s.category === t.category)));
        }

        // Re-score immediately for the visual reward.
        const updatedScore = analyzeContent(
            p.afterContent,
            focusKeyword,
            p.afterMetaTitle,
            p.afterMetaDesc,
            relatedKeywords,
            parseInt(targetWords) || 1500,
        );
        setScore(updatedScore);
        const delta = updatedScore.overall - p.oldScore;

        const deltaText = delta > 0 ? ` (+${delta} score)` : delta < 0 ? ` (${delta} score)` : "";
        toast.success(
            `Applied ${p.applied.length} of ${p.selectedTips.length} tip${p.selectedTips.length > 1 ? "s" : ""}${deltaText}`,
            {
                description: p.changesSummary || undefined,
                action: {
                    label: "Undo",
                    onClick: () => {
                        setContent(snapshot.content);
                        setMetaTitle(snapshot.metaTitle);
                        setMetaDesc(snapshot.metaDesc);
                    },
                },
            }
        );
        if (p.skipped.length) {
            const sample = p.skipped[0];
            toast.message(`${p.skipped.length} tip${p.skipped.length > 1 ? "s" : ""} skipped`, {
                description: sample.reason || "Some tips needed external data.",
            });
        }
        setDiffPreview(null);
    }, [diffPreview, focusKeyword, relatedKeywords, targetWords, pushUndo]);

    // Re-run the LLM with the same selected tips, bypassing the cache.
    // Used by the Regenerate button in the diff preview to fetch a fresh
    // proposed rewrite when the user doesn't like the current one.
    const regenerateApply = useCallback(async () => {
        const p = diffPreview;
        if (!p) return;
        const { selectedTips, indexes } = p;
        setDiffPreview(null); // close preview while regenerating
        await applyTipSubset(selectedTips, indexes, true);
    }, [diffPreview, applyTipSubset]);

    const runApplyTips = useCallback(async () => {
        if (!tips.length) return;
        await applyTipSubset(tips, tips.map((_, i) => i));
    }, [tips, applyTipSubset]);

    const applySingleTip = useCallback(async (idx: number) => {
        const t = tips[idx];
        if (!t) return;
        await applyTipSubset([t], [idx]);
    }, [tips, applyTipSubset]);

    const dismissTip = useCallback((idx: number) => {
        const t = tips[idx];
        if (!t) return;
        const h = hashTip(t);
        setDismissedTips(prev => {
            const next = new Set(prev);
            next.add(h);
            return next;
        });
        setTips(prev => prev.filter((_, i) => i !== idx));
    }, [tips]);

    const saveDraft = useCallback(async () => {
        if (!content.trim()) { toast.error("Nothing to save � editor is empty"); return; }
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        setIsSaving(true);
        try {
            const id = await ensureSaveId();
            if (!id) { toast.error("Failed to save draft"); return; }
            const title = metaTitle.trim() || focusKeyword.trim() || "Untitled draft";
            const data = { content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score: score?.overall ?? null, scheduledAt: scheduledDate || null };
            const snapshot = buildSnapshot();
            await api.put(`/api/seo/saves/${id}`, { type: "draft", title, data });
            lastSavedSnapshotRef.current = snapshot;
            setAutoSaveStatus("saved");
            toast.success("Draft saved");
        } catch {
            setAutoSaveStatus("error");
            toast.error("Failed to save draft");
        } finally {
            setIsSaving(false);
        }
    }, [content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score, ensureSaveId, buildSnapshot]);

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
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
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
        <>
        <div className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3 shrink-0">
                <button
                    onClick={() => router.back()}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                </button>
                <span>/</span>
                <span className="text-foreground font-medium">SEO Editor</span>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* ── LEFT: Editor panel ── */}
            <div className="flex flex-1 flex-col min-w-0 pr-6 gap-4">
                {/* Header row � this is actually the scores ring, editor header is in the left panel */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-emerald-500/10 border-emerald-500/20">
                            <PenLine className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight dark:text-white">Live SEO Editor</h1>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                Paste or write your content. SEO score updates as you type.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <AutoSaveIndicator status={autoSaveStatus} />
                        <button
                            onClick={saveDraft}
                            disabled={isSaving || !content.trim()}
                            className={cn(
                                "rounded-md px-4 py-2 text-xs font-semibold transition-colors",
                                isSaving || !content.trim()
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-emerald-500 text-white hover:bg-emerald-600"
                            )}
                        >
                            {isSaving ? "Saving..." : "Save Draft"}
                        </button>
                        <button
                            onClick={() => {
                                if (!content.trim()) { toast.error("Editor is empty"); return; }
                                setPublishOpen(true);
                            }}
                            disabled={!content.trim()}
                            className={cn(
                                "rounded-md px-4 py-2 text-xs font-semibold transition-colors flex items-center gap-1.5",
                                !content.trim()
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                        >
                            <Send className="h-3.5 w-3.5" />
                            Publish
                        </button>
                    </div>
                </div>

                {/* Rich editor fills remaining height. While diff preview is
                    active we show a styled clone of the TipTap canvas that
                    renders the diff HTML (with <ins>/<del> for changes) so it
                    looks identical to the real editor.   */}
                <div className="relative flex-1 min-h-0 flex flex-col">
                    {diffPreview && (() => {
                        const p = diffPreview;
                        const projectedScore = analyzeContent(
                            p.afterContent, focusKeyword, p.afterMetaTitle, p.afterMetaDesc, relatedKeywords,
                            parseInt(targetWords) || 1500,
                        );
                        const delta = projectedScore.overall - p.oldScore;
                        const diffHtml = buildDiffHtml(p.beforeContent, p.afterContent);
                        return (
                            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                                {/* Floating action bar — like VS Code Copilot's "Keep" toolbar */}
                                <div className="shrink-0 flex items-center justify-between gap-3 border-b border-emerald-200 bg-linear-to-r from-emerald-50 via-emerald-50/50 to-transparent px-4 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold text-foreground">AI suggested changes</p>
                                            <p className="text-[11px] text-muted-foreground truncate">
                                                {p.changesSummary || `${p.applied.length} change${p.applied.length > 1 ? "s" : ""} — review then keep or discard`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                                            <Check className="h-3 w-3" /> {p.applied.length}
                                        </span>
                                        {p.skipped.length > 0 && (
                                            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold">
                                                <AlertCircle className="h-3 w-3" /> {p.skipped.length}
                                            </span>
                                        )}
                                        <span className={cn(
                                            "hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                                            delta > 0 ? "bg-emerald-100 text-emerald-700" :
                                            delta < 0 ? "bg-red-100 text-red-700" :
                                            "bg-muted text-muted-foreground"
                                        )}>
                                            {p.oldScore} → {projectedScore.overall}
                                            {delta !== 0 && <span>({delta > 0 ? "+" : ""}{delta})</span>}
                                        </span>
                                        <button
                                            onClick={() => setDiffPreview(null)}
                                            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-muted/50 transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" /> Discard
                                        </button>
                                        <button
                                            onClick={regenerateApply}
                                            disabled={isApplying || applyingIndexes.size > 0}
                                            title="Discard this proposal and ask the AI again"
                                            className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <RotateCw className="h-3.5 w-3.5" /> Regenerate
                                        </button>
                                        <button
                                            onClick={commitApply}
                                            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 text-xs font-semibold transition-colors"
                                        >
                                            <Check className="h-3.5 w-3.5" /> Keep Changes
                                        </button>
                                    </div>
                                </div>

                                {/* Clone of TipTap A4 canvas — same prose styles via rich-editor-content/ProseMirror */}
                                <div className="rich-editor-content flex-1 overflow-y-auto min-h-0 bg-muted/30">
                                    <div className="mx-auto bg-background shadow-sm" style={{ width: "210mm", minHeight: "297mm" }}>
                                        {/* Meta-fields diff (when changed) */}
                                        {(p.beforeMetaTitle !== p.afterMetaTitle || p.beforeMetaDesc !== p.afterMetaDesc) && (
                                            <div className="border-b" style={{ padding: "8mm 25mm" }}>
                                                {p.beforeMetaTitle !== p.afterMetaTitle && (
                                                    <div className="mb-3">
                                                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70 mb-1">SEO Title</p>
                                                        <p className="text-sm leading-snug" dangerouslySetInnerHTML={{ __html: segmentsToHtml(diffWords(p.beforeMetaTitle, p.afterMetaTitle)) }} />
                                                    </div>
                                                )}
                                                {p.beforeMetaDesc !== p.afterMetaDesc && (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70 mb-1">Meta Description</p>
                                                        <p className="text-sm leading-snug" dangerouslySetInnerHTML={{ __html: segmentsToHtml(diffWords(p.beforeMetaDesc, p.afterMetaDesc)) }} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {/* Body diff — rendered inside the same ProseMirror selector so prose styling matches */}
                                        <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: diffHtml }} />
                                    </div>
                                </div>

                                {/* Skipped tips footer (only when there are any) */}
                                {p.skipped.length > 0 && (
                                    <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-4 py-2">
                                        <p className="text-[10px] uppercase tracking-widest font-semibold text-amber-700 mb-0.5">
                                            {p.skipped.length} tip{p.skipped.length > 1 ? "s" : ""} skipped
                                        </p>
                                        <ul className="space-y-0.5">
                                            {p.skipped.slice(0, 2).map((s, i) => (
                                                <li key={i} className="text-xs text-amber-800">
                                                    <span className="font-semibold">#{s.index + 1}:</span> {s.reason || "No reason given"}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Real editor — stays mounted but hidden behind the diff overlay so state isn't lost */}
                    <div className={cn("flex-1 min-h-0 flex flex-col", diffPreview && "hidden")}>
                        <RichEditor
                            value={content}
                            onChange={(html, text) => {
                                hasUserEditedRef.current = true;
                                setContent(html);
                                setPlainText(text);
                            }}
                            placeholder="Paste your blog post, article, or any content here..."
                            minHeight="100%"
                            className="flex-1 h-full"
                            meta={{
                                title: metaTitle,
                                description: metaDesc,
                                focusKeyword: focusKeyword,
                                relatedKeywords: relatedKeywords
                            }}
                            onMetaChange={(m) => {
                                hasUserEditedRef.current = true;
                                setMetaTitle(m.title);
                                setMetaDesc(m.description);
                                if (m.focusKeyword !== undefined) setFocusKeyword(m.focusKeyword);
                                if (m.relatedKeywords !== undefined) setRelatedKeywords(m.relatedKeywords);
                            }}
                        />
                        {isScoring && (
                            <div className="absolute bottom-3 right-3 pointer-events-none">
                                <span className="text-xs text-muted-foreground animate-pulse">Scoring...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── RIGHT: Sidebar ── */}
            <div className="w-96 shrink-0 flex flex-col gap-0 border-l bg-card ">

                {/* Tab bar */}
                <div className="flex border-b shrink-0 sticky top-0 bg-card z-10">
                    {(["score", "tips"] as const).map((tab) => {
                        const highCount = tab === "tips" ? tips.filter(t => t.priority === "high").length : 0;
                        return (
                            <button
                                key={tab}
                                onClick={() => setSidebarTab(tab)}
                                className={cn(
                                    "flex-1 py-3 text-xs font-semibold uppercase tracking-widest border-b-2 transition-all flex items-center justify-center gap-1.5",
                                    sidebarTab === tab
                                        ? "border-foreground text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <span>{tab === "score" ? "Score" : "AI Tips"}</span>
                                {tab === "tips" && highCount > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                                        {highCount}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* ── AI TIPS TAB ── */}
                {sidebarTab === "tips" && (
                    <div className="flex flex-col overflow-y-auto flex-1">
                        {/* Generate button + Undo */}
                        <div className="px-5 pt-5 pb-3 border-b space-y-2">
                            <button
                                type="button"
                                disabled={isTipping || wordCount < MIN_WORDS_FOR_TIPS}
                                onClick={() => score && runTips(derivedText, score)}
                                className={cn(
                                    "w-full rounded-md px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-all inline-flex items-center justify-center gap-1.5",
                                    isTipping
                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                        : wordCount < MIN_WORDS_FOR_TIPS
                                            ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                                            : "bg-foreground text-background hover:opacity-90 active:scale-[0.98]"
                                )}
                            >
                                {isTipping ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing...</>
                                ) : wordCount < MIN_WORDS_FOR_TIPS ? (
                                    `${MIN_WORDS_FOR_TIPS - wordCount} more words needed`
                                ) : (
                                    <><Sparkles className="h-3.5 w-3.5" /> Generate AI Tips</>
                                )}
                            </button>
                            {undoStackRef.current.length > 0 && (
                                <button
                                    type="button"
                                    onClick={popUndo}
                                    className="w-full rounded-md px-4 py-1.5 text-xs font-semibold border hover:bg-muted/50 inline-flex items-center justify-center gap-1.5"
                                    title={`${undoStackRef.current.length} change${undoStackRef.current.length > 1 ? "s" : ""} can be undone`}
                                >
                                    <Undo2 className="h-3 w-3" />
                                    Undo last apply ({undoStackRef.current.length})
                                </button>
                            )}
                            {score && wordCount >= 100 && tips.length > 0 && (
                                <p className="text-[10px] text-muted-foreground text-center">Click to regenerate with latest content</p>
                            )}
                            {/* Undo version is part of deps so the button re-renders. */}
                            <span className="hidden" data-undo-version={undoVersion} />
                        </div>

                        <div className="px-5 py-4">
                            {!score && (
                                <p className="text-xs text-muted-foreground">Start writing to enable AI analysis.</p>
                            )}

                            {score && tips.length === 0 && !isTipping && (
                                <p className="text-xs text-muted-foreground">
                                    {wordCount < MIN_WORDS_FOR_TIPS
                                        ? `Write ${MIN_WORDS_FOR_TIPS - wordCount} more words to unlock AI tips.`
                                        : "Click ✨ Generate AI Tips above to analyse your content."}
                                </p>
                            )}

                            {tips.length > 0 && (
                                <>
                                    <button
                                        type="button"
                                        disabled={isApplying || applyingIndexes.size > 0}
                                        onClick={runApplyTips}
                                        className={cn(
                                            "mb-3 w-full rounded-md px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-all inline-flex items-center justify-center gap-1.5",
                                            isApplying || applyingIndexes.size > 0
                                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                                : "bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98]"
                                        )}
                                    >
                                        {isApplying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying tips...</> : `Apply all ${tips.length} tips`}
                                    </button>
                                    <ul className="space-y-2">
                                        {tips.map((tip, i) => {
                                            const busy = applyingIndexes.has(i);
                                            return (
                                                <li
                                                    key={i}
                                                    className={cn(
                                                        "rounded-md border-l-2 px-3 py-2 text-xs leading-relaxed",
                                                        PRIORITY_STYLE[tip.priority] ?? "border-l-muted bg-muted/10"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                        <span className={cn("font-semibold", PRIORITY_LABEL[tip.priority])}>
                                                            {tip.category} • {tip.priority}
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                disabled={busy || isApplying}
                                                                onClick={() => applySingleTip(i)}
                                                                title="Apply this tip"
                                                                className={cn(
                                                                    "inline-flex items-center justify-center h-6 px-2 rounded text-[10px] font-semibold uppercase",
                                                                    busy
                                                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                                                        : "bg-emerald-500 text-white hover:bg-emerald-600"
                                                                )}
                                                            >
                                                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={busy}
                                                                onClick={() => dismissTip(i)}
                                                                title="Dismiss"
                                                                className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <p className="text-foreground/90">{tip.tip}</p>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── SCORE TAB ── */}
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
                                <PlacementRow label="Title length 10–60" ok={score?.meta_detail.title_ok ?? false} />
                                <PlacementRow label="Description present" ok={metaDesc.length > 0} />
                                <PlacementRow label="Keyword in description" ok={score?.meta_detail.keyword_in_description ?? false} />
                                <PlacementRow label="Description length 50–155" ok={score?.meta_detail.description_ok ?? false} />
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
                                        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />{issue}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {score && score.structure.issues.length === 0 && (
                            <p className="text-xs text-emerald-500 inline-flex items-center gap-1.5"><Check className="h-3 w-3" /> Structure looks good</p>
                        )}
                    </div>

                    {/* Links */}
                    <div className="px-5 py-4 border-b">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Links</p>
                        <StatRow label="Total links" value={score ? String(score.links.count) : "-"} />
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
                        {(() => {
                            const target = parseInt(targetWords) || 1500;
                            const pct = Math.min(100, Math.round((wordCount / target) * 100));
                            const status = contentLengthStatus(pct);
                            return (
                                <>
                                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                        <div
                                            className={cn("h-full rounded-full transition-all duration-500", LENGTH_BAR_BG[status])}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        {wordCount} / {target} words
                                        {wordCount > target ? <span className="text-emerald-500"> (target met)</span> : null}
                                    </p>
                                </>
                            );
                        })()}
                    </div>
                </div>}
            </div>
            </div>{/* end flex wrapper */}
        </div>

        {/* -- Publish dialogs -- */}
        <Dialog open={publishOpen} onOpenChange={(o) => { setPublishOpen(o); if (!o) setSelectedPlatforms([]); }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="h-4 w-4" /> Publish Blog
                    </DialogTitle>
                    <DialogDescription>
                        Choose platforms, repurpose options, then publish or schedule.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-1">

                    {/* -- Section 1: Platform selection --
                        BLOG_PLATFORMS defines which providers support blog/article publishing.
                        Adding a new platform here + to the backend providers list is all that's needed. */}
                    {(() => {
                        // Blog-capable platforms � add new ones here as they're implemented
                        const BLOG_PLATFORMS: Record<string, { label: string; icon: React.ReactNode; bg: string }> = {
                            devto:    { label: "Dev.to",   icon: <Code2 className="h-4 w-4" />,    bg: "bg-[#0A0A0A]" },
                            linkedin: { label: "LinkedIn", icon: <Linkedin className="h-4 w-4" />, bg: "bg-[#0A66C2]" },
                            // Future: medium, hashnode, wordpress � add here and they appear automatically
                        };
                        const blogProviders = providers.filter(p => BLOG_PLATFORMS[p.platform]);
                        return (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    1 � Select Platforms
                                </p>
                                {blogProviders.length === 0 ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        No blog platforms connected yet.
                                        <button
                                            className="underline hover:text-foreground ml-auto shrink-0"
                                            onClick={() => { setPublishOpen(false); window.location.href = "/settings"; }}
                                        >
                                            Connect in Settings
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        {blogProviders.map(p => {
                                            const cfg = BLOG_PLATFORMS[p.platform]!;
                                            const selected = selectedPlatforms.includes(p.platform);
                                            return (
                                                <button
                                                    key={p.platform}
                                                    onClick={() => setSelectedPlatforms(prev =>
                                                        prev.includes(p.platform) ? prev.filter(x => x !== p.platform) : [...prev, p.platform]
                                                    )}
                                                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${
                                                        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                                                    }`}
                                                >
                                                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white ${cfg.bg}`}>
                                                        {cfg.icon}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium">{cfg.label}</p>
                                                        {p.page_name && <p className="text-[11px] text-muted-foreground truncate">{p.page_name}</p>}
                                                    </div>
                                                    {selected ? (
                                                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                                    ) : !p.connected ? (
                                                        <span
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={(e) => { e.stopPropagation(); setPublishOpen(false); window.location.href = "/settings"; }}
                                                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setPublishOpen(false); window.location.href = "/settings"; } }}
                                                            className="text-[11px] font-medium text-amber-600 hover:text-amber-700 hover:underline shrink-0 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                                                        >
                                                            Connect
                                                        </span>
                                                    ) : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {selectedPlatforms.length > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {selectedPlatforms.length} platform{selectedPlatforms.length > 1 ? "s" : ""} selected
                                    </p>
                                )}
                            </div>
                        );
                    })()}

                    {/* -- Section 2: Repurpose -- */}
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            2 � Repurpose (Optional)
                        </p>
                        <button
                            className="w-full flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors text-left"
                            onClick={async () => {
                                setPublishOpen(false);
                                await saveDraft();
                                sessionStorage.setItem("repurpose_prefill", JSON.stringify({
                                    content: content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
                                    source_url: "",
                                }));
                                window.location.href = "/generate/repurpose/new";
                            }}
                        >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white">
                                <Recycle className="h-4 w-4" />
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold">Repurpose as Social Posts</p>
                                <p className="text-xs text-muted-foreground">Turn this blog into LinkedIn, Twitter, Instagram posts</p>
                            </div>
                        </button>
                    </div>

                    {/* -- Section 3: Schedule or Publish -- */}
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            3 � Schedule or Publish
                        </p>
                        <div className="rounded-lg border p-3 space-y-2">
                            <p className="text-xs text-muted-foreground">Optional: pick a date/time to auto-publish. Leave empty to publish now.</p>
                            <DateTimePicker
                                value={scheduledDate}
                                onChange={setScheduledDate}
                                placeholder="Pick date & time"
                            />
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button
                                className="flex-1 gap-1.5"
                                disabled={selectedPlatforms.length === 0 || isPublishing}
                                onClick={async () => {
                                    if (selectedPlatforms.length === 0) { toast.error("Select at least one platform"); return; }
                                    setIsPublishing(true);
                                    // Capture date before any state changes — explicit save so scheduledAt is persisted
                                    const pickedDate = scheduledDate;
                                    try {
                                        const id = await ensureSaveId();
                                        if (id) {
                                            const title = metaTitle.trim() || focusKeyword.trim() || "Untitled draft";
                                            const saveData = { content, metaTitle, metaDesc, focusKeyword, relatedKeywords, score: score?.overall ?? null, scheduledAt: pickedDate || null, platforms: selectedPlatforms };
                                            await api.put(`/api/seo/saves/${id}`, { type: "draft", title, data: saveData });
                                        }
                                    } catch { /* autosave will retry */ }
                                    // Dev.to: open dedicated dialog
                                    if (selectedPlatforms.includes("devto")) {
                                        setPublishOpen(false);
                                        setIsPublishing(false);
                                        setDevtoOpen(true);
                                        return;
                                    }
                                    if (pickedDate) {
                                        toast.success(`Blog scheduled for ${new Date(pickedDate).toLocaleString()}`);
                                    } else {
                                        toast.success(`Blog ready � connect ${selectedPlatforms.join(", ")} in Settings to publish.`);
                                    }
                                    setPublishOpen(false);
                                    setIsPublishing(false);
                                    setSelectedPlatforms([]);
                                    setPublishOpen(false);
                                    setIsPublishing(false);
                                    setSelectedPlatforms([]);
                                }}
                            >
                                {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                {scheduledDate ? "Schedule" : "Publish Now"}
                            </Button>
                            <Button variant="outline" onClick={() => setPublishOpen(false)}>
                                Cancel
                            </Button>
                        </div>
                        {selectedPlatforms.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center">Select at least one platform above</p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>

        {/* Dev.to publish dialog — reuses existing component */}
        <PublishToDevToDialog
            open={devtoOpen}
            onOpenChange={setDevtoOpen}
            saveId={saveId}
            defaultTitle={metaTitle || focusKeyword || "Untitled"}
            defaultTags={focusKeyword ? [focusKeyword] : []}
            onPublished={() => {
                toast.success("Published to Dev.to!");
                setDevtoOpen(false);
            }}
        />

        </>
    );
}

export default function SEOEditorPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin h-6 w-6 rounded-full border-2 border-foreground border-t-transparent" /></div>}>
            <SEOEditorContent />
        </Suspense>
    );
}

