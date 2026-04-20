"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PenLine, Search, ArrowRight, Trash2, ExternalLink } from "lucide-react";
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

function timeAgo(iso: string) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function SEOPage() {
    const [saves, setSaves] = useState<SeoSaveItem[]>([]);
    const [loadingSaves, setLoadingSaves] = useState(true);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<"all" | "brief" | "draft">("all");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 6;

    useEffect(() => {
        api.get<SeoSaveItem[]>("/api/seo/saves")
            .then((res) => setSaves(res.data))
            .catch(() => {/* non-critical */ })
            .finally(() => setLoadingSaves(false));
    }, []);

    const confirmDelete = (id: string) => setConfirmId(id);

    const deleteSave = async () => {
        if (!confirmId) return;
        const id = confirmId;
        setConfirmId(null);
        setSaves((prev) => prev.filter((s) => s.id !== id));
        await api.delete(`/api/seo/saves/${id}`).catch(() => {/* non-critical */ });
    };

    // Sort newest first, then apply filters
    const sorted = [...saves]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
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
                            {/* Search */}
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
                            {/* Type filter */}
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
                                        {t === "all" ? "All" : t === "brief" ? "Brief" : "Draft"}
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
                                {/* Type badge */}
                                <span
                                    className={`self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${item.type === "brief"
                                        ? "border-violet-500/30 bg-violet-500/10 text-violet-500"
                                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                        }`}
                                >
                                    {item.type === "brief" ? "Brief" : "Draft"}
                                </span>

                                <p className="text-sm font-medium line-clamp-2 pr-6">{item.title}</p>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex gap-2 items-center">
                                        <p className="text-xs text-muted-foreground">{timeAgo(item.created_at)}</p>
                                        {item.data.score != null && (
                                            <span className={`text-xs font-semibold ${(item.data.score as number) >= 70 ? "text-emerald-500" :
                                                (item.data.score as number) >= 45 ? "text-amber-500" : "text-red-500"
                                                }`}>
                                                {item.data.score as number}/100
                                            </span>
                                        )}
                                    </span>
                                    <Link
                                        href={item.type === "brief" ? "/seo/brief" : `/seo/editor?draft=${item.id}`}
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

                {/* Pagination */}
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
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={() => setConfirmId(null)}
                    />
                    {/* Dialog */}
                    <div className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-base font-semibold">Delete save?</h3>
                            <p className="text-sm text-muted-foreground">
                                This save will be permanently deleted and cannot be recovered.
                            </p>
                        </div>
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
