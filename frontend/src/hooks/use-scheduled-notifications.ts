"use client";

/**
 * useScheduledNotifications
 * -------------------------
 * Polls /api/posts for scheduled posts and fires toast + browser push
 * notifications 10 min and 5 min before each post's scheduled_at time.
 *
 * - Uses a ref to track which (postId + threshold) pairs have already fired
 *   so notifications never repeat within the same browser session.
 * - Requests Notification permission once on mount (silently — no prompt if
 *   the user has already granted or denied).
 * - Polls every 60 seconds to stay in sync with newly scheduled posts.
 */

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Post } from "@/types";

const THRESHOLDS_MS = [10 * 60 * 1000, 5 * 60 * 1000]; // 10 min, 5 min
const POLL_INTERVAL_MS = 60_000; // check every minute

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: "📘",
  instagram: "📸",
  linkedin: "💼",
  youtube: "🎬",
  reddit: "🟠",
  devto: "👩‍💻",
};

function platformEmoji(platform: string): string {
  return PLATFORM_EMOJI[platform.toLowerCase()] ?? "📢";
}

function minuteLabel(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

/** Strip emojis and control characters so post content previews read cleanly. */
function cleanPreview(text: string, maxLen = 60): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function useScheduledNotifications() {
  // Set of "<postId>-<thresholdMs>" strings already notified this session.
  const notifiedRef = useRef<Set<string>>(new Set());
  // Map of postId → last known status so we can detect "scheduled" → "published" transitions.
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }, []);

  const firePublishedNotification = useCallback((post: Post) => {
    const emoji = platformEmoji(post.platform);
    const preview = cleanPreview(post.content);
    const ellipsis = post.content.length > 60 ? "…" : "";

    toast.success(`${emoji} Published to ${post.platform}!`, {
      description: `"${preview}${ellipsis}"`,
      duration: 10_000,
      action: {
        label: "View Calendar",
        onClick: () => { window.location.href = "/calendar"; },
      },
    });

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(`${emoji} Post published — ${post.platform}`, {
        body: `"${preview}${ellipsis}"`,
        icon: "/favicon.ico",
        tag: `published-${post.id}`,
      });
    }
  }, []);

  const checkAndNotify = useCallback(async () => {
    try {
      const res = await api.get<Post[]>("/api/posts");
      const now = Date.now();

      for (const post of res.data) {
        const prevStatus = prevStatusRef.current.get(post.id);

        // Detect scheduled → published transition
        if (prevStatus === "scheduled" && post.status === "published") {
          const key = `published-${post.id}`;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            firePublishedNotification(post);
          }
        }

        // Always update the tracked status
        prevStatusRef.current.set(post.id, post.status);
      }

      // Upcoming reminders — 10 min and 5 min warnings
      const scheduled = res.data.filter((p) => p.status === "scheduled" && p.scheduled_at);
      for (const post of scheduled) {
        const scheduledAt = new Date(post.scheduled_at!).getTime();
        const remaining = scheduledAt - now;

        for (const threshold of THRESHOLDS_MS) {
          if (remaining > 0 && remaining <= threshold + POLL_INTERVAL_MS && remaining > threshold - POLL_INTERVAL_MS) {
            const key = `${post.id}-${threshold}`;
            if (notifiedRef.current.has(key)) continue;
            notifiedRef.current.add(key);

            const emoji = platformEmoji(post.platform);
            const label = minuteLabel(threshold);
            const preview = cleanPreview(post.content);
            const ellipsis = post.content.length > 60 ? "…" : "";

            toast(`⏰ Posting to ${post.platform} in ${label}`, {
              description: `${emoji} "${preview}${ellipsis}"`,
              duration: threshold === 5 * 60 * 1000 ? 12_000 : 8_000,
              action: {
                label: "View Calendar",
                onClick: () => { window.location.href = "/calendar"; },
              },
            });

            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              new Notification(`⏰ Posting to ${post.platform} in ${label}`, {
                body: `${emoji} "${preview}${ellipsis}"`,
                icon: "/favicon.ico",
                tag: key,
              });
            }
          }
        }
      }
    } catch {
      // Silently ignore — user may be unauthenticated or offline
    }
  }, [firePublishedNotification]);

  useEffect(() => {
    requestPermission();
    checkAndNotify();

    const interval = setInterval(checkAndNotify, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [requestPermission, checkAndNotify]);
}
