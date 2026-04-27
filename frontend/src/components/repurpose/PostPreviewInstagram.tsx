"use client";

import { useEffect, useRef } from "react";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Copy,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  AlertTriangle,
  Instagram,
  Image as ImageIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  items: string[];
  index: number;
  onIndexChange: (i: number) => void;
  onEdit: (v: string) => void;
  onCopy: (v: string) => void;
  sourceUrl: string;

  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;

  handle?: string;
}

/**
 * Editable Instagram feed-card preview. Square image placeholder on top,
 * action row, likes, editable caption below.
 */
export function PostPreviewInstagram({
  items,
  index,
  onIndexChange,
  onEdit,
  onCopy,
  sourceUrl,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
  handle = "yourhandle",
}: Props) {
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const current = items[safeIndex] || "";
  const hasVariants = items.length > 1;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Instagram className="h-4 w-4 text-pink-500" />
          Instagram
          {hasVariants && (
            <Badge variant="outline" className="ml-1 font-mono text-[10px] border-purple-200">
              {safeIndex + 1}/{items.length}
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {hasVariants && (
            <>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onIndexChange(Math.max(0, safeIndex - 1))}
                disabled={safeIndex === 0}
                title="Previous angle"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onIndexChange(Math.min(items.length - 1, safeIndex + 1))}
                disabled={safeIndex >= items.length - 1}
                title="Next angle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2" onClick={() => onCopy(current)}>
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      </div>

      {/* Feed card mock */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden text-slate-900">
        {/* header */}
        <div className="flex items-center gap-3 p-3">
          <div className="relative shrink-0">
            <div className="p-[2px] rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
              <div className="h-8 w-8 rounded-full bg-white p-0.5">
                <div className="h-full w-full rounded-full bg-gradient-to-br from-fuchsia-500 to-rose-500" />
              </div>
            </div>
          </div>
          <p className="text-sm font-semibold truncate">{handle}</p>
          <MoreHorizontal className="ml-auto h-5 w-5 text-slate-400" />
        </div>

        {/* image placeholder */}
        <div className="relative aspect-video w-full bg-gradient-to-br from-fuchsia-100 via-rose-50 to-orange-100 flex items-center justify-center border-y">
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[11px] font-medium">Your image goes here</span>
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-3 px-3 pt-2">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
          <Bookmark className="ml-auto h-6 w-6" />
        </div>

        {/* likes */}
        <p className="px-3 pt-1 text-sm font-semibold">1,248 likes</p>

        {/* editable caption */}
        <EditableCaption
          handle={handle}
          value={current}
          onChange={onEdit}
          disabled={regenActive}
        />
      </div>

      <UrlFooter url={sourceUrl} present={current.includes(sourceUrl)} />

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

function EditableCaption({
  handle,
  value,
  onChange,
  disabled,
}: {
  handle: string;
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
    <div className="px-3 py-2 text-[13px] leading-relaxed">
      <span className="font-semibold mr-1.5">{handle}</span>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Your caption…"
        rows={1}
        className={cn(
          "align-top inline-block w-full resize-none bg-transparent leading-relaxed",
          "text-slate-900 whitespace-pre-wrap break-words outline-none",
          "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
          "placeholder:text-slate-400 disabled:opacity-60",
        )}
      />
      <p className="text-[11px] text-slate-400 mt-2">View all 34 comments · 2h</p>
    </div>
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
      className={`text-[10px] flex items-center gap-1 truncate ${
        present ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      {present ? "Backlink present →" : "Backlink missing →"}
      <span className="truncate">{url}</span>
    </div>
  );
}
