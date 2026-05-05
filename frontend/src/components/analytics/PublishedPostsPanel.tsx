"use client";

/**
 * Published Posts panel for the Analytics page.
 *
 * Renders aggregated engagement metrics across every platform a user has
 * published to. Calls GET /api/posts/published-summary which returns one
 * row per published post with live metrics fetched in parallel server-side.
 *
 * - Header shows totals (sum across all rows)
 * - Each row is clickable → opens PostAnalyticsModal for raw + per-platform detail
 * - Rows whose metrics couldn't be fetched display the per-row `error` inline
 * - Refresh button re-runs the fetch (analytics are slightly stale; force refetch on demand)
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 10;
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MousePointerClick,
  Users,
  RefreshCw,
  AlertTriangle,
  Inbox,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  Code2,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import api from "@/lib/api";
import { toast } from "sonner";
import { PostAnalyticsModal } from "@/components/posts/PostAnalyticsModal";

type PublishedPost = {
  post_id: string;
  platform: string;
  external_post_id: string;
  content_preview: string;
  image_url: string | null;
  published_at: string | null;
  // "post" or "blog" — drives the kind badge and click target.
  kind?: "post" | "blog";
  url?: string | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  views: number | null;
  error: string | null;
};

type SummaryResponse = {
  posts: PublishedPost[];
  totals: {
    posts?: number;
    blogs?: number;
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    clicks?: number;
    views?: number;
  };
};

const PLATFORM_META: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  facebook: { label: "Facebook", icon: <Facebook className="h-3.5 w-3.5" />, color: "#1877F2" },
  instagram: { label: "Instagram", icon: <Instagram className="h-3.5 w-3.5" />, color: "#E4405F" },
  linkedin: { label: "LinkedIn", icon: <Linkedin className="h-3.5 w-3.5" />, color: "#0A66C2" },
  youtube: { label: "YouTube", icon: <Youtube className="h-3.5 w-3.5" />, color: "#FF0000" },
  devto: { label: "Dev.to", icon: <Code2 className="h-3.5 w-3.5" />, color: "#0A0A0A" },
  reddit: { label: "Reddit", icon: <MessageSquare className="h-3.5 w-3.5" />, color: "#FF4500" },
};

const fmt = (n: number | null | undefined): string =>
  n == null ? "—" : new Intl.NumberFormat().format(n);

export function PublishedPostsPanel() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterSearch, setFilterSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SummaryResponse>("/api/posts/published-summary");
      setData(res.data);
      setPage(1);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Failed to load published posts";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const posts = data?.posts ?? [];
  const totals = data?.totals ?? {};

  // Derive available platforms from loaded data — must be before early returns
  const availablePlatforms = useMemo(
    () => Array.from(new Set(posts.map((p) => p.platform))).sort(),
    [posts]
  );

  const filteredPosts = useMemo(() => {
    let result = posts;
    if (filterPlatform !== "all")
      result = result.filter((p) => p.platform === filterPlatform);
    if (filterKind !== "all")
      result = result.filter((p) => (p.kind ?? "post") === filterKind);
    if (filterSearch.trim())
      result = result.filter((p) =>
        p.content_preview.toLowerCase().includes(filterSearch.toLowerCase())
      );
    return result;
  }, [posts, filterPlatform, filterKind, filterSearch]);

  const totalPages = Math.ceil(filteredPosts.length / PAGE_SIZE);
  const pagedPosts = filteredPosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openDetail = (row: PublishedPost) => {
    // Detail modal hits /api/posts/{id}/analytics which only handles social
    // posts. Blog rows already show every available metric inline plus an
    // "Open ↗" link to the article, so don't open the modal for them.
    if (row.kind === "blog") {
      if (row.url) window.open(row.url, "_blank", "noopener");
      return;
    }
    setSelectedPostId(row.post_id);
    setModalOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={load} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (posts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Inbox className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No published posts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Once you publish a post to a connected platform, its analytics
              will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregated totals across all platforms.
          `Posts` and `Blogs` are split because the engagement model differs:
          social posts have impressions/reach, blogs lean on views/comments. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <TotalCard icon={<Inbox className="h-4 w-4" />} label="Posts" value={fmt(totals.posts)} />
        <TotalCard icon={<Code2 className="h-4 w-4" />} label="Blogs" value={fmt(totals.blogs)} />
        <TotalCard icon={<Eye className="h-4 w-4" />} label="Impressions" value={fmt(totals.impressions)} />
        <TotalCard icon={<Users className="h-4 w-4" />} label="Reach" value={fmt(totals.reach)} />
        <TotalCard icon={<Eye className="h-4 w-4" />} label="Views" value={fmt(totals.views)} />
        <TotalCard icon={<Heart className="h-4 w-4" />} label="Likes" value={fmt(totals.likes)} />
        <TotalCard icon={<MessageCircle className="h-4 w-4" />} label="Comments" value={fmt(totals.comments)} />
        <TotalCard icon={<Share2 className="h-4 w-4" />} label="Shares" value={fmt(totals.shares)} />
      </div>

      {/* Post-by-post table */}
      <Card className="gap-0 p-0">
        <CardHeader className="space-y-3 py-3">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Post engagement</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-40">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search posts…"
                  value={filterSearch}
                  onChange={(e) => { setFilterSearch(e.target.value); setPage(1); }}
                  className="h-9 pl-8 pr-6 text-sm"
                />
                {filterSearch && (
                  <button
                    onClick={() => { setFilterSearch(""); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Select value={filterPlatform} onValueChange={(v) => { setFilterPlatform(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  {availablePlatforms.map((pl) => (
                    <SelectItem key={pl} value={pl}>
                      {PLATFORM_META[pl]?.label ?? pl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterKind} onValueChange={(v) => { setFilterKind(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-28 text-sm">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="post">Posts</SelectItem>
                  <SelectItem value="blog">Blogs</SelectItem>
                  <SelectItem value="reel">Reels</SelectItem>
                </SelectContent>
              </Select>
              {(filterPlatform !== "all" || filterKind !== "all" || filterSearch) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground"
                  onClick={() => { setFilterPlatform("all"); setFilterKind("all"); setFilterSearch(""); setPage(1); }}
                >
                  <X className="mr-1 h-3 w-3" /> Clear
                </Button>
              )}
              <Button onClick={load} size="sm" variant="ghost">
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </div>
          
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-sky-50/50 border-y">
                <TableRow>
                  <TableHead className="w-[40%]">Post</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-center">Impr.</TableHead>
                  <TableHead className="text-center">Reach</TableHead>
                  <TableHead className="text-center">Likes</TableHead>
                  <TableHead className="text-center">Comments</TableHead>
                  <TableHead className="text-center">Shares</TableHead>
                  <TableHead className="text-center">Clicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedPosts.map((p) => {
                  const meta = PLATFORM_META[p.platform];
                  const isBlog = p.kind === "blog";
                  return (
                    <TableRow
                      key={`${p.kind ?? "post"}-${p.post_id}-${p.platform}`}
                      onClick={() => openDetail(p)}
                      className="cursor-pointer"
                    >
                      <TableCell className="max-w-0">
                        <div className="flex items-center gap-2">
                          {p.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.image_url}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className="h-4 px-1.5 text-[9px] uppercase"
                              >
                                {isBlog ? "Blog" : "Post"}
                              </Badge>
                              <p className="truncate text-sm">
                                {p.content_preview || "(no caption)"}
                              </p>
                            </div>
                            {p.error && (
                              <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-amber-600">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {p.error}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              {p.published_at && (
                                <p className="text-[11px] text-muted-foreground">
                                  {new Date(p.published_at).toLocaleDateString()}
                                </p>
                              )}
                              {p.url && (
                                <a
                                  href={p.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] text-primary hover:underline"
                                >
                                  Open ↗
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="gap-1 px-1.5"
                          style={{ borderColor: meta?.color, color: meta?.color }}
                        >
                          {meta?.icon}
                          <span className="text-xs">{meta?.label || p.platform}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.impressions)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.reach)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.likes)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.comments)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.shares)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {fmt(p.clicks)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, posts.length)} of {posts.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  ← Prev
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                  <Button
                    key={pg}
                    variant={pg === page ? "default" : "outline"}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(pg)}
                  >
                    {pg}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PostAnalyticsModal
        postId={selectedPostId}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}

function TotalCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="py-3">
      <CardContent className="px-3 py-0">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
