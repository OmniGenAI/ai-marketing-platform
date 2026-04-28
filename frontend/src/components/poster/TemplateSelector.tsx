"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { POSTER_TEMPLATES } from "@/lib/poster/templates";
import type { PosterTemplateStyle } from "@/types";

export interface TemplateSelectorProps {
  value: PosterTemplateStyle;
  onChange: (style: PosterTemplateStyle) => void;
  disabled?: boolean;
}

/**
 * 8-template chip picker. Each chip shows the label + description and a tiny
 * mini-preview swatch reflecting the template's headline / scrim treatment.
 */
export function TemplateSelector({
  value,
  onChange,
  disabled,
}: TemplateSelectorProps) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
      role="radiogroup"
      aria-label="Poster template style"
    >
      {POSTER_TEMPLATES.map((template) => {
        const selected = template.id === value;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(template.id)}
            className={cn(
              "group relative flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
              selected
                ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500"
                : "border-border bg-card hover:border-foreground/30",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {selected && (
              <span className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-white">
                <Check className="h-3 w-3" />
              </span>
            )}

            {/* Mini swatch */}
            <TemplateSwatch templateId={template.id} />

            <span className="text-xs font-semibold leading-tight">
              {template.label}
            </span>
            <span className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
              {template.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tiny visual preview that mirrors the dominant aesthetic of each template
 * — pure CSS, no external assets needed.
 */
function TemplateSwatch({ templateId }: { templateId: PosterTemplateStyle }) {
  const swatches: Record<PosterTemplateStyle, React.ReactNode> = {
    minimal: (
      <div className="h-10 w-full rounded bg-neutral-100 border border-neutral-200 relative overflow-hidden">
        <div className="absolute top-1.5 left-1.5 h-1 w-6 rounded bg-neutral-900" />
        <div className="absolute top-3 left-1.5 h-0.5 w-8 rounded bg-neutral-400" />
      </div>
    ),
    bold: (
      <div className="h-10 w-full rounded bg-linear-to-br from-rose-500 to-orange-500 relative overflow-hidden">
        <div className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-10 rounded bg-white" />
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1.5 w-5 rounded bg-yellow-300" />
      </div>
    ),
    corporate: (
      <div className="h-10 w-full rounded bg-linear-to-br from-slate-600 to-slate-800 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-sky-400" />
        <div className="absolute top-2 left-1.5 h-1 w-7 rounded bg-white" />
        <div className="absolute bottom-1.5 right-1.5 h-1.5 w-4 rounded bg-white" />
      </div>
    ),
    festival: (
      <div className="h-10 w-full rounded bg-linear-to-br from-rose-400 via-orange-300 to-amber-300 relative overflow-hidden">
        <div className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-9 rounded bg-white" />
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1.5 w-5 rounded-full bg-white" />
      </div>
    ),
    tech: (
      <div className="h-10 w-full rounded bg-linear-to-br from-slate-900 to-indigo-900 relative overflow-hidden">
        <div className="absolute top-2 left-1.5 h-1 w-7 rounded bg-cyan-400 [box-shadow:0_0_8px_rgba(34,211,238,0.6)]" />
        <div className="absolute bottom-1.5 right-1.5 h-1.5 w-4 rounded bg-cyan-400" />
      </div>
    ),
    startup: (
      <div className="h-10 w-full rounded bg-linear-to-br from-violet-100 to-pink-100 relative overflow-hidden">
        <div className="absolute top-2 left-1.5 h-1 w-7 rounded bg-slate-900" />
        <div className="absolute bottom-1.5 left-1.5 h-1.5 w-4 rounded-full bg-violet-600" />
      </div>
    ),
    event: (
      <div className="h-10 w-full rounded bg-linear-to-b from-purple-900 to-black relative overflow-hidden">
        <div className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-9 rounded bg-white" />
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1.5 w-5 rounded-sm bg-amber-400" />
      </div>
    ),
    sale: (
      <div className="h-10 w-full rounded bg-linear-to-br from-red-600 to-rose-600 relative overflow-hidden">
        <div className="absolute inset-y-0.5 left-0 right-0 border-y-2 border-yellow-300" />
        <div className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-9 rounded bg-white" />
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1.5 w-5 rounded bg-yellow-300" />
      </div>
    ),
  };
  return swatches[templateId];
}
