"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import type { RepurposeFormats } from "@/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Options {
  saveId: string | null;
  formats: RepurposeFormats | null;
  /** ms debounce between formats change and PATCH */
  delay?: number;
  /** disable autosave entirely (e.g. first render or mid-regenerate) */
  enabled?: boolean;
}

/**
 * Debounced PATCH of the repurpose save whenever `formats` changes.
 * Skips the first render (initial load). Never throws; surfaces status via state.
 */
export function useRepurposeAutosave({
  saveId,
  formats,
  delay = 1500,
  enabled = true,
}: Options) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const firstRunRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset "first run" tracking when the underlying save changes
    firstRunRef.current = true;
    setStatus("idle");
  }, [saveId]);

  useEffect(() => {
    if (!enabled || !saveId || !formats) return;

    // Skip first mount of a given save — `formats` was just loaded, not edited
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (inFlightRef.current) inFlightRef.current.abort();
      const ctrl = new AbortController();
      inFlightRef.current = ctrl;
      setStatus("saving");
      try {
        await api.patch(
          `/api/repurpose/saves/${saveId}`,
          { formats },
          { signal: ctrl.signal },
        );
        setStatus("saved");
        setLastSavedAt(new Date());
      } catch (err: unknown) {
        const e = err as { name?: string; code?: string };
        if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
        setStatus("error");
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [saveId, formats, delay, enabled]);

  return { status, lastSavedAt };
}
