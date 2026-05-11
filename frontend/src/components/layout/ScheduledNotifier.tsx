"use client";

import { useScheduledNotifications } from "@/hooks/use-scheduled-notifications";

/**
 * Invisible component — just activates the scheduled-post notification hook.
 * Mounted once inside the dashboard layout so it runs on every dashboard page.
 */
export function ScheduledNotifier() {
  useScheduledNotifications();
  return null;
}
