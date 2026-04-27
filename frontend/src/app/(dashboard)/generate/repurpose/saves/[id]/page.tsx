"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    ArrowLeft,
    Recycle,
    Trash2,
    Link as LinkIcon,
    AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { HookVariationsCard } from "@/components/repurpose/HookVariationsCard";
import { PostPreviewLinkedIn } from "@/components/repurpose/PostPreviewLinkedIn";
import { PostPreviewTwitter } from "@/components/repurpose/PostPreviewTwitter";
import { PostPreviewEmail } from "@/components/repurpose/PostPreviewEmail";
import { PostPreviewYouTube } from "@/components/repurpose/PostPreviewYouTube";
import { PostPreviewInstagram } from "@/components/repurpose/PostPreviewInstagram";
import { PostPreviewFacebook } from "@/components/repurpose/PostPreviewFacebook";
import { PostPreviewQuotes } from "@/components/repurpose/PostPreviewQuotes";
import { PostPreviewCarousel } from "@/components/repurpose/PostPreviewCarousel";

import api from "@/lib/api";
import type { RepurposeResponse } from "@/types";

const noop = () => {};
const noop2 = (_i: number, _v: string) => {};

export default function RepurposeSaveDetailPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const saveId = params?.id;

    const [data, setData] = useState<RepurposeResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const [liIndex, setLiIndex] = useState(0);
    const [igIndex, setIgIndex] = useState(0);
    const [fbIndex, setFbIndex] = useState(0);

    useEffect(() => {
        if (!saveId) return;
        let cancelled = false;
        setLoading(true);
        api
            .get<RepurposeResponse>(`/api/repurpose/saves/${saveId}`)
            .then((res) => {
                if (!cancelled) setData(res.data);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const e = err as { response?: { status?: number } };
                setError(
                    e.response?.status === 404
                        ? "This save no longer exists."
                        : "Failed to load save.",
                );
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [saveId]);

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copied!`);
    };

    const handleDelete = async () => {
        if (!saveId) return;
        setConfirmDelete(false);
        try {
            await api.delete(`/api/repurpose/saves/${saveId}`);
            toast.success("Save deleted");
            router.push("/generate/repurpose");
        } catch {
            toast.error("Failed to delete");
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                {/* Meta bar skeleton */}
                <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-6 w-32" />
                </div>

                {/* Hook variations skeleton */}
                <Card className="border-purple-100 shadow-sm">
                    <CardHeader className="pb-2">
                        <Skeleton className="h-5 w-48 mb-2" />
                        <Skeleton className="h-4 w-64" />
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="flex gap-3 items-start border-b border-purple-50 pb-4 last:border-0">
                                <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-[90%]" />
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Grid skeleton */}
                <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="break-inside-avoid">
                            <Card className="border-purple-100 shadow-sm overflow-hidden">
                                <CardHeader className="p-4 pb-2 flex-row items-center gap-3">
                                    <Skeleton className="h-8 w-8 rounded-full" />
                                    <div className="space-y-1">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-3 w-16" />
                                    </div>
                                </CardHeader>
                                <CardContent className="p-4 pt-2 space-y-2">
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-[80%]" />
                                    <Skeleton className="h-40 w-full rounded-md mt-2" />
                                </CardContent>
                            </Card>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="space-y-4 max-w-xl">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push("/generate/repurpose")}
                    className="gap-1.5"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to repurpose hub
                </Button>
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{error ?? "Save not found."}</AlertDescription>
                </Alert>
            </div>
        );
    }

    const { formats, platforms } = data;
    const platformSet = new Set(platforms);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push("/generate/repurpose")}
                        className="gap-1.5 -ml-2 h-8 text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to hub
                    </Button>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Recycle className="h-6 w-6 text-violet-500" />
                        Saved Repurpose
                    </h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 border-transparent">
                            Voice: {data.voice.replace("_", " ")}
                        </Badge>
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 border-transparent">
                            Goal: {data.goal}
                        </Badge>
                        {data.keywords_used.slice(0, 3).map((k) => (
                            <Badge
                                key={k}
                                variant="outline"
                                className="border-violet-200 text-violet-700"
                            >
                                {k}
                            </Badge>
                        ))}
                    </div>
                    {data.source_url && (
                        <a
                            href={data.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <LinkIcon className="h-3 w-3" />
                            <span className="truncate max-w-md">{data.source_url}</span>
                        </a>
                    )}
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                    <Trash2 className="h-4 w-4" />
                    Delete
                </Button>
            </div>

            {/* Hook variations */}
            {formats.hook_variations.length > 0 && (
                <HookVariationsCard hooks={formats.hook_variations} />
            )}

            {/* Platform preview cards */}
            <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
                {platformSet.has("linkedin") && formats.linkedin_posts.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewLinkedIn
                                    items={formats.linkedin_posts}
                                    index={liIndex}
                                    onIndexChange={setLiIndex}
                                    onEdit={noop}
                                    onCopy={(v) => copy(v, "LinkedIn post")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("twitter") && formats.twitter_thread.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewTwitter
                                    tweets={formats.twitter_thread}
                                    onItemEdit={noop2}
                                    onCopyAll={() => copy(formats.twitter_thread.join("\n\n"), "Twitter thread")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("email") && (formats.email.subject || formats.email.body) && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewEmail
                                    email={formats.email}
                                    sourceUrl={data.source_url}
                                    onSubjectEdit={noop}
                                    onBodyEdit={noop}
                                    onCopy={copy}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("youtube") && !!formats.youtube_description && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewYouTube
                                    description={formats.youtube_description}
                                    onEdit={noop}
                                    onCopy={(v) => copy(v, "YouTube description")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("instagram") && formats.instagram_captions.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewInstagram
                                    items={formats.instagram_captions}
                                    index={igIndex}
                                    onIndexChange={setIgIndex}
                                    onEdit={noop}
                                    onCopy={(v) => copy(v, "Instagram caption")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("facebook") && formats.facebook_posts.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewFacebook
                                    items={formats.facebook_posts}
                                    index={fbIndex}
                                    onIndexChange={setFbIndex}
                                    onEdit={noop}
                                    onCopy={(v) => copy(v, "Facebook post")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("quotes") && formats.quote_cards.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewQuotes
                                    items={formats.quote_cards}
                                    onItemEdit={noop2}
                                    onCopyAll={() => copy(formats.quote_cards.join("\n\n"), "Quote cards")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}

                {platformSet.has("carousel") && formats.carousel_outline.length > 0 && (
                    <div className="break-inside-avoid mb-4">
                        <Card className="border-purple-200 py-0 shadow-sm">
                            <CardContent className="p-3">
                                <PostPreviewCarousel
                                    items={formats.carousel_outline}
                                    onItemEdit={noop2}
                                    onCopyAll={() => copy(formats.carousel_outline.join("\n"), "Carousel outline")}
                                    sourceUrl={data.source_url}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            {/* Confirm delete modal */}
            {confirmDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setConfirmDelete(false)}
                    />
                    <div className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
                        <h3 className="text-base font-semibold mb-2">Delete save?</h3>
                        <p className="text-sm text-muted-foreground mb-5">
                            This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmDelete(false)}
                                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
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
