"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/queries";
import {
    PenLine,
    Search,
    ArrowRight,
    Trash2,
    ExternalLink,
    TrendingUp,
    FileText,
    Image as ImageIcon,
    Film,
    Gauge,
    Eye,
} from "lucide-react";
import api from "@/lib/api";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
    PaginationEllipsis,
} from "@/components/ui/pagination";

const tools = [
    {
        href: "/seo/brief",
        icon: Search,
        title: "SEO Brief",
        description:
            "Generate a full SEO brief — keyword research, competitor insights, H2 outline, meta tag suggestions, schema markup, and SERP preview for any topic.",
        cta: "Generate Brief",
        accent: "from-violet-500/10 to-violet-500/5 border-violet-500/20",
        iconColor: "text-violet-500",
        ctaColor: "bg-violet-500 hover:bg-violet-600",
    },
    {
        href: "/seo/editor",
        icon: PenLine,
        title: "SEO Editor",
        description:
            "Write or paste your content and get a live SEO score with a full breakdown — keyword density, readability, structure, meta tags, links, and AI-powered improvement tips.",
        cta: "Open Editor",
        accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20",
        iconColor: "text-emerald-500",
        ctaColor: "bg-emerald-500 hover:bg-emerald-600",
    },
];

interface SeoSaveItem {
    id: string;
    type: "brief" | "draft";
    title: string;
    data: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

interface ContentStatusItem {
    id: string;
    kind: "post" | "poster" | "reel";
    title: string;
    primary_keyword: string;
    seo_score: number;
    keyword_density: number;
    keyword_density_status: string;
    readability_score: number;
    readability_status: string;
    word_count: number;
    projected_search_volume: string;
    projected_reach: number;
    status: string;
    published_at: string | null;
    created_at: string;
}

interface ContentStatusAggregate {
    total_items: number;
    avg_seo_score: number;
    items_optimised: number;
    items_needs_work: number;
    total_projected_reach: number;
    top_keywords: { keyword: string; count: number }[];
}

interface ContentStatusResponse {
    items: ContentStatusItem[];
    aggregate: ContentStatusAggregate;
}

const KIND_META: Record<ContentStatusItem["kind"], { icon: typeof FileText; label: string; color: string }> = {
    post: { icon: FileText, label: "Post", color: "text-blue-500" },
    poster: { icon: ImageIcon, label: "Poster", color: "text-amber-500" },
    reel: { icon: Film, label: "Reel", color: "text-pink-500" },
};

function scoreColor(score: number): string {
    if (score >= 70) return "text-emerald-500";
    if (score >= 45) return "text-amber-500";
    return "text-red-500";
}

function scoreBg(score: number): string {
    if (score >= 70) return "bg-emerald-500";
    if (score >= 45) return "bg-amber-500";
    return "bg-red-500";
}

function formatReach(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
}

function timeAgo(iso: string) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function SEOPage() {
    const qc = useQueryClient();
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<"all" | "brief" | "draft">("all");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 9;
    const [kindFilter, setKindFilter] = useState<"all" | "post" | "poster" | "reel">("all");

    const { data: saves = [], isLoading: loadingSaves } = useQuery<SeoSaveItem[]>({
        queryKey: QUERY_KEYS.seoSaves,
        queryFn: async () => (await api.get<SeoSaveItem[]>("/api/seo/saves")).data,
        staleTime: 30 * 1000,
    });

    const { data: status, isLoading: loadingStatus } = useQuery<ContentStatusResponse>({
        queryKey: ["seo-content-status"],
        queryFn: async () => (await api.get<ContentStatusResponse>("/api/seo/content-status")).data,
        staleTime: 30 * 1000,
    });

    const confirmDelete = (id: string) => setConfirmId(id);

    const deleteSave = async () => {
        if (!confirmId) return;
        const id = confirmId;
        setConfirmId(null);
        await api.delete(`/api/seo/saves/${id}`).catch(() => {});
        qc.invalidateQueries({ queryKey: QUERY_KEYS.seoSaves });
    };

    const sorted = [...saves]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .filter((s) => typeFilter === "all" || s.type === typeFilter)
        .filter((s) => !search.trim() || s.title.toLowerCase().includes(search.trim().toLowerCase()));

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const goTo = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

    return (
        <div className="flex flex-col gap-10 mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">SEO Tools</h1>
                <p className="mt-2 text-muted-foreground">
                    Research, plan, and optimise your content for search engines.
                </p>
            </div>

            {/* Tool Cards */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {tools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                        <div
                            key={tool.href}
                            className={`relative flex flex-col gap-4 rounded-xl border bg-linear-to-br p-6 ${tool.accent}`}
                        >
                            <div className="flex gap-4 items-center">
                                <div
                                    className={`flex h-11 w-11 items-center justify-center rounded-lg bg-background/60 backdrop-blur ${tool.iconColor}`}
                                >
                                    <Icon className="h-5 w-5" />
                                </div>
                                <h2 className="text-lg font-semibold">{tool.title}</h2>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                {tool.description}
                            </p>
                            <div className="mt-auto pt-2">
                                <Link
                                    href={tool.href}
                                    className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors ${tool.ctaColor}`}
                                >
                                    {tool.cta}
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* SEO Status — per-item performance snapshot across all generated content */}
            <div>
                <div className="flex flex-col gap-1 mb-4">
                    <h2 className="text-xl font-semibold tracking-tight">Content SEO Status</h2>
                    <p className="text-sm text-muted-foreground">
                        Per-item SEO score, keyword density, readability, and projected search reach
                        across your generated posts, posters, and reels. Pre-publish projections —
                        switch to <Link href="/analytics" className="underline">Analytics</Link> for live traffic.
                    </p>
                </div>

                {loadingStatus ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        {[1, 2, 3, 4].map((n) => (
                            <div key={n} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
                        ))}
                    </div>
                ) : status && status.items.length > 0 ? (
                    <>
                        {/* Aggregate stat cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            <div className="rounded-lg border bg-card p-4">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Gauge className="h-3.5 w-3.5" /> Avg SEO Score
                                </div>
                                <div className={`mt-1 text-2xl font-bold ${scoreColor(status.aggregate.avg_seo_score)}`}>
                                    {status.aggregate.avg_seo_score}
                                    <span className="text-base font-normal text-muted-foreground">/100</span>
                                </div>
                            </div>
                            <div className="rounded-lg border bg-card p-4">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <FileText className="h-3.5 w-3.5" /> Generated Items
                                </div>
                                <div className="mt-1 text-2xl font-bold">{status.aggregate.total_items}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    <span className="text-emerald-500">{status.aggregate.items_optimised} ready</span>
                                    {" · "}
                                    <span className="text-red-500">{status.aggregate.items_needs_work} need work</span>
                                </div>
                            </div>
                            <div className="rounded-lg border bg-card p-4">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Eye className="h-3.5 w-3.5" /> Projected Reach
                                </div>
                                <div className="mt-1 text-2xl font-bold">
                                    {formatReach(status.aggregate.total_projected_reach)}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">est. monthly impressions</div>
                            </div>
                            <div className="rounded-lg border bg-card p-4">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <TrendingUp className="h-3.5 w-3.5" /> Top Keywords
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {status.aggregate.top_keywords.slice(0, 4).map((k) => (
                                        <span
                                            key={k.keyword}
                                            className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                                        >
                                            {k.keyword}
                                            <span className="ml-1 text-muted-foreground">×{k.count}</span>
                                        </span>
                                    ))}
                                    {status.aggregate.top_keywords.length === 0 && (
                                        <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Kind filter */}
                        <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5 w-fit mb-3">
                            {(["all", "post", "poster", "reel"] as const).map((k) => (
                                <button
                                    key={k}
                                    onClick={() => setKindFilter(k)}
                                    className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                                        kindFilter === k
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {k === "all" ? "All" : `${k}s`}
                                </button>
                            ))}
                        </div>

                        {/* Ranked list — best-scoring first */}
                        <div className="rounded-lg border bg-card overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b bg-muted/30 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                                <div className="col-span-5">Content</div>
                                <div className="col-span-2">Keyword</div>
                                <div className="col-span-1 text-center">Score</div>
                                <div className="col-span-1 text-center">KD</div>
                                <div className="col-span-1 text-center">Read</div>
                                <div className="col-span-2 text-right">Reach</div>
                            </div>

                            {status.items
                                .filter((it) => kindFilter === "all" || it.kind === kindFilter)
                                .map((it) => {
                                    const meta = KIND_META[it.kind];
                                    const Icon = meta.icon;
                                    return (
                                        <div
                                            key={`${it.kind}-${it.id}`}
                                            className="grid grid-cols-12 gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/20 transition-colors items-center text-sm"
                                        >
                                            <div className="col-span-5 flex items-center gap-2 min-w-0">
                                                <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                                                <div className="min-w-0">
                                                    <p className="font-medium truncate">{it.title}</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        {meta.label} · {it.word_count} words ·{" "}
                                                        <span className={it.status === "published" ? "text-emerald-500" : ""}>
                                                            {it.status}
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="col-span-2 truncate text-xs text-muted-foreground">
                                                {it.primary_keyword || <span className="italic">none</span>}
                                            </div>
                                            <div className="col-span-1 text-center">
                                                <div className="inline-flex flex-col items-center">
                                                    <span className={`font-bold ${scoreColor(it.seo_score)}`}>
                                                        {it.seo_score}
                                                    </span>
                                                    <div className="mt-0.5 h-1 w-10 rounded-full bg-muted overflow-hidden">
                                                        <div
                                                            className={`h-full ${scoreBg(it.seo_score)}`}
                                                            style={{ width: `${it.seo_score}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="col-span-1 text-center text-xs">
                                                <span className={
                                                    it.keyword_density_status === "optimal" ? "text-emerald-500" :
                                                    it.keyword_density_status === "missing" || it.keyword_density_status === "no_content" ? "text-red-500" :
                                                    "text-amber-500"
                                                }>
                                                    {it.keyword_density.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="col-span-1 text-center text-xs">
                                                <span className={scoreColor(it.readability_score)}>
                                                    {Math.round(it.readability_score)}
                                                </span>
                                            </div>
                                            <div className="col-span-2 text-right">
                                                <p className="text-xs font-medium">{formatReach(it.projected_reach)}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {it.projected_search_volume}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </>
                ) : (
                    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                        <Gauge className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                            No generated content yet. Generate a post, poster, or reel to see SEO insights here.
                        </p>
                    </div>
                )}
            </div>

            {/* Recent Saves */}
            <div>
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">Recent Saves</h2>
                        {!loadingSaves && saves.length > 0 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {sorted.length}/{saves.length}
                            </span>
                        )}
                    </div>

                    {!loadingSaves && saves.length > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Search saves…"
                                    value={search}
                                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                                    className="h-8 w-44 rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                            </div>
                            <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
                                {(["all", "brief", "draft"] as const).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => { setTypeFilter(t); setPage(1); }}
                                        className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                                            typeFilter === t
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t === "all" ? "All" : t === "brief" ? "Brief" : "Blog"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {loadingSaves ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((n) => (
                            <div key={n} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
                        ))}
                    </div>
                ) : sorted.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No saves yet — generate a brief or save an editor draft.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {paginated.map((item) => (
                            <div
                                key={item.id}
                                className="group relative flex flex-col gap-1.5 rounded-lg border bg-card p-4 hover:border-foreground/20 transition-colors"
                            >
                                <span
                                    className={`self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                        item.type === "brief"
                                            ? "border-violet-500/30 bg-violet-500/10 text-violet-500"
                                            : item.type === "draft"
                                            ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
                                            : "border-muted-foreground/30 bg-muted/30 text-muted-foreground"
                                    }`}
                                >
                                    {item.type === "brief" ? "Brief" : item.type === "draft" ? "Blog" : item.type}
                                </span>

                                <p className="text-sm font-medium line-clamp-2 pr-6">{item.title}</p>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex gap-2 items-center">
                                        <p className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</p>
                                        {item.data.score != null && (
                                            <span className={`text-xs font-semibold ${
                                                (item.data.score as number) >= 70 ? "text-emerald-500" :
                                                (item.data.score as number) >= 45 ? "text-amber-500" : "text-red-500"
                                            }`}>
                                                {item.data.score as number}/100
                                            </span>
                                        )}
                                    </span>
                                    <Link
                                        href={item.type === "brief" ? `/seo/brief?id=${item.id}` : `/seo/editor?draft=${item.id}`}
                                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        Open
                                    </Link>
                                </div>

                                <button
                                    onClick={() => confirmDelete(item.id)}
                                    className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all"
                                    aria-label="Delete"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {!loadingSaves && totalPages > 1 && (
                    <div className="mt-6">
                        <Pagination>
                            <PaginationContent>
                                <PaginationItem>
                                    <PaginationPrevious
                                        href="#"
                                        onClick={(e) => { e.preventDefault(); goTo(safePage - 1); }}
                                        aria-disabled={safePage === 1}
                                        className={safePage === 1 ? "pointer-events-none opacity-40" : ""}
                                    />
                                </PaginationItem>

                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                                    if (totalPages > 5 && p !== 1 && p !== totalPages && Math.abs(p - safePage) > 1) {
                                        if (p === 2 || p === totalPages - 1) {
                                            return (
                                                <PaginationItem key={p}>
                                                    <PaginationEllipsis />
                                                </PaginationItem>
                                            );
                                        }
                                        return null;
                                    }
                                    return (
                                        <PaginationItem key={p}>
                                            <PaginationLink
                                                href="#"
                                                isActive={p === safePage}
                                                onClick={(e) => { e.preventDefault(); goTo(p); }}
                                            >
                                                {p}
                                            </PaginationLink>
                                        </PaginationItem>
                                    );
                                })}

                                <PaginationItem>
                                    <PaginationNext
                                        href="#"
                                        onClick={(e) => { e.preventDefault(); goTo(safePage + 1); }}
                                        aria-disabled={safePage === totalPages}
                                        className={safePage === totalPages ? "pointer-events-none opacity-40" : ""}
                                    />
                                </PaginationItem>
                            </PaginationContent>
                        </Pagination>
                    </div>
                )}
            </div>

            {/* Confirm Delete Modal */}
            {confirmId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setConfirmId(null)}
                    />
                    <div className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
                        <h3 className="text-base font-semibold mb-2">Delete save?</h3>
                        <p className="text-sm text-muted-foreground mb-5">This action cannot be undone.</p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmId(null)}
                                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteSave}
                                className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
