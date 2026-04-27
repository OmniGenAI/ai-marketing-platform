"use client";

import { useEffect, useRef } from "react";
import {
  Youtube,
  Play,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Download,
  BellRing,
  Copy,
  Link as LinkIcon,
  AlertTriangle,
  MoreHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  description: string;
  onEdit: (v: string) => void;
  onCopy: (v: string) => void;
  sourceUrl: string;

  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;

  channelName?: string;
  title?: string;
}

/**
 * Editable YouTube description preview. Player placeholder, title, channel row,
 * then an editable description block with YouTube-style hashtag/URL coloring.
 */
export function PostPreviewYouTube({
  description,
  onEdit,
  onCopy,
  sourceUrl,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
  channelName = "Your Channel",
  title = "Your video title",
}: Props) {
  const initials =
    channelName
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "YC";

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Youtube className="h-4 w-4 text-red-600" />
          YouTube Description
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1 h-7 px-2"
          onClick={() => onCopy(description)}
        >
          <Copy className="h-3 w-3" />
          Copy
        </Button>
      </div>

      {/* Player + meta + description mock */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden text-slate-900">
        {/* Player placeholder */}
        <div className="relative aspect-video w-full bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center">
          <Play className="h-6 w-6 text-white ml-0.5" fill="white" />
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-mono text-white tabular-nums">
            12:34
          </div>
        </div>

        {/* Title */}
        <div className="px-4 pt-3">
          <p className="text-[15px] font-semibold leading-snug line-clamp-2">{title}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            82,438 views · 3 days ago
          </p>
        </div>

        {/* Channel + actions */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-t mt-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold truncate">{channelName}</p>
            <p className="text-[11px] text-slate-500">42.1K subscribers</p>
          </div>
          <button
            type="button"
            className="shrink-0 flex items-center gap-1 rounded-full bg-slate-900 text-white px-3 py-1 text-xs font-semibold hover:bg-slate-700"
            tabIndex={-1}
          >
            <BellRing className="h-3.5 w-3.5" />
            Subscribed
          </button>
        </div>

        {/* Engagement row */}
        <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
          <div className="flex items-center rounded-full bg-slate-100">
            <button className="flex items-center gap-1 px-3 py-1 text-xs hover:bg-slate-200 rounded-l-full" tabIndex={-1}>
              <ThumbsUp className="h-4 w-4" /> 2.1K
            </button>
            <span className="w-px h-4 bg-slate-300" />
            <button className="px-3 py-1 hover:bg-slate-200 rounded-r-full" tabIndex={-1}>
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
          <button className="flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1 text-xs" tabIndex={-1}>
            <Share2 className="h-4 w-4" /> Share
          </button>
          <button className="flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-3 py-1 text-xs" tabIndex={-1}>
            <Download className="h-4 w-4" /> Download
          </button>
          <button className="rounded-full bg-slate-100 hover:bg-slate-200 p-1.5" tabIndex={-1}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        {/* Editable description block */}
        <div className="mx-4 mb-4 rounded-lg bg-slate-100 p-3">
          <p className="text-[11px] font-semibold text-slate-700 mb-1">
            Description
          </p>
          <EditableDescription
            value={description}
            onChange={onEdit}
            disabled={regenActive}
          />
        </div>
      </div>

      <UrlFooter url={sourceUrl} present={description.includes(sourceUrl)} />

      {onRegenerate && (
        <RewriteControls
          onFreshRegen={() => onRegenerate(null)}
          onPreset={(p) => onRegenerate(p)}
          disabled={disableRegen}
          isRunning={regenActive}
          runningPreset={regenPreset}
          freeRerollsRemaining={freeRerollsRemaining}
        />
      )}
    </div>
  );
}

function EditableDescription({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Your description, timestamps, links, and hashtags…"
      rows={1}
      className={cn(
        "w-full resize-none bg-transparent text-[13px] leading-relaxed font-mono",
        "text-slate-900 whitespace-pre-wrap break-words outline-none",
        "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
        "placeholder:text-slate-400 disabled:opacity-60",
      )}
    />
  );
}

function UrlFooter({ url, present }: { url: string; present: boolean }) {
  if (!url) {
    return (
      <p className="text-[10px] text-amber-600 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        No source URL configured
      </p>
    );
  }
  return (
    <div
      className={`text-[10px] flex items-center gap-1 truncate ${present ? "text-emerald-600" : "text-amber-600"
        }`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      {present ? "Backlink present →" : "Backlink missing →"}
      <span className="truncate">{url}</span>
    </div>
  );
}
