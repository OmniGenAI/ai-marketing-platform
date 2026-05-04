"use client";

/**
 * Modal that publishes a saved blog draft to Dev.to.
 *
 * Pre-flight checks the user's Dev.to connection via /api/social/providers
 * before showing the publish form — if they aren't connected, points them to
 * Settings instead of letting the publish call fail server-side.
 *
 * Form fields are pre-filled from the existing blog save:
 *   - title  → save.title
 *   - tags   → save.data.tags  (or derived from primary_keyword)
 * Users can override per-publish without mutating the underlying save.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import Link from "next/link";

type Props = {
  /** seo_save id of the blog to publish. Null while dialog is closed. */
  saveId: string | null;
  defaultTitle?: string;
  defaultTags?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: (result: PublishedInfo) => void;
};

type PublishedInfo = {
  platform: string;
  external_post_id: string;
  url: string;
};

type ProviderStatus = {
  platform: string;
  configured: boolean;
  connected: boolean;
  page_name: string | null;
};

export function PublishToDevToDialog({
  saveId,
  defaultTitle = "",
  defaultTags = [],
  open,
  onOpenChange,
  onPublished,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [tagsInput, setTagsInput] = useState(defaultTags.join(", "));
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);
  // Connection status — null = still loading, true/false once we know.
  const [connected, setConnected] = useState<boolean | null>(null);
  const [result, setResult] = useState<PublishedInfo | null>(null);

  // Reset form whenever the dialog opens for a new save.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setTagsInput(defaultTags.join(", "));
    setCanonicalUrl("");
    setPublishNow(true);
    setResult(null);
    setConnected(null);

    // Probe Dev.to connection once on open so we don't surprise the user.
    api
      .get<ProviderStatus[]>("/api/social/providers")
      .then((res) => {
        const devto = res.data.find((p) => p.platform === "devto");
        setConnected(Boolean(devto?.connected));
      })
      .catch(() => setConnected(false));
  }, [open, defaultTitle, defaultTags]);

  const submit = async () => {
    if (!saveId) return;
    setBusy(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await api.post<{
        platform: string;
        external_post_id: string;
        url: string;
        save_id: string;
      }>(`/api/blog/saves/${saveId}/publish/devto`, {
        title: title.trim() || undefined,
        tags: tags.length ? tags : undefined,
        canonical_url: canonicalUrl.trim() || undefined,
        publish: publishNow,
      });

      const info: PublishedInfo = {
        platform: res.data.platform,
        external_post_id: res.data.external_post_id,
        url: res.data.url,
      };
      setResult(info);
      toast.success(
        publishNow ? "Published to Dev.to!" : "Saved as Dev.to draft"
      );
      onPublished?.(info);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Publish failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to Dev.to</DialogTitle>
          <DialogDescription>
            Cross-post this blog to your Dev.to account. Engagement metrics
            will appear in the Analytics tab.
          </DialogDescription>
        </DialogHeader>

        {connected === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking Dev.to connection…
          </div>
        ) : connected === false ? (
          <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-50/50 p-4 text-sm dark:bg-amber-500/10">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-medium">Dev.to is not connected</p>
                <p className="text-muted-foreground">
                  Paste your Dev.to API key in Settings before publishing.
                </p>
              </div>
            </div>
            <Link
              href="/settings"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open Settings
            </Link>
          </div>
        ) : result ? (
          <div className="space-y-3 rounded-md border border-emerald-300/60 bg-emerald-50/50 p-4 text-sm dark:bg-emerald-500/10">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="space-y-1">
                <p className="font-medium">
                  {publishNow ? "Published successfully!" : "Saved as draft on Dev.to"}
                </p>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {result.url}
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="devto-title">Title</Label>
              <Input
                id="devto-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title (max 128 chars)"
                maxLength={128}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="devto-tags">
                Tags <span className="text-xs text-muted-foreground">(comma-separated, max 4)</span>
              </Label>
              <Input
                id="devto-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="webdev, javascript, tutorial"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Dev.to only accepts alphanumeric tags — special characters get stripped.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="devto-canonical">
                Canonical URL <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="devto-canonical"
                value={canonicalUrl}
                onChange={(e) => setCanonicalUrl(e.target.value)}
                placeholder="https://yourblog.com/original-post"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Set if this is a republish — tells Google your blog is the original.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(e) => setPublishNow(e.target.checked)}
                disabled={busy}
                className="rounded"
              />
              Publish immediately (uncheck to save as draft on Dev.to)
            </label>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : connected ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !title.trim()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {publishNow ? "Publish" : "Save Draft"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
