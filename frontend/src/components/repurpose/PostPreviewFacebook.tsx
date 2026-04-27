"use client";

import { useEffect, useRef } from "react";
import {
  ThumbsUp,
  MessageCircle,
  Share2,
  Globe2,
  MoreHorizontal,
  Copy,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  AlertTriangle,
  Facebook,
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

  pageName?: string;
}

/**
 * Editable Facebook feed post preview. Page header, editable content,
 * Like/Comment/Share action row.
 */
export function PostPreviewFacebook({
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
  pageName = "Your Page",
}: Props) {
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const current = items[safeIndex] || "";
  const hasVariants = items.length > 1;

  const initials =
    pageName
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "YP";

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Facebook className="h-4 w-4 text-[#1877F2]" />
          Facebook
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
        <div className="flex items-center gap-3 p-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#1877F2] to-[#0b5fcc] text-white flex items-center justify-center font-semibold text-sm shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight truncate">{pageName}</p>
            <p className="text-[11px] text-slate-500 leading-tight flex items-center gap-1 mt-0.5">
              2h · <Globe2 className="h-3 w-3" />
            </p>
          </div>
          <MoreHorizontal className="h-5 w-5 text-slate-400 shrink-0" />
        </div>

        <EditableBody
          value={current}
          onChange={onEdit}
          disabled={regenActive}
          placeholder="Your Facebook post…"
        />

        {/* reactions summary */}
        <div className="flex items-center gap-1 px-3 pb-2 text-xs text-slate-500">
          <span className="inline-flex -space-x-1">
            <span className="h-4 w-4 rounded-full bg-[#1877F2] border-2 border-white" />
            <span className="h-4 w-4 rounded-full bg-red-500 border-2 border-white" />
          </span>
          <span>Alex Kim and 421 others</span>
          <span className="ml-auto">38 comments · 12 shares</span>
        </div>

        {/* actions */}
        <div className="grid grid-cols-3 border-t text-slate-600">
          <button type="button" className="flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium hover:bg-slate-100" tabIndex={-1}>
            <ThumbsUp className="h-4 w-4" /> Like
          </button>
          <button type="button" className="flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium hover:bg-slate-100" tabIndex={-1}>
            <MessageCircle className="h-4 w-4" /> Comment
          </button>
          <button type="button" className="flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium hover:bg-slate-100" tabIndex={-1}>
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
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

function EditableBody({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="px-3 pb-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className={cn(
          "w-full resize-none bg-transparent text-[14px] leading-relaxed",
          "text-slate-900 whitespace-pre-wrap break-words outline-none",
          "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
          "placeholder:text-slate-400 disabled:opacity-60",
        )}
      />
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
