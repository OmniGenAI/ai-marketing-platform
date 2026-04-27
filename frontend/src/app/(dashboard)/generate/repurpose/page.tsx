"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    Recycle,
    Search,
    ArrowRight,
    Trash2,
    ExternalLink,
    Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import type { RepurposeSaveItem } from "@/types";

const PAGE_SIZE = 9;

const tools = [
    {
        href: "/generate/repurpose/new",
        icon: Recycle,
        title: "Repurpose Content",
        description:
            "Paste or pick a saved blog and get LinkedIn posts, Twitter threads, Instagram captions, email newsletters, YouTube descriptions, and more — all voice-matched and on-brand.",
        cta: "Start Repurposing",
        accent: "from-violet-500/10 to-violet-500/5 border-violet-500/20",
        iconColor: "text-violet-500",
        ctaColor: "bg-violet-500 hover:bg-violet-600",
    },
];

function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function RepurposeHubPage() {
    const [saves, setSaves] = useState<RepurposeSaveItem[]>([]);
    const [loadingSaves, setLoadingSaves] = useState(true);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    useEffect(() => {
        api
            .get<RepurposeSaveItem[]>("/api/repurpose/saves")
            .then((res) => setSaves(res.data || []))
            .catch(() => {
                /* non-critical — list is just empty */
            })
            .finally(() => setLoadingSaves(false));
    }, []);

    const confirmDelete = (id: string) => setConfirmId(id);

    const deleteSave = async () => {
        if (!confirmId) return;
        const id = confirmId;
        setConfirmId(null);
        const snapshot = saves;
        setSaves((prev) => prev.filter((s) => s.id !== id));
        try {
            await api.delete(`/api/repurpose/saves/${id}`);
        } catch {
            setSaves(snapshot);
            toast.error("Failed to delete — please try again");
        }
    };

    const sorted = useMemo(() => {
        const q = search.trim().toLowerCase();
        return [...saves]
            .sort(
                (a, b) =>
                    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
            )
            .filter(
                (s) =>
                    !q ||
                    s.title.toLowerCase().includes(q) ||
                    (s.primary_keyword ?? "").toLowerCase().includes(q) ||
                    (s.source_url ?? "").toLowerCase().includes(q),
            );
    }, [saves, search]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const goTo = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

    return (
        <div className="flex flex-col mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Content Repurposing</h1>
                <p className="mt-2 text-muted-foreground">
                    Turn one blog into platform-native content with your voice, goal, and hook of choice.
                </p>
            </div>

            {/* Tool Cards */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 my-3">
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
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search saves…"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                                className="h-8 w-44 rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                    )}
                </div>

                {loadingSaves ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3].map((n) => (
                            <div
                                key={n}
                                className="h-24 rounded-lg border bg-muted/30 animate-pulse"
                            />
                        ))}
                    </div>
                ) : sorted.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No saves yet — repurpose your first piece of content above.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {paginated.map((item) => (
                            <div
                                key={item.id}
                                className="group relative flex flex-col gap-1.5 rounded-lg border bg-card p-4 hover:border-foreground/20 transition-colors"
                            >
                                {item.primary_keyword && (
                                    <span className="inline-flex w-fit rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 border border-violet-500/20 truncate max-w-[140px]">
                                        {item.primary_keyword}
                                    </span>
                                )}
                                <p className="text-sm font-medium line-clamp-2 pr-6">{item.title}</p>

                                <div className="flex items-center justify-between gap-2">

                                    <p className="text-xs text-muted-foreground">
                                        {timeAgo(item.updated_at)}
                                    </p>

                                    <Link
                                        href={`/generate/repurpose/saves/${item.id}`}
                                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        Open
                                    </Link>
                                </div>

                                {item.source_url && (
                                    <a
                                        href={item.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors truncate"
                                    >
                                        <LinkIcon className="h-2.5 w-2.5 shrink-0" />
                                        <span className="truncate">{item.source_url}</span>
                                    </a>
                                )}

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
                                        onClick={(e) => {
                                            e.preventDefault();
                                            goTo(safePage - 1);
                                        }}
                                        aria-disabled={safePage === 1}
                                        className={
                                            safePage === 1 ? "pointer-events-none opacity-40" : ""
                                        }
                                    />
                                </PaginationItem>

                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                                    if (
                                        totalPages > 5 &&
                                        p !== 1 &&
                                        p !== totalPages &&
                                        Math.abs(p - safePage) > 1
                                    ) {
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
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    goTo(p);
                                                }}
                                            >
                                                {p}
                                            </PaginationLink>
                                        </PaginationItem>
                                    );
                                })}

                                <PaginationItem>
                                    <PaginationNext
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            goTo(safePage + 1);
                                        }}
                                        aria-disabled={safePage === totalPages}
                                        className={
                                            safePage === totalPages
                                                ? "pointer-events-none opacity-40"
                                                : ""
                                        }
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
                        <p className="text-sm text-muted-foreground mb-5">
                            This action cannot be undone.
                        </p>
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
