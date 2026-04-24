"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Lightweight controlled collapsible — no Radix dependency.
 * Trigger button toggles `open`; children are conditionally rendered.
 */
export function Collapsible({
  open,
  onOpenChange,
  trigger,
  children,
  className,
}: CollapsibleProps) {
  return (
    <div className={cn("rounded-lg border bg-muted/20", className)}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/40 rounded-lg transition"
        aria-expanded={open}
      >
        <span className="flex-1">{trigger}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}
