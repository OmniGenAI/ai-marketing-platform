"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export interface DownloadButtonProps {
  /** Ref pointing at the rendered <PosterPreview /> outer frame. */
  targetRef: React.RefObject<HTMLDivElement | null>;
  /** Used to build the downloaded filename. */
  title: string;
  /**
   * Optional callback fired AFTER a successful download — the page uses this
   * to PATCH `status=exported` on the backend so the hub can show a badge.
   */
  onDownloaded?: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}

/**
 * Captures the referenced node to a PNG and triggers a browser download.
 *
 * Render scale is fixed at 2× so the exported image is sharp on retina
 * displays. We use `cacheBust: true` because the AI background image lives
 * on Supabase Storage with cache headers — without bust we sometimes get a
 * stale CDN copy that fails CORS during canvas paint.
 */
export function DownloadButton({
  targetRef,
  title,
  onDownloaded,
  className,
  disabled,
}: DownloadButtonProps) {
  const [busy, setBusy] = React.useState(false);

  const handleDownload = async () => {
    if (!targetRef.current) {
      toast.error("Preview not ready yet — try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await toPng(targetRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = buildFilename(title);
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Poster downloaded");
      await onDownloaded?.();
    } catch (err) {
      console.error("[poster] download failed:", err);
      toast.error(
        "Couldn't export the poster. If you used a custom background image, please try regenerating it.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handleDownload}
      disabled={busy || disabled}
      className={className}
    >
      {busy ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Exporting…
        </>
      ) : (
        <>
          <Download className="mr-2 h-4 w-4" />
          Download PNG
        </>
      )}
    </Button>
  );
}

function buildFilename(title: string): string {
  const slug =
    (title || "poster")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "poster";
  const stamp = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  return `${slug}-${stamp}.png`;
}
