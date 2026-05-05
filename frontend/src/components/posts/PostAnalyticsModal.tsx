"use client";

/**
 * Modal that fetches and displays normalized post analytics for any platform.
 *
 * Usage:
 *   <PostAnalyticsModal postId={post.id} open={open} onOpenChange={setOpen} />
 *
 * The backend route is GET /api/posts/{post_id}/analytics — it returns a
 * normalized shape so we can render the same metric grid for FB, IG, LinkedIn,
 * YouTube, Dev.to, and Reddit. Platform-unsupported fields render as "—".
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Eye, Heart, MessageCircle, Share2, MousePointerClick, Users } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

type Analytics = {
  post_id: string;
  platform: string;
  external_post_id: string;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  views: number | null;
  raw: Record<string, unknown>;
};

type Props = {
  postId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

const fmt = (n: number | null | undefined): string =>
  n == null ? "—" : new Intl.NumberFormat().format(n);

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  reddit: "Reddit",
  devto: "Dev.to",
};

export function PostAnalyticsModal({ postId, open, onOpenChange }: Props) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !postId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setData(null);

    api
      .get<Analytics>(`/api/posts/${postId}/analytics`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail || "Failed to load analytics";
        setError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, postId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post analytics</DialogTitle>
          <DialogDescription>
            {data
              ? `Live metrics from ${PLATFORM_LABEL[data.platform] || data.platform}`
              : "Live engagement metrics for this post."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {data && !loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat icon={<Eye className="h-4 w-4" />} label="Impressions" value={fmt(data.impressions)} />
            <Stat icon={<Users className="h-4 w-4" />} label="Reach" value={fmt(data.reach)} />
            <Stat icon={<Eye className="h-4 w-4" />} label="Views" value={fmt(data.views)} />
            <Stat icon={<Heart className="h-4 w-4" />} label="Likes" value={fmt(data.likes)} />
            <Stat icon={<MessageCircle className="h-4 w-4" />} label="Comments" value={fmt(data.comments)} />
            <Stat icon={<Share2 className="h-4 w-4" />} label="Shares" value={fmt(data.shares)} />
            <Stat icon={<MousePointerClick className="h-4 w-4" />} label="Clicks" value={fmt(data.clicks)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
