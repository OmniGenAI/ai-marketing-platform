"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutList,
  Copy,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  items: string[];
  onItemEdit: (i: number, v: string) => void;
  onCopyAll: () => void;
  sourceUrl: string;

  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;
}

/**
 * Editable Instagram-style carousel preview. One square slide visible at a
 * time with left/right arrows and slide dots at the bottom.
 */
export function PostPreviewCarousel({
  items,
  onItemEdit,
  onCopyAll,
  sourceUrl,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
}: Props) {
  const [slideIndex, setSlideIndex] = useState(0);
  useEffect(() => {
    if (slideIndex >= items.length) setSlideIndex(Math.max(0, items.length - 1));
  }, [items.length, slideIndex]);

  const safeIndex = Math.min(slideIndex, Math.max(0, items.length - 1));
  const current = items[safeIndex] || "";
  const lastSlide = items.length > 0 && safeIndex === items.length - 1;
  const slideHasUrl = current.includes(sourceUrl);

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <LayoutList className="h-4 w-4 text-amber-600" />
          Carousel
          <Badge variant="outline" className="ml-1 font-mono text-[10px] border-purple-200">
            {items.length} slides
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

      {/* Slide viewer */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="aspect-square flex items-center justify-center text-muted-foreground text-sm">
            No slides yet.
          </div>
        ) : (
          <div className="relative">
            <div className="relative aspect-square w-full bg-gradient-to-br from-violet-200 via-fuchsia-300 to-pink-300 p-8 flex flex-col justify-between font-bold shadow-[inset_0_0_60px_rgba(255,255,255,0.15)]">
              {/* Slide number */}
              <div className="flex items-start justify-between">
                <div className="rounded-md bg-white/15 backdrop-blur px-2 py-0.5 text-[11px] font-mono tabular-nums">
                  Slide {safeIndex + 1} / {items.length}
                </div>
                {lastSlide && (
                  <div className="rounded-md bg-white text-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    CTA
                  </div>
                )}
              </div>

              {/* Editable body */}
              <EditableSlide
                value={current}
                onChange={(v) => onItemEdit(safeIndex, v)}
                disabled={regenActive}
                isCTA={lastSlide}
              />

              {/* Footer hint */}
              <div className="flex items-center justify-between text-[10px] text-slate-800/70">
                {lastSlide && sourceUrl && (
                  <span className={cn("truncate", slideHasUrl ? "" : "text-amber-200")}>
                    {slideHasUrl ? "✓ " : "⚠ "}
                    {sourceUrl}
                  </span>
                )}
                <span className="ml-auto">Swipe →</span>
              </div>
            </div>

            {/* Nav arrows */}
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setSlideIndex(Math.max(0, safeIndex - 1))}
                  disabled={safeIndex === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous slide"
                >
                  <ChevronLeft className="h-4 w-4 text-slate-700" />
                </button>
                <button
                  type="button"
                  onClick={() => setSlideIndex(Math.min(items.length - 1, safeIndex + 1))}
                  disabled={safeIndex >= items.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next slide"
                >
                  <ChevronRight className="h-4 w-4 text-slate-700" />
                </button>
              </>
            )}
          </div>
        )}

        {/* Slide dots + per-slide copy */}
        {items.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-t">
            <div className="flex items-center gap-1.5">
              {items.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSlideIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === safeIndex
                      ? "w-5 bg-purple-600"
                      : "w-1.5 bg-slate-300 hover:bg-slate-400",
                  )}
                  title={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900"
              onClick={() => {
                navigator.clipboard.writeText(current);
                toast.success(`Slide ${safeIndex + 1} copied!`);
              }}
            >
              <Copy className="h-3 w-3" />
              Copy slide
            </button>
          </div>
        )}
      </div>

      <UrlFooter url={sourceUrl} present={items.some((s) => s.includes(sourceUrl))} />

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

function EditableSlide({
  value,
  onChange,
  disabled,
  isCTA,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  isCTA: boolean;
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
      placeholder={isCTA ? "Final CTA + source URL…" : "Slide content…"}
      rows={1}
      className={cn(
        "w-full resize-none bg-transparent outline-none",
        "font-semibold text-center leading-snug whitespace-pre-wrap break-words",
        isCTA ? "text-lg" : "text-xl",
        "focus:ring-2 focus:ring-white/60 focus:rounded-md focus:px-1 focus:-mx-1",
        "placeholder:text-white/50 disabled:opacity-60",
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
      className={`text-[10px] flex items-center gap-1 truncate ${
        present ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      {present ? "Backlink present on final slide →" : "Backlink missing — add on the final slide:"}
      <span className="truncate">{url}</span>
    </div>
  );
}
