"use client";

import { useEffect, useRef } from "react";
import {
  MessageCircle,
  Repeat2,
  Heart,
  BarChart2,
  Share,
  MoreHorizontal,
  Copy,
  Link as LinkIcon,
  AlertTriangle,
  X,
  Twitter,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  tweets: string[];
  onItemEdit: (i: number, v: string) => void;
  onCopyAll: () => void;
  sourceUrl: string;

  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;

  handle?: string;
  displayName?: string;
}

/**
 * Editable X/Twitter thread preview. Each tweet is an editable card block
 * rendered with real thread chrome.
 */
export function PostPreviewTwitter({
  tweets,
  onItemEdit,
  onCopyAll,
  sourceUrl,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
  handle = "yourhandle",
  displayName = "Your Name",
}: Props) {
  const initials =
    displayName
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "YN";

  const anyHasUrl = tweets.some((t) => t.includes(sourceUrl));

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Twitter className="h-4 w-4 text-[#1DA1F2]" />
          Twitter Thread
          <Badge variant="outline" className="font-mono text-[10px] border-purple-200">
            {tweets.length}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1 h-7 px-2"
          onClick={onCopyAll}
        >
          <Copy className="h-3 w-3" />
          Copy all
        </Button>
      </div>

      {/* Thread mock */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden text-slate-900">
        {tweets.map((tweet, i) => {
          const isLast = i === tweets.length - 1;
          return (
            <div key={i} className={cn("flex gap-3 p-3", !isLast && "border-b")}>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 text-white flex items-center justify-center font-semibold text-sm">
                  {initials}
                </div>
                {!isLast && <span className="flex-1 w-0.5 bg-slate-200" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[13px] leading-tight">
                  <span className="font-semibold truncate">{displayName}</span>
                  <span className="text-slate-500 truncate">@{handle}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">now</span>
                  <button
                    type="button"
                    className="ml-auto text-slate-400 hover:text-slate-700"
                    onClick={() => {
                      navigator.clipboard.writeText(tweet);
                      toast.success(`Tweet ${i + 1} copied!`);
                    }}
                    title="Copy tweet"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <MoreHorizontal className="h-4 w-4 text-slate-400" />
                </div>

                <EditableTweet
                  value={tweet}
                  onChange={(v) => onItemEdit(i, v)}
                  disabled={regenActive}
                  placeholder={`Tweet ${i + 1}…`}
                />

                <div className="flex items-center justify-between mt-2 text-slate-500 max-w-sm">
                  <IconBtn icon={MessageCircle} />
                  <IconBtn icon={Repeat2} />
                  <IconBtn icon={Heart} />
                  <IconBtn icon={BarChart2} />
                  <IconBtn icon={Share} />
                </div>

                <CharCounter text={tweet} max={280} />
              </div>
            </div>
          );
        })}
      </div>

      <UrlFooter url={sourceUrl} present={anyHasUrl} />

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

function EditableTweet({
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
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      rows={1}
      className={cn(
        "mt-1 w-full resize-none bg-transparent text-[14px] leading-relaxed",
        "text-slate-900 whitespace-pre-wrap break-words outline-none",
        "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
        "placeholder:text-slate-400 disabled:opacity-60",
      )}
    />
  );
}

function CharCounter({ text, max }: { text: string; max: number }) {
  const n = text.length;
  const over = n > max;
  const warn = n > max * 0.9;
  return (
    <p
      className={cn(
        "text-[10px] font-mono text-right mt-0.5 tabular-nums",
        over ? "text-red-600" : warn ? "text-amber-600" : "text-slate-400",
      )}
    >
      {n}/{max}
    </p>
  );
}

function IconBtn({ icon: Icon }: { icon: React.ElementType }) {
  return (
    <button type="button" className="p-1 rounded-full hover:bg-slate-100" tabIndex={-1}>
      <Icon className="h-4 w-4" />
    </button>
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
