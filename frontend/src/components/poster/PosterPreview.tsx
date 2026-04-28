"use client";

import * as React from "react";
import { Check, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  POSTER_ASPECT_RATIOS,
  type PosterTemplate,
} from "@/lib/poster/templates";
import type { PosterAspectRatio } from "@/types";

/**
 * Resolve the Tailwind `aspect-[…]` value for a given aspect ratio id.
 * Falls back to 1:1 if the id is not recognised.
 */
function aspectRatioToCss(ratio: PosterAspectRatio | string): string {
  const match = POSTER_ASPECT_RATIOS.find((r) => r.id === ratio);
  return match?.cssAspect ?? "1/1";
}

/** Position classes for the headline/tagline block inside the poster frame.
 *
 * v2: headline shifted slightly higher (4-6%) and bottom-anchored variants
 * pulled up further (28%) so the new features block + CTA + brand strip
 * have room to breathe without overlapping.
 */
const HEADLINE_ALIGN_CLASSES: Record<PosterTemplate["headlineAlign"], string> = {
  "top-left": "top-[5%] left-[7%] right-[7%] text-left items-start",
  "top-center": "top-[5%] left-[7%] right-[7%] text-center items-center",
  center: "top-[28%] left-[7%] right-[7%] text-center items-center",
  "bottom-left": "bottom-[28%] left-[7%] right-[7%] text-left items-start",
  "bottom-center": "bottom-[28%] left-[7%] right-[7%] text-center items-center",
};

/** Position classes for the CTA pill. v2: lifted off the bottom edge so the
 *  brand footer strip can sit there. */
const CTA_ALIGN_CLASSES: Record<PosterTemplate["ctaAlign"], string> = {
  "top-right": "top-[5%] right-[5%]",
  "bottom-left": "bottom-[18%] left-[7%]",
  "bottom-center": "bottom-[18%] left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-[18%] right-[7%]",
};

/** Scrim gradient for legibility behind text. */
const SCRIM_CLASSES: Record<PosterTemplate["scrim"], string> = {
  none: "",
  "dark-bottom":
    "bg-linear-to-t from-black/65 via-black/30 to-transparent",
  "dark-full":
    "bg-linear-to-b from-black/40 via-black/30 to-black/55",
  "light-bottom":
    "bg-linear-to-t from-white/80 via-white/40 to-transparent",
  "light-full":
    "bg-linear-to-b from-white/60 via-white/40 to-white/70",
};

/** Whether the template uses light or dark surface text. Used by the eyebrow
 *  + features block to pick a chip background that doesn't disappear. */
function isDarkTheme(template: PosterTemplate): boolean {
  return template.scrim === "dark-bottom" || template.scrim === "dark-full";
}

export interface PosterPreviewProps {
  template: PosterTemplate;
  aspectRatio: PosterAspectRatio | string;
  backgroundUrl: string | null | undefined;
  headline: string;
  tagline: string;
  cta: string;
  /** Eyebrow chip above the headline ("30-Day Bootcamp · Self-paced"). */
  eyebrow?: string | null;
  /** 3 to 4 short benefit bullets rendered as a checklist. */
  features?: readonly string[];
  /** Footer brand strip text ("BusinessName · site.com · @handle"). */
  brandLabel?: string | null;
  /** Optional brand logo URL — sits inside the footer strip when provided. */
  logoUrl?: string | null;
  /** Maximum visual width — defaults to 100% of the parent column. */
  className?: string;
  /** When true, switches all text fields into contentEditable. */
  editable?: boolean;
  /** Fired when the user finishes editing a text field (on blur). */
  onEditHeadline?: (next: string) => void;
  onEditTagline?: (next: string) => void;
  onEditCta?: (next: string) => void;
  onEditEyebrow?: (next: string) => void;
  onEditFeature?: (index: number, next: string) => void;
  onEditBrandLabel?: (next: string) => void;
}

/**
 * Renders the AI-generated background + CSS-overlaid text. The whole block
 * is captured by `html-to-image` in `DownloadButton`, so what you see on
 * screen is exactly what gets exported as PNG.
 *
 * The forwarded `ref` points at the OUTER frame — capture that node.
 */
export const PosterPreview = React.forwardRef<HTMLDivElement, PosterPreviewProps>(
  function PosterPreview(
    {
      template,
      aspectRatio,
      backgroundUrl,
      headline,
      tagline,
      cta,
      eyebrow,
      features,
      brandLabel,
      logoUrl,
      className,
      editable = false,
      onEditHeadline,
      onEditTagline,
      onEditCta,
      onEditEyebrow,
      onEditFeature,
      onEditBrandLabel,
    },
    ref,
  ) {
    const cssAspect = aspectRatioToCss(aspectRatio);
    const headlineAlign = HEADLINE_ALIGN_CLASSES[template.headlineAlign];
    const ctaAlign = CTA_ALIGN_CLASSES[template.ctaAlign];
    const scrim = SCRIM_CLASSES[template.scrim];
    const dark = isDarkTheme(template);

    // The features block sits BELOW the headline+tagline cluster in the same
    // horizontal alignment. A small fixed offset (~38% from top) keeps it
    // visually centered between the headline and the CTA/footer for every
    // headlineAlign value.
    const visibleFeatures = (features ?? []).filter(
      (f) => editable || (f && f.trim()),
    );
    // Cap at 4 to avoid overflow into the CTA / footer.
    const features4 = visibleFeatures.slice(0, 4);

    const headlineHorizontal: "left" | "center" =
      template.headlineAlign === "top-center" ||
      template.headlineAlign === "bottom-center" ||
      template.headlineAlign === "center"
        ? "center"
        : "left";

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-full overflow-hidden rounded-xl border bg-neutral-100 shadow-sm",
          className,
        )}
        style={{ aspectRatio: cssAspect }}
        data-poster-template={template.id}
      >
        {/* AI background image */}
        {backgroundUrl ? (
          // Use a plain <img> rather than next/image so html-to-image can
          // capture the rendered pixels without a Next-specific loader.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backgroundUrl}
            alt=""
            crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-linear-to-br from-neutral-200 to-neutral-100 text-neutral-500">
            <ImageOff className="h-8 w-8 mb-2" />
            <p className="text-xs">No background yet</p>
          </div>
        )}

        {/* Scrim for legibility */}
        {scrim && <div className={cn("absolute inset-0 pointer-events-none", scrim)} />}

        {/* Optional accent stripe — a 0-width div with template's accent border */}
        {template.accentClass && (
          <div
            className={cn(
              "absolute inset-0 pointer-events-none",
              template.accentClass,
            )}
          />
        )}

        {/* Headline + tagline + eyebrow */}
        <div
          className={cn(
            "absolute flex flex-col gap-2 pointer-events-none",
            headlineAlign,
          )}
        >
          {(eyebrow || editable) && (
            <span
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={(e) =>
                onEditEyebrow?.((e.currentTarget.textContent || "").trim())
              }
              className={cn(
                "inline-block outline-none rounded-full px-2.5 py-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider",
                dark
                  ? "bg-white/15 text-white backdrop-blur-sm"
                  : "bg-neutral-900/85 text-white",
                editable && "pointer-events-auto cursor-text",
              )}
            >
              {eyebrow || (editable ? "30-Day Bootcamp · Self-paced" : "")}
            </span>
          )}

          <h2
            contentEditable={editable}
            suppressContentEditableWarning
            onBlur={(e) =>
              onEditHeadline?.((e.currentTarget.textContent || "").trim())
            }
            className={cn(
              "outline-none leading-[1.05] text-3xl sm:text-4xl md:text-5xl",
              template.headlineClass,
              editable && "pointer-events-auto cursor-text",
            )}
          >
            {headline || (editable ? "Headline" : "")}
          </h2>

          {(tagline || editable) && (
            <p
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={(e) =>
                onEditTagline?.((e.currentTarget.textContent || "").trim())
              }
              className={cn(
                "outline-none text-sm sm:text-base md:text-lg leading-snug max-w-[80%]",
                template.taglineClass,
                editable && "pointer-events-auto cursor-text",
              )}
            >
              {tagline || (editable ? "Tagline" : "")}
            </p>
          )}
        </div>

        {/* Features checklist — fixed-position block in the middle band so it
         *  doesn't fight the headline (top) or CTA/footer (bottom). */}
        {features4.length > 0 && (
          <div
            className={cn(
              "absolute left-[7%] right-[7%] top-[44%] flex flex-col gap-1.5 pointer-events-none",
              headlineHorizontal === "center" ? "items-center" : "items-start",
            )}
          >
            {features4.map((feature, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1.5 outline-none text-xs sm:text-sm md:text-base font-medium",
                  dark ? "text-white" : "text-neutral-900",
                )}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0",
                    dark ? "text-emerald-300" : "text-emerald-600",
                  )}
                />
                <span
                  contentEditable={editable}
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    onEditFeature?.(i, (e.currentTarget.textContent || "").trim())
                  }
                  className={cn(
                    "outline-none",
                    editable && "pointer-events-auto cursor-text",
                  )}
                >
                  {feature || (editable ? "Benefit bullet" : "")}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* CTA pill */}
        {(cta || editable) && (
          <div className={cn("absolute pointer-events-none", ctaAlign)}>
            <span
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={(e) =>
                onEditCta?.((e.currentTarget.textContent || "").trim())
              }
              className={cn(
                "inline-block outline-none whitespace-nowrap",
                template.ctaClass,
                editable && "pointer-events-auto cursor-text",
              )}
            >
              {cta || (editable ? "Enroll Now" : "")}
            </span>
          </div>
        )}

        {/* Footer brand strip — full-width band with logo + label. Replaces
         *  the previous tiny floating logo in the bottom-right corner. */}
        {(brandLabel || logoUrl || editable) && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2",
              dark
                ? "bg-black/55 backdrop-blur-sm"
                : "bg-white/80 backdrop-blur-sm",
            )}
          >
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                crossOrigin="anonymous"
                className="h-7 w-7 sm:h-8 sm:w-8 rounded object-contain bg-white/95 p-0.5 shrink-0"
                draggable={false}
              />
            )}
            <span
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={(e) =>
                onEditBrandLabel?.((e.currentTarget.textContent || "").trim())
              }
              className={cn(
                "outline-none truncate text-xs sm:text-sm font-semibold tracking-wide",
                dark ? "text-white" : "text-neutral-900",
                editable && "pointer-events-auto cursor-text",
              )}
            >
              {brandLabel ||
                (editable ? "Your Brand · yoursite.com · @handle" : "")}
            </span>
          </div>
        )}
      </div>
    );
  },
);
