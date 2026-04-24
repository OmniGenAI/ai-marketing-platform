"use client";

import { MousePointerClick, MessageCircle, Award, Megaphone, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentGoal } from "@/types";

const GOALS: { value: ContentGoal; label: string; icon: React.ElementType; hint: string }[] = [
  { value: "clicks",    label: "Clicks",     icon: MousePointerClick, hint: "Drive link taps" },
  { value: "comments",  label: "Comments",   icon: MessageCircle,     hint: "Spark discussion" },
  { value: "authority", label: "Authority",  icon: Award,             hint: "Build credibility" },
  { value: "promote",   label: "Promote",    icon: Megaphone,         hint: "Soft-sell product" },
  { value: "viral",     label: "Viral",      icon: Flame,             hint: "Max shareability" },
];

interface Props {
  value: ContentGoal;
  onChange: (g: ContentGoal) => void;
}

export function GoalSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {GOALS.map((g) => {
        const active = value === g.value;
        const Icon = g.icon;
        return (
          <button
            key={g.value}
            type="button"
            title={g.hint}
            onClick={() => onChange(g.value)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition",
              active
                ? "border-purple-500 bg-purple-100 text-purple-700 shadow-sm"
                : "border-transparent bg-muted/40 text-muted-foreground hover:bg-purple-50 hover:text-purple-700"
            )}
          >
            <Icon className="h-4 w-4" />
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
