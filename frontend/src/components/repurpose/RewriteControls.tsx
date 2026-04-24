"use client";

import { RefreshCw, Scissors, Zap, HelpCircle, Target, WandSparkles } from "lucide-react";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

const PRESETS: { value: RewritePreset; label: string; icon: React.ElementType }[] = [
  { value: "sharper",        label: "Sharper",        icon: WandSparkles },
  { value: "shorter",        label: "Shorter",        icon: Scissors },
  { value: "bolder",         label: "Bolder",         icon: Zap },
  { value: "curiosity_gap",  label: "Curiosity gap",  icon: HelpCircle },
  { value: "more_specific",  label: "More specific",  icon: Target },
];

interface Props {
  onPreset: (preset: RewritePreset) => void;
  onFreshRegen: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  runningPreset?: RewritePreset | "fresh" | null;
  freeRerollsRemaining?: number | null;
}

export function RewriteControls({
  onPreset,
  onFreshRegen,
  disabled,
  isRunning,
  runningPreset,
  freeRerollsRemaining,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1.5">
      <button
        type="button"
        onClick={onFreshRegen}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
          "border-purple-400 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        title="Regenerate with fresh angle"
      >
        <RefreshCw
          className={cn("h-3 w-3", isRunning && runningPreset === "fresh" && "animate-spin")}
        />
        Regen
      </button>
      {PRESETS.map((p) => {
        const Icon = p.icon;
        const active = isRunning && runningPreset === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onPreset(p.value)}
            disabled={disabled}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
              "border-muted-foreground/30 text-muted-foreground hover:border-purple-400 hover:text-purple-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              active && "border-purple-500 text-purple-700 bg-purple-50",
            )}
            title={`Rewrite: ${p.label}`}
          >
            <Icon className={cn("h-3 w-3", active && "animate-spin")} />
            {p.label}
          </button>
        );
      })}
      {typeof freeRerollsRemaining === "number" && (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {freeRerollsRemaining > 0
            ? `${freeRerollsRemaining} free reroll${freeRerollsRemaining === 1 ? "" : "s"} today`
            : "Next reroll: 1 credit"}
        </span>
      )}
    </div>
  );
}
