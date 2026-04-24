"use client";

import {
  Linkedin,
  Twitter,
  Mail,
  Youtube,
  Instagram,
  Facebook,
  Quote,
  LayoutList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlatformKey } from "@/types";

const PLATFORMS: { value: PlatformKey; label: string; icon: React.ElementType }[] = [
  { value: "linkedin",  label: "LinkedIn",  icon: Linkedin },
  { value: "twitter",   label: "X/Twitter", icon: Twitter },
  { value: "email",     label: "Email",     icon: Mail },
  { value: "youtube",   label: "YouTube",   icon: Youtube },
  { value: "instagram", label: "Instagram", icon: Instagram },
  { value: "facebook",  label: "Facebook",  icon: Facebook },
  { value: "quotes",    label: "Quotes",    icon: Quote },
  { value: "carousel",  label: "Carousel",  icon: LayoutList },
];

interface Props {
  value: PlatformKey[];
  onChange: (platforms: PlatformKey[]) => void;
}

export function PlatformChips({ value, onChange }: Props) {
  const selected = new Set(value);
  const toggle = (p: PlatformKey) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    onChange(PLATFORMS.map((x) => x.value).filter((v) => next.has(v)));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PLATFORMS.map((p) => {
          const active = selected.has(p.value);
          const Icon = p.icon;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => toggle(p.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-purple-500 bg-purple-100 text-purple-700 hover:bg-purple-200"
                  : "border-border bg-background text-muted-foreground hover:border-purple-400 hover:text-purple-700"
              )}
            >
              <Icon className="h-3 w-3" />
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => onChange(PLATFORMS.map((p) => p.value))}
        >
          Select all
        </button>
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => onChange([])}
        >
          Clear
        </button>
        <span className="ml-auto">{value.length} / {PLATFORMS.length} selected</span>
      </div>
    </div>
  );
}
