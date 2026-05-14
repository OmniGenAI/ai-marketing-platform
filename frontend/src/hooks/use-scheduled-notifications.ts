"use client";

/**
 * useScheduledNotifications
 * -------------------------
 * Polls /api/calendar for every scheduled item (posts AND reels) and fires
 * sonner toasts + browser push notifications 10 min and 5 min before each
 * item's scheduled publish time, plus a "Published!" toast when a scheduled
 * item flips to published.
 *
 * - Uses a ref + localStorage to track which (itemId + threshold) pairs have
 *   already fired so notifications never repeat across refreshes within the
 *   same browser.
 * - Requests Notification permission once on mount (silently — no prompt if
 *   the user has already granted or denied).
 * - Polls every 30 seconds so reminders never miss their window by more
 *   than the poll interval.
 *
 * Trigger semantics: a reminder fires whenever `remaining <= threshold`
 * AND it hasn't fired before. That means opening the page mid-window (e.g.
 * with 8 min remaining) will still show the 10-min reminder once — fixing
 * the previous bug where the narrow ±60s window meant reminders silently
 * dropped if the page wasn't already open at the exact threshold minute.
 */

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import api from "@/lib/api";

const THRESHOLDS_MS = [10 * 60 * 1000, 5 * 60 * 1000]; // 10 min, 5 min
const POLL_INTERVAL_MS = 30_000; // check every 30s

// localStorage key for the dedupe set. Keeps reminders from firing twice if
// the user refreshes the page right after a reminder appears.
const NOTIFIED_STORAGE_KEY = "scheduled-notifs-fired-v1";

// A scheduled-or-published calendar item, narrowed to the fields we need.
interface CalendarItemLite {
  id: string;
  type: "post" | "reel" | "poster" | "blog";
  title: string;
  platform: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  content: string | null;
}

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: "📘",
  instagram: "📸",
  linkedin: "💼",
  youtube: "🎬",
  reddit: "🟠",
  devto: "👩‍💻",
  twitter: "🐦",
  threads: "🧵",
};

const TYPE_EMOJI: Record<string, string> = {
  post: "📝",
  reel: "🎬",
  poster: "🖼️",
  blog: "📰",
};

function emojiFor(item: CalendarItemLite): string {
  if (item.platform) {
    const e = PLATFORM_EMOJI[item.platform.toLowerCase()];
    if (e) return e;
  }
  return TYPE_EMOJI[item.type] ?? "📢";
}

function targetLabel(item: CalendarItemLite): string {
  return item.platform ?? item.type;
}

function minuteLabel(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

/** Strip emojis, HTML, and collapse whitespace so previews read cleanly. */
function cleanPreview(text: string | null | undefined, maxLen = 60): string {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function loadFiredSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistFiredSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    // Cap the persisted set so it doesn't grow unbounded across weeks.
    const arr = Array.from(set).slice(-500);
    window.localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore quota errors */
  }
}

function pushBrowserNotification(title: string, body: string, tag: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico", tag });
  } catch {
    /* some browsers throw when called outside a user gesture — non-fatal */
  }
}

export function useScheduledNotifications() {
  // Persisted dedupe set so a refresh doesn't re-fire reminders.
  const notifiedRef = useRef<Set<string>>(new Set());
  // Map of itemId → last known status so we can detect "scheduled" → "published" transitions.
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  const markFired = useCallback((key: string) => {
    notifiedRef.current.add(key);
    persistFiredSet(notifiedRef.current);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }, []);

  const firePublishedNotification = useCallback((item: CalendarItemLite) => {
    const emoji = emojiFor(item);
    const target = targetLabel(item);
    const previewSrc = item.content ?? item.title ?? "";
    const preview = cleanPreview(previewSrc);
    const ellipsis = previewSrc.length > 60 ? "…" : "";

    toast.success(`${emoji} Published to ${target}!`, {
      description: preview ? `"${preview}${ellipsis}"` : undefined,
      duration: 10_000,
      action: {
        label: "View Calendar",
        onClick: () => { window.location.href = "/calendar"; },
      },
    });

    pushBrowserNotification(
      `${emoji} ${item.type === "reel" ? "Reel" : "Post"} published — ${target}`,
      preview ? `"${preview}${ellipsis}"` : item.title,
      `published-${item.id}`,
    );
  }, []);

  const fireReminder = useCallback(
    (item: CalendarItemLite, threshold: number) => {
      const emoji = emojiFor(item);
      const target = targetLabel(item);
      const label = minuteLabel(threshold);
      const previewSrc = item.content ?? item.title ?? "";
      const preview = cleanPreview(previewSrc);
      const ellipsis = previewSrc.length > 60 ? "…" : "";
      const verb = item.type === "reel" ? "Posting reel" : "Posting";

      toast(`⏰ ${verb} to ${target} in ${label}`, {
        description: preview ? `${emoji} "${preview}${ellipsis}"` : emoji,
        duration: threshold === 5 * 60 * 1000 ? 12_000 : 8_000,
        action: {
          label: "View Calendar",
          onClick: () => { window.location.href = "/calendar"; },
        },
      });

      pushBrowserNotification(
        `⏰ ${verb} to ${target} in ${label}`,
        preview ? `${emoji} "${preview}${ellipsis}"` : emoji,
        `${item.id}-${threshold}`,
      );
    },
    [],
  );

  const checkAndNotify = useCallback(async () => {
    try {
      // Fetch current + next month so reminders work across month boundaries
      // (e.g. it's May 31 and the next scheduled item is June 1).
      const today = new Date();
      const months: Array<[number, number]> = [
        [today.getFullYear(), today.getMonth() + 1],
      ];
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      months.push([next.getFullYear(), next.getMonth() + 1]);

      const responses = await Promise.all(
        months.map(([y, m]) =>
          api
            .get<CalendarItemLite[]>("/api/calendar", { params: { year: y, month: m } })
            .then((r) => r.data)
            .catch(() => [] as CalendarItemLite[]),
        ),
      );
      // De-dupe items that appear in both months.
      const byId = new Map<string, CalendarItemLite>();
      for (const list of responses) for (const it of list) byId.set(it.id, it);
      const items = Array.from(byId.values()).filter(
        (i) => i.type === "post" || i.type === "reel",
      );
      const now = Date.now();

      for (const item of items) {
        const prevStatus = prevStatusRef.current.get(item.id);
        // Detect scheduled → published transition (fired by the backend
        // scheduler when the item actually goes live).
        if (prevStatus === "scheduled" && item.status === "published") {
          const key = `published-${item.id}`;
          if (!notifiedRef.current.has(key)) {
            markFired(key);
            firePublishedNotification(item);
          }
        }
        prevStatusRef.current.set(item.id, item.status);
      }

      // Upcoming reminders — fire when remaining time crosses a threshold.
      // We trigger if `remaining <= threshold` AND haven't already fired this
      // (item, threshold) pair. The persisted dedupe set prevents repeats.
      const scheduled = items.filter(
        (i) => i.status === "scheduled" && i.scheduled_at,
      );
      for (const item of scheduled) {
        const scheduledAt = new Date(item.scheduled_at!).getTime();
        const remaining = scheduledAt - now;
        if (remaining <= 0) continue; // already past — backend will handle

        for (const threshold of THRESHOLDS_MS) {
          if (remaining > threshold) continue; // not close enough yet
          const key = `${item.id}-${threshold}`;
          if (notifiedRef.current.has(key)) continue;
          markFired(key);
          fireReminder(item, threshold);
        }
      }
    } catch {
      // Silently ignore — user may be unauthenticated or offline
    }
  }, [firePublishedNotification, fireReminder, markFired]);

  useEffect(() => {
    // Hydrate the dedupe set from localStorage before the first poll.
    notifiedRef.current = loadFiredSet();
    requestPermission();
    checkAndNotify();

    const interval = setInterval(checkAndNotify, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [requestPermission, checkAndNotify]);
}
