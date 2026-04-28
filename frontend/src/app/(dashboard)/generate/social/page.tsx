"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    Sparkles,
    Search,
    ArrowRight,
    Trash2,
    ExternalLink,
    Image as ImageIcon,
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

const PAGE_SIZE = 9;

interface PostSaveItem {
    id: string;
    content: string;
    hashtags: string;
    image_url: string | null;
    image_option: string;
    platform: string;
    tone: string;
    status: string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

const tools = [
    {
        href: "/generate/social/new",
        icon: Sparkles,
        title: "Generate Social Post",
        description:
            "Create platform-native posts for Facebook, Instagram, LinkedIn and more — voice-matched, SEO-aware, and ready to publish or schedule.",
        cta: "Start Generating",
        accent: "from-purple-500/10 to-purple-500/5 border-purple-500/20",
        iconColor: "text-purple-500",
        ctaColor: "bg-purple-500 hover:bg-purple-600",
    },
];

const PLATFORM_COLORS: Record<string, string> = {
    facebook: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    instagram: "bg-pink-500/10 text-pink-600 border-pink-500/20",
    linkedin: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    twitter: "bg-slate-500/10 text-slate-600 border-slate-500/20",
    threads: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
};

const STATUS_COLORS: Record<string, string> = {
    draft: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    published: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    scheduled: "bg-violet-500/10 text-violet-600 border-violet-500/20",
};

function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function SocialHubPage() {
    const [saves, setSaves] = useState<PostSaveItem[]>([]);
    const [loadingSaves, setLoadingSaves] = useState(true);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    useEffect(() => {
        api
            .get<PostSaveItem[]>("/api/posts")
            .then((res) => setSaves(res.data || []))
            .catch(() => {
                /* non-critical */
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
            await api.delete(`/api/posts/${id}`);
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
                    s.content.toLowerCase().includes(q) ||
                    s.platform.toLowerCase().includes(q) ||
                    s.hashtags.toLowerCase().includes(q),
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
                <h1 className="text-3xl font-bold tracking-tight">Social Posts</h1>
                <p className="mt-2 text-muted-foreground">
                    Generate, edit, and publish platform-native social media posts in your brand voice.
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
                        <h2 className="text-sm font-semibold">Recent Posts</h2>
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
                                placeholder="Search posts…"
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
                        No posts yet — generate your first one above.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {paginated.map((item) => {
                            const platformClass =
                                PLATFORM_COLORS[item.platform.toLowerCase()] ||
                                "bg-muted text-muted-foreground border-border";
                            const statusClass =
                                STATUS_COLORS[item.status.toLowerCase()] ||
                                "bg-muted text-muted-foreground border-border";
                            return (
                                <div
                                    key={item.id}
                                    className="group relative flex flex-col gap-2 rounded-lg border bg-card p-4 hover:border-foreground/20 transition-colors"
                                >
                                    <div className="flex items-center gap-1.5 flex-wrap pr-6">
                                        <span
                                            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium border capitalize ${platformClass}`}
                                        >
                                            {item.platform}
                                        </span>
                                        <span
                                            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium border capitalize ${statusClass}`}
                                        >
                                            {item.status}
                                        </span>
                                        {item.image_url && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                <ImageIcon className="h-2.5 w-2.5" />
                                                image
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-sm line-clamp-3 pr-6 leading-relaxed">
                                        {item.content}
                                    </p>

                                    <div className="flex items-center justify-between gap-2 mt-auto">
                                        <p className="text-xs text-muted-foreground">
                                            {timeAgo(item.updated_at)}
                                        </p>
                                        <Link
                                            href={`/generate/social/new?id=${item.id}`}
                                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
                            );
                        })}
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
                        <h3 className="text-base font-semibold mb-2">Delete post?</h3>
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
