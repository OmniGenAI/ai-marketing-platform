import type { PosterTemplateStyle } from "@/types";

/**
 * Visual definition for a poster template.
 *
 * - The backend uses the matching style id to inject visual fragments into
 *   the AI image-prompt (see `_POSTER_STYLE_FRAGMENTS` in
 *   `backend/app/services/ai.py`).
 * - The frontend uses the rest of the metadata to render a CSS overlay on
 *   top of the AI background image. The overlay is captured to PNG via
 *   `html-to-image` for download.
 *
 * Layout rules (consumed by `PosterPreview.tsx`):
 *   - `headlineAlign`: where the headline+tagline block sits inside the
 *     poster frame.
 *   - `ctaAlign`: where the CTA pill / button sits.
 *   - `scrim`: optional dark/light gradient layer behind the text for legibility.
 */
export interface PosterTemplate {
  /** Stable id — must match `POSTER_TEMPLATE_STYLES` on the backend. */
  id: PosterTemplateStyle;
  /** Human-readable label for the chip picker. */
  label: string;
  /** One-line description shown beneath the chip. */
  description: string;
  /** Tailwind class applied to the headline text. */
  headlineClass: string;
  /** Tailwind class applied to the tagline text. */
  taglineClass: string;
  /** Tailwind class applied to the CTA pill. */
  ctaClass: string;
  /** Where the headline + tagline block is anchored. */
  headlineAlign: "top-left" | "top-center" | "center" | "bottom-left" | "bottom-center";
  /** Where the CTA pill is anchored. */
  ctaAlign: "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  /** Optional scrim gradient applied behind the text. */
  scrim:
    | "none"
    | "dark-bottom"
    | "dark-full"
    | "light-bottom"
    | "light-full";
  /** Tailwind class for an optional accent stripe / border / dot. */
  accentClass?: string;
  /** Default font-family suggestion (CSS variable name from globals.css). */
  fontFamilyVar?: string;
}

export const POSTER_TEMPLATES: readonly PosterTemplate[] = [
  {
    id: "minimal",
    label: "Minimal",
    description: "Clean Swiss aesthetic, lots of whitespace.",
    headlineClass: "font-semibold tracking-tight text-neutral-900",
    taglineClass: "text-neutral-700",
    ctaClass: "bg-neutral-900 text-white rounded-full px-5 py-2 text-sm font-medium",
    headlineAlign: "top-left",
    ctaAlign: "bottom-left",
    scrim: "light-full",
    accentClass: "border-l-2 border-neutral-900",
  },
  {
    id: "bold",
    label: "Bold",
    description: "Heavy display type, vibrant contrast.",
    headlineClass: "font-black uppercase tracking-tight text-white drop-shadow-lg",
    taglineClass: "text-white/90 font-medium",
    ctaClass: "bg-yellow-400 text-black rounded-md px-5 py-2 text-sm font-bold uppercase tracking-wide",
    headlineAlign: "center",
    ctaAlign: "bottom-center",
    scrim: "dark-full",
  },
  {
    id: "corporate",
    label: "Corporate",
    description: "Premium, trustworthy, glass-and-metal.",
    headlineClass: "font-semibold tracking-tight text-white",
    taglineClass: "text-white/85",
    ctaClass: "bg-white text-slate-900 rounded-md px-5 py-2 text-sm font-semibold shadow",
    headlineAlign: "top-left",
    ctaAlign: "bottom-right",
    scrim: "dark-bottom",
    accentClass: "border-t-2 border-sky-400",
  },
  {
    id: "festival",
    label: "Festival",
    description: "Warm, joyful, celebratory mood.",
    headlineClass: "font-extrabold tracking-tight text-white drop-shadow-lg",
    taglineClass: "text-white/95 font-medium",
    ctaClass: "bg-white text-rose-600 rounded-full px-6 py-2 text-sm font-bold shadow-lg",
    headlineAlign: "top-center",
    ctaAlign: "bottom-center",
    scrim: "dark-bottom",
  },
  {
    id: "tech",
    label: "Tech",
    description: "Futuristic, neon accents, dark navy.",
    headlineClass: "font-bold tracking-tight text-cyan-300 [text-shadow:0_0_18px_rgba(34,211,238,0.55)]",
    taglineClass: "text-white/85 font-mono text-sm",
    ctaClass: "bg-cyan-400 text-slate-900 rounded-md px-5 py-2 text-sm font-bold tracking-wide",
    headlineAlign: "top-left",
    ctaAlign: "bottom-right",
    scrim: "dark-full",
    accentClass: "border-l-2 border-cyan-400",
  },
  {
    id: "startup",
    label: "Startup",
    description: "Bright, optimistic, pastel gradients.",
    headlineClass: "font-bold tracking-tight text-slate-900",
    taglineClass: "text-slate-700",
    ctaClass: "bg-violet-600 text-white rounded-full px-5 py-2 text-sm font-semibold",
    headlineAlign: "top-left",
    ctaAlign: "bottom-left",
    scrim: "light-bottom",
  },
  {
    id: "event",
    label: "Event",
    description: "Cinematic spotlight, dramatic mood.",
    headlineClass: "font-extrabold uppercase tracking-widest text-white drop-shadow-xl",
    taglineClass: "text-white/90",
    ctaClass: "bg-amber-400 text-black rounded-sm px-5 py-2 text-sm font-bold uppercase tracking-wider",
    headlineAlign: "center",
    ctaAlign: "bottom-center",
    scrim: "dark-full",
  },
  {
    id: "sale",
    label: "Sale",
    description: "Urgent, eye-catching, promotional.",
    headlineClass: "font-black uppercase tracking-tight text-white",
    taglineClass: "text-white/95 font-semibold",
    ctaClass: "bg-yellow-300 text-red-700 rounded-md px-6 py-2 text-sm font-black uppercase tracking-wide animate-pulse",
    headlineAlign: "top-center",
    ctaAlign: "bottom-center",
    scrim: "dark-bottom",
    accentClass: "border-y-4 border-yellow-300",
  },
] as const;

/** Map of template id → template for O(1) lookups. */
export const POSTER_TEMPLATES_BY_ID: Record<PosterTemplateStyle, PosterTemplate> =
  POSTER_TEMPLATES.reduce(
    (acc, t) => {
      acc[t.id] = t;
      return acc;
    },
    {} as Record<PosterTemplateStyle, PosterTemplate>,
  );

/**
 * Resolve a template by id with a safe fallback to "minimal" if the id is
 * unknown (e.g. backend added a new style the frontend hasn't shipped yet).
 */
export function getPosterTemplate(id: string | undefined | null): PosterTemplate {
  if (id && id in POSTER_TEMPLATES_BY_ID) {
    return POSTER_TEMPLATES_BY_ID[id as PosterTemplateStyle];
  }
  return POSTER_TEMPLATES_BY_ID.minimal;
}

/**
 * Aspect-ratio metadata for the form picker.
 *
 * `cssAspect` is fed straight into Tailwind's `aspect-[…]` arbitrary value so
 * the preview frame always matches what the AI image is generated at.
 */
export const POSTER_ASPECT_RATIOS = [
  { id: "1:1", label: "Square", description: "Instagram, Facebook", cssAspect: "1/1" },
  { id: "4:5", label: "Portrait", description: "Instagram feed", cssAspect: "4/5" },
  { id: "9:16", label: "Story", description: "Reels, Stories", cssAspect: "9/16" },
  { id: "16:9", label: "Landscape", description: "LinkedIn, Twitter", cssAspect: "16/9" },
] as const;

export const POSTER_CAPTION_TONES = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "witty", label: "Witty" },
  { id: "casual", label: "Casual" },
] as const;
