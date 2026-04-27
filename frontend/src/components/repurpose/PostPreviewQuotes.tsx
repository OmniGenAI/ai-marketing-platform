"use client";

import { useEffect, useRef, useState } from "react";
import { Quote, Copy, Download, Link as LinkIcon, AlertTriangle } from "lucide-react";
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

  attribution?: string;
}

const CARD_THEMES = [
  // hot pink → magenta → electric violet
  "bg-gradient-to-br from-pink-200 via-fuchsia-200 to-violet-200 font-bold text-slate-900 ",
  // electric blue → indigo → vivid violet
  "bg-gradient-to-br from-sky-200 via-indigo-200 to-fuchsia-200 font-bold text-slate-900 ",
  // sunset: yellow → orange → hot pink
  "bg-gradient-to-br from-yellow-200 via-orange-200 to-pink-200 font-bold text-slate-900 ",
  // neon lime → emerald → teal
  "bg-gradient-to-br from-lime-200 via-emerald-200 to-teal-200 font-bold text-slate-900 ",
  // coral → red → fuchsia
  "bg-gradient-to-br from-orange-200 via-rose-200 to-fuchsia-200 font-bold text-slate-900 ",
];

// Parallel hex stops for PNG export — MUST match CARD_THEMES order.
const THEME_STOPS: [string, string, string][] = [
  ["#fbcfe8", "#f5d0fe", "#ddd6fe"], // pink-200 / fuchsia-200 / violet-200
  ["#bae6fd", "#c7d2fe", "#f5d0fe"], // sky-200 / indigo-200 / fuchsia-200
  ["#fef08a", "#fed7aa", "#fbcfe8"], // yellow-200 / orange-200 / pink-200
  ["#d9f99d", "#a7f3d0", "#99f6e4"], // lime-200 / emerald-200 / teal-200
  ["#fed7aa", "#fecdd3", "#f5d0fe"], // orange-200 / rose-200 / fuchsia-200
];

/**
 * Render a single quote card to a 1080×1080 PNG data URL, then trigger a
 * download. Pure Canvas API — no external dependencies.
 */
function exportQuotePng({
  quote,
  index,
  attribution,
  stops,
}: {
  quote: string;
  index: number;
  attribution: string;
  stops: [string, string, string];
}): void {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background gradient (top-left → bottom-right, matching bg-gradient-to-br)
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle inset vignette for depth
  const vignette = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE / 2, SIZE / 2, SIZE * 0.7);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Decorative opening quote mark (top-left)
  ctx.fillStyle = "rgba(15, 23, 42, 0.15)";
  ctx.font = "900 220px Georgia, 'Times New Roman', serif";
  ctx.textBaseline = "top";
  ctx.fillText("“", 80, 40);

  // Wrap + draw the quote text centered
  ctx.fillStyle = "#0f172a"; // slate-900
  const padding = 110;
  const maxWidth = SIZE - padding * 2;
  // Auto-scale font size so the wrapped text fits vertically
  const candidates = [74, 66, 58, 52, 46, 40];
  let chosenFont = candidates[candidates.length - 1];
  let chosenLines: string[] = [];
  let chosenLineHeight = 52;
  for (const fontSize of candidates) {
    ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const lines = wrapText(ctx, quote || "", maxWidth);
    const lineHeight = Math.round(fontSize * 1.25);
    const totalHeight = lines.length * lineHeight;
    if (totalHeight < SIZE - 340) {
      chosenFont = fontSize;
      chosenLines = lines;
      chosenLineHeight = lineHeight;
      break;
    }
    chosenFont = fontSize;
    chosenLines = lines;
    chosenLineHeight = lineHeight;
  }

  ctx.font = `700 ${chosenFont}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const centerY = SIZE / 2;
  const startY = centerY - ((chosenLines.length - 1) * chosenLineHeight) / 2;
  chosenLines.forEach((line, i) => {
    ctx.fillText(line, SIZE / 2, startY + i * chosenLineHeight);
  });

  // Attribution (bottom-left) + index (bottom-right)
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.font = "600 30px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(attribution, 70, SIZE - 70);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  ctx.font = "600 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`#${String(index + 1).padStart(2, "0")}`, SIZE - 70, SIZE - 70);

  // Trigger download
  canvas.toBlob((blob) => {
    if (!blob) {
      toast.error("Failed to export PNG");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-${String(index + 1).padStart(2, "0")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/** Basic word-wrap helper for canvas text. Breaks on spaces; hard-breaks very long words. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  const paragraphs = (text || "").split(/\n+/);
  for (const para of paragraphs) {
    if (!para.trim()) {
      result.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) result.push(line);
        // Word longer than maxWidth → hard-break it
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            const next = chunk + ch;
            if (ctx.measureText(next).width <= maxWidth) {
              chunk = next;
            } else {
              if (chunk) result.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) result.push(line);
  }
  return result;
}

/**
 * Editable quote-card preview. Each quote rendered as an Instagram-ready
 * square graphic with a big opening quote mark and attribution.
 */
export function PostPreviewQuotes({
  items,
  onItemEdit,
  onCopyAll,
  sourceUrl,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
  attribution: attributionProp = "@yourhandle",
}: Props) {
  // Attribution is shared across all quote cards and persisted per-user.
  const [attribution, setAttribution] = useState<string>(attributionProp);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("repurpose_quote_attribution");
    if (saved) setAttribution(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("repurpose_quote_attribution", attribution);
  }, [attribution]);

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Quote className="h-4 w-4 text-violet-600" />
          Pull Quote Cards
          <Badge variant="outline" className="ml-1 font-mono text-[10px] border-purple-200">
            {items.length}
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

      {/* Stacked quote cards */}
      <div className="space-y-3">
        {items.map((quote, i) => (
          <QuoteCard
            key={i}
            index={i}
            theme={CARD_THEMES[i % CARD_THEMES.length]}
            stops={THEME_STOPS[i % THEME_STOPS.length]}
            value={quote}
            onChange={(v) => onItemEdit(i, v)}
            disabled={regenActive}
            attribution={attribution}
            onAttributionChange={setAttribution}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-lg border border-dashed border-purple-200 bg-purple-50/40 p-6 text-center text-[12px] text-muted-foreground">
            No quote cards yet. Use the controls below to regenerate.
          </div>
        )}
      </div>

      {sourceUrl && (
        <div className="text-[10px] flex items-center gap-1 truncate text-muted-foreground">
          <LinkIcon className="h-3 w-3 shrink-0" />
          Source (not embedded in cards): <span className="truncate">{sourceUrl}</span>
        </div>
      )}

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

function QuoteCard({
  index,
  theme,
  stops,
  value,
  onChange,
  disabled,
  attribution,
  onAttributionChange,
}: {
  index: number;
  theme: string;
  stops: [string, string, string];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  attribution: string;
  onAttributionChange: (v: string) => void;
}) {
  const charLen = value.length;
  const over = charLen > 120;
  const warn = charLen > 100;
  const isLight = theme.includes("text-slate-900");

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden">
      {/* card */}
      <div className={cn("relative aspect-[4/3] p-6 flex flex-col justify-between", theme)}>
        <Quote
          className={cn(
            "h-10 w-10 shrink-0",
            isLight ? "text-slate-900/20" : "text-white/30",
          )}
          fill="currentColor"
        />
        <EditableQuote
          value={value}
          onChange={onChange}
          disabled={disabled}
          isLight={isLight}
        />
        <div className="flex items-end justify-between">
          <EditableAttribution
            value={attribution}
            onChange={onAttributionChange}
            isLight={isLight}
            disabled={disabled}
          />
          <span className={cn("text-[10px] font-mono tabular-nums", isLight ? "text-slate-600" : "text-white/60")}>
            #{String(index + 1).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* per-card actions */}
      <div className="flex items-center justify-between bg-slate-50 border-t px-3 py-1.5 text-[11px] text-slate-500">
        <span className={cn("font-mono tabular-nums", over ? "text-red-600" : warn ? "text-amber-600" : "")}>
          {charLen}/120
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-slate-200 text-slate-600"
            onClick={() => {
              navigator.clipboard.writeText(value);
              toast.success(`Quote ${index + 1} copied!`);
            }}
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export as 1080×1080 PNG"
            disabled={!value.trim()}
            onClick={() => {
              try {
                exportQuotePng({ quote: value, index, attribution, stops });
                toast.success(`Quote ${index + 1} exported as PNG`);
              } catch (e) {
                console.error("PNG export failed", e);
                toast.error("PNG export failed");
              }
            }}
          >
            <Download className="h-3 w-3" />
            PNG
          </button>
        </div>
      </div>
    </div>
  );
}

function EditableAttribution({
  value,
  onChange,
  isLight,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  isLight: boolean;
  disabled?: boolean;
}) {
  // Auto-size input width to content using a hidden span mirror.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    input.style.width = `${Math.max(mirror.offsetWidth + 2, 60)}px`;
  }, [value]);

  return (
    <span className="relative inline-flex items-center">
      <span
        ref={mirrorRef}
        aria-hidden
        className="invisible whitespace-pre absolute text-[11px] font-medium"
      >
        {value || "@yourhandle"}
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
        disabled={disabled}
        placeholder="@yourhandle"
        className={cn(
          "bg-transparent outline-none text-[11px] font-medium",
          "focus:ring-2 focus:rounded focus:px-1 focus:-mx-1",
          isLight
            ? "text-slate-700 placeholder:text-slate-500 focus:ring-slate-400/60"
            : "text-white/80 placeholder:text-white/50 focus:ring-white/60",
          "disabled:opacity-60",
        )}
        title="Click to edit your handle — applies to all cards and the PNG export"
      />
    </span>
  );
}

function EditableQuote({
  value,
  onChange,
  disabled,
  isLight,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  isLight: boolean;
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
      placeholder="Your punchy pull quote…"
      className={cn(
        "w-full resize-none bg-transparent outline-none",
        "text-xl font-semibold leading-snug text-center",
        "whitespace-pre-wrap break-words",
        "focus:ring-2 focus:ring-white/60 focus:rounded-md focus:px-1 focus:-mx-1",
        "disabled:opacity-60",
        isLight ? "placeholder:text-slate-500/50" : "placeholder:text-white/40",
      )}
    />
  );
}
