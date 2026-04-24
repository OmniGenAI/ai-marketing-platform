"use client";

import {
  User,
  Zap,
  BookOpen,
  BarChart3,
  GraduationCap,
  Code2,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoicePreset } from "@/types";

const VOICES: { value: VoicePreset; label: string; icon: React.ElementType; blurb: string }[] = [
  { value: "founder_pov",    label: "Founder POV",     icon: User,           blurb: "First-person, specifics, no hedging" },
  { value: "contrarian",     label: "Contrarian",      icon: Zap,            blurb: "Push back on conventional wisdom" },
  { value: "story_driven",   label: "Story-driven",    icon: BookOpen,       blurb: "Open with a scene, land a lesson" },
  { value: "data_backed",    label: "Data-backed",     icon: BarChart3,      blurb: "Lead with numbers, cite sources" },
  { value: "educational",    label: "Educational",     icon: GraduationCap,  blurb: "Teacher voice, steps, analogies" },
  { value: "technical_deep", label: "Technical deep",  icon: Code2,          blurb: "Precise terms, no simplification" },
  { value: "casual_builder", label: "Casual builder",  icon: Hammer,         blurb: "Indie-hacker energy, real talk" },
];

interface Props {
  value: VoicePreset;
  onChange: (v: VoicePreset) => void;
}

export function VoiceTileGrid({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {VOICES.map((v) => {
        const active = value === v.value;
        const Icon = v.icon;
        return (
          <button
            key={v.value}
            type="button"
            onClick={() => onChange(v.value)}
            className={cn(
              "flex items-start gap-2 rounded-md border p-2.5 text-left transition",
              active
                ? "border-purple-500 bg-purple-100 shadow-sm"
                : "border-border bg-background hover:border-purple-400 hover:bg-purple-50/60"
            )}
          >
            <div
              className={cn(
                "rounded-md p-1.5 shrink-0",
                active ? "bg-purple-200 text-purple-700" : "bg-muted text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={cn("text-xs font-semibold", active ? "text-purple-800" : "")}>
                {v.label}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {v.blurb}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
