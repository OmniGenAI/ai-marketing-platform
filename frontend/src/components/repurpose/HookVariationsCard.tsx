"use client";

import { Sparkles, Copy, Zap, BarChart3, BookOpen, Megaphone, HelpCircle } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HookStyle, HookVariant } from "@/types";

const STYLE_META: Record<HookStyle, { label: string; icon: React.ElementType; accent: string }> = {
  curiosity: { label: "Curiosity", icon: HelpCircle, accent: "text-purple-600 bg-purple-50 border-purple-200" },
  contrarian: { label: "Contrarian", icon: Zap, accent: "text-amber-600  bg-amber-50  border-amber-200" },
  data: { label: "Data", icon: BarChart3, accent: "text-sky-600    bg-sky-50    border-sky-200" },
  story: { label: "Story", icon: BookOpen, accent: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  bold: { label: "Bold", icon: Megaphone, accent: "text-rose-600   bg-rose-50   border-rose-200" },
};

interface Props {
  hooks: HookVariant[];
  onUseInLinkedIn?: (text: string) => void;
  onUseInTwitter?: (text: string) => void;
}

export function HookVariationsCard({ hooks, onUseInLinkedIn, onUseInTwitter }: Props) {
  if (!hooks || hooks.length === 0) return null;

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} hook copied!`);
  };

  return (
    <Card className="border-purple-300 bg-gradient-to-br from-purple-100/60 to-transparent gap-3">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-600" />
          Hook Variations
          <Badge variant="outline" className="ml-1">{hooks.length}</Badge>
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            Pick the strongest opening angle
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hooks.map((h, i) => {
          const meta = STYLE_META[h.style];
          const Icon = meta.icon;
          return (
            <div
              key={`${h.style}-${i}`}
              className="group rounded-md border bg-background p-3 transition hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0",
                    meta.accent
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </div>
                {typeof h.score === "number" && h.score > 0 && <HookScoreBar score={h.score} />}

                <div className="flex gap-1.5 justify-end ml-auto opacity-0 group-hover:opacity-100 transition">
                  {onUseInLinkedIn && (
                    <button
                      type="button"
                      className="text-[10px] font-medium text-muted-foreground hover:text-purple-700 underline underline-offset-2"
                      onClick={() => {
                        onUseInLinkedIn(h.text);
                        toast.success("Swapped into LinkedIn");
                      }}
                    >
                      Use in LinkedIn
                    </button>
                  )}
                  {onUseInTwitter && (
                    <button
                      type="button"
                      className="text-[10px] font-medium text-muted-foreground hover:text-purple-700 underline underline-offset-2"
                      onClick={() => {
                        onUseInTwitter(h.text);
                        toast.success("Swapped into Twitter thread");
                      }}
                    >
                      Use in Twitter
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed mt-1.5 ">
                {h.text}
                <button
                  type="button"
                  className="ml-4 opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-foreground"
                  onClick={() => copy(h.text, meta.label)}
                  title="Copy hook"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function HookScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  let color = "bg-red-500";
  let label = "Weak";
  if (clamped >= 75) {
    color = "bg-emerald-500";
    label = "Strong";
  } else if (clamped >= 55) {
    color = "bg-amber-500";
    label = "OK";
  }
  return (
    <span className="flex items-center gap-1.5" title={`${label} hook — score ${clamped}/100`}>
      <span className="relative h-1.5 w-12 rounded-full bg-muted overflow-hidden">
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", color)}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
        {clamped}
      </span>
    </span>
  );
}
