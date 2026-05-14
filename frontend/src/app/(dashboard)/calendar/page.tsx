"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  MessageSquare,
  Code2,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  Trash2,
  CheckCheck,
  Film,
  Image as ImageIcon,
  BookOpen,
  Play,
  RefreshCw,
  Edit2,
  Calendar as CalendarIcon,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker, isPastDateTime } from "@/components/ui/date-time-picker";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Post } from "@/types";
import { cn } from "@/lib/utils";

// Minimal draft shape used by the "New Post" modal's drafts list.
interface DraftItem {
  id: string;
  title: string;
  subtitle?: string;
  created_at: string;
}

// Unified calendar item returned by /api/calendar
export interface CalendarItem {
  id: string;
  type: "post" | "reel" | "poster" | "blog";
  date: string;
  title: string;
  platform: string | null;
  status: string;
  image_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  content: string | null;
  hashtags: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  // Public URL of the published item on its platform (populated only after
  // a successful publish). Used by the calendar detail panel to render a
  // "View on …" link. Optional because not every code path that constructs
  // a CalendarItem locally (e.g. the "New Post" reschedule stub) has one.
  external_url?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Content-type config (reel / poster / blog)
// ---------------------------------------------------------------------------
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; color: string; border: string; iconColor: string; label: string }> = {
  reel:   { icon: <Film className="h-3 w-3" />,      bg: "bg-purple-600",  color: "text-white", border: "border-purple-400",  iconColor: "text-purple-500",  label: "Reel" },
  poster: { icon: <ImageIcon className="h-3 w-3" />, bg: "bg-amber-500",   color: "text-white", border: "border-amber-400",   iconColor: "text-amber-500",   label: "Poster" },
  blog:   { icon: <BookOpen className="h-3 w-3" />,  bg: "bg-emerald-600", color: "text-white", border: "border-emerald-400", iconColor: "text-emerald-600", label: "Blog" },
};

// New-post modal config — order-preserving record with larger icons + descriptions.
const TYPE_PICKER: Record<
  "post" | "reel" | "poster" | "blog",
  { icon: React.ReactNode; bg: string; label: string; description: string }
> = {
  post:   { icon: <FileText className="h-4 w-4" />,  bg: "bg-blue-500",    label: "Post",   description: "Caption + image for social feeds" },
  reel:   { icon: <Film className="h-4 w-4" />,      bg: "bg-purple-600",  label: "Reel",   description: "Short-form vertical video" },
  poster: { icon: <ImageIcon className="h-4 w-4" />, bg: "bg-amber-500",   label: "Poster", description: "Flyer or marketing graphic" },
  blog:   { icon: <BookOpen className="h-4 w-4" />,  bg: "bg-emerald-600", label: "Blog",   description: "Long-form SEO article" },
};

// ---------------------------------------------------------------------------
// Platform config
// ---------------------------------------------------------------------------
const PLATFORM_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string; label: string; border: string; iconColor: string }
> = {
  facebook: {
    icon: <Facebook className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#1877F2]",
    border: "border-[#1877F2]",
    iconColor: "text-[#1877F2]",
    label: "Facebook",
  },
  instagram: {
    icon: <Instagram className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#E4405F]",
    border: "border-[#E4405F]",
    iconColor: "text-[#E4405F]",
    label: "Instagram",
  },
  linkedin: {
    icon: <Linkedin className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#0A66C2]",
    border: "border-[#0A66C2]",
    iconColor: "text-[#0A66C2]",
    label: "LinkedIn",
  },
  youtube: {
    icon: <Youtube className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#FF0000]",
    border: "border-[#FF0000]",
    iconColor: "text-[#FF0000]",
    label: "YouTube",
  },
  reddit: {
    icon: <MessageSquare className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#FF4500]",
    border: "border-[#FF4500]",
    iconColor: "text-[#FF4500]",
    label: "Reddit",
  },
  devto: {
    icon: <Code2 className="h-3 w-3" />,
    color: "text-white",
    bg: "bg-[#0A0A0A]",
    border: "border-[#0A0A0A]",
    iconColor: "text-[#0A0A0A] dark:text-white",
    label: "Dev.to",
  },
};

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { icon: <FileText className="h-3 w-3" />, label: "Draft", variant: "secondary" },
  scheduled: { icon: <Clock className="h-3 w-3" />, label: "Scheduled", variant: "outline" },
  published: { icon: <CheckCircle2 className="h-3 w-3" />, label: "Published", variant: "default" },
  failed: { icon: <AlertCircle className="h-3 w-3" />, label: "Failed", variant: "destructive" },
};

// Feature flag — controls whether the calendar detail panel shows the
// primary "View on {platform}" button that deep-links into the published
// post. Toggle via NEXT_PUBLIC_ENABLE_VIEW_PUBLISHED_BUTTON in .env.local
// or the deployment environment. Defaults to ON when unset so existing
// setups keep the link visible without touching env files.
//
// Accepted truthy values (case-insensitive): "true", "1", "yes", "on".
// Anything else disables the button. NEXT_PUBLIC_* values are inlined at
// build / dev-server start, so restart `next dev` after toggling.
const SHOW_VIEW_PUBLISHED_BUTTON = (() => {
  const raw = process.env.NEXT_PUBLIC_ENABLE_VIEW_PUBLISHED_BUTTON;
  if (raw === undefined) return true;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  // 0=Sun … 6=Sat; we want Mon-first so shift
  const day = new Date(year, month, 1).getDay();
  return (day + 6) % 7; // Mon=0 … Sun=6
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function itemDate(item: CalendarItem): Date {
  return new Date(item.date);
}

function fmt(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(new Date(iso));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------
// Calendar item chip
// ---------------------------------------------------------------------------
function ItemChip({
  item,
  onClick,
  onDragStart,
  className,
}: {
  item: CalendarItem;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  className?: string;
}) {
  // For posts/reels: use platform colour; for poster/blog: use type colour
  const plt = item.platform ? PLATFORM_CONFIG[item.platform] : null;
  const typ = TYPE_CONFIG[item.type];
  const cfg = plt ?? typ ?? {
    icon: null, border: "border-border", iconColor: "text-foreground", label: item.type,
  };

  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "min-w-0 text-left text-xs leading-tight px-2 py-1.5 rounded-md flex items-center gap-1.5 cursor-grab active:cursor-grabbing",
        "bg-background border hover:opacity-80 transition-opacity",
        cfg.border,
        item.status === "failed" && "border-destructive opacity-60",
        className,
      )}
      title={item.title}
    >
      <span className={cn("shrink-0", cfg.iconColor)}>{cfg.icon}</span>
      <span className="truncate text-foreground font-medium">{item.title.slice(0, 28)}</span>
      {item.status === "published" && <CheckCheck className="h-3 w-3 shrink-0 ml-auto text-green-600" />}
      {item.status === "scheduled" && <Clock className="h-3 w-3 shrink-0 ml-auto text-muted-foreground" />}
      {item.status === "failed"    && <AlertCircle className="h-3 w-3 shrink-0 ml-auto text-destructive" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CalendarPage() {
  const router = useRouter();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Day detail sheet
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<{ day: number; items: CalendarItem[] } | null>(null);

  // Reschedule dialog
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reschedulePost, setReschedulePost] = useState<CalendarItem | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");

  // New-post modal (type picker -> drafts list)
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newPostType, setNewPostType] = useState<"post" | "reel" | "poster" | "blog" | null>(null);

  // Drag-and-drop
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const qc = useQueryClient();
  const calendarKey = ["calendar", year, month];

  // ---------------------------------------------------------------------------
  // Data fetching — React Query handles caching, background refresh, dedup
  // ---------------------------------------------------------------------------
  const { data: items = [], isFetching: loading, refetch } = useQuery<CalendarItem[]>({
    queryKey: calendarKey,
    queryFn: async () => {
      const res = await api.get<CalendarItem[]>("/api/calendar", {
        params: { year, month: month + 1 },
      });
      return res.data;
    },
    staleTime: 30 * 1000,           // fresh for 30s
    refetchInterval: 2 * 60 * 1000, // auto-refresh every 2 min (catches scheduler publishes)
    refetchOnWindowFocus: true,
  });

  // ---------------------------------------------------------------------------
  // Publish mutation
  // ---------------------------------------------------------------------------
  const publishMutation = useMutation({
    mutationFn: async (item: CalendarItem) => {
      const res = await api.post<Post>(`/api/posts/${item.id}/publish`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKey });
      toast.success("Post published!");
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err.response?.data?.detail ?? "Publish failed");
    },
  });

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  // ---------------------------------------------------------------------------
  // Calendar grid data
  // ---------------------------------------------------------------------------
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month); // 0=Mon
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  function itemsForDay(day: number): CalendarItem[] {
    const target = new Date(year, month, day);
    return items.filter((item) => isSameDay(itemDate(item), target));
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const handlePublish = (item: CalendarItem) => {
    if (item.type !== "post") { toast.error("Only social posts can be published from here"); return; }
    publishMutation.mutate(item);
  };
  const publishingId = publishMutation.isPending ? publishMutation.variables?.id ?? null : null;

  const handleDelete = async (item: CalendarItem) => {
    if (!confirm("Delete this? This cannot be undone.")) return;
    setDeletingId(item.id);
    const endpoint = item.type === "post" ? `/api/posts/${item.id}`
      : item.type === "reel" ? `/api/reels/${item.id}`
      : item.type === "poster" ? `/api/posters/${item.id}`
      : `/api/seo/saves/${item.id}`;
    try {
      await api.delete(endpoint);
      qc.invalidateQueries({ queryKey: calendarKey });
      setSheetOpen(false);
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  const openReschedule = (item: CalendarItem) => {
    setReschedulePost(item);
    const base = item.scheduled_at
      ? new Date(item.scheduled_at)
      : new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setRescheduleValue(
      `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`
    );
    setRescheduleOpen(true);
  };

  const submitReschedule = async () => {
    if (!reschedulePost || !rescheduleValue) return;

    // Reject past dates so the scheduler doesn't fire instantly. Bail before
    // the network call so the user gets immediate feedback.
    const picked = new Date(rescheduleValue);
    if (Number.isNaN(picked.getTime())) {
      toast.error("Invalid date/time");
      return;
    }
    if (picked.getTime() <= Date.now()) {
      toast.error("Please pick a future date and time.");
      return;
    }

    try {
      const iso = picked.toISOString();
      await api.patch(`/api/calendar/${reschedulePost.type}/${reschedulePost.id}/reschedule`, {
        scheduled_at: iso,
      });
      qc.invalidateQueries({ queryKey: calendarKey });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      setRescheduleOpen(false);
      toast.success("Scheduled");
    } catch {
      toast.error("Failed to reschedule");
    }
  };

  // ---------------------------------------------------------------------------
  // Drafts query — populated when user opens "New Post" modal and picks a type
  // ---------------------------------------------------------------------------
  const { data: drafts = [], isFetching: draftsLoading } = useQuery<DraftItem[]>({
    queryKey: ["drafts", newPostType],
    enabled: !!newPostType,
    queryFn: async () => {
      if (!newPostType) return [];
      if (newPostType === "post") {
        const res = await api.get<Post[]>("/api/posts");
        return res.data
          .filter(p => p.status === "draft")
          .map(p => ({
            id: p.id,
            title: (p.content || "Untitled").replace(/<[^>]+>/g, " ").slice(0, 80),
            subtitle: p.platform || undefined,
            created_at: p.created_at,
          }));
      }
      if (newPostType === "reel") {
        const res = await api.get<Array<{ id: string; topic: string; status: string; created_at: string }>>("/api/reels");
        return res.data
          .filter(r => r.status !== "published" && !["pending", "generating", "rendering"].includes(r.status))
          .map(r => ({
            id: r.id,
            title: r.topic || "Untitled reel",
            subtitle: r.status,
            created_at: r.created_at,
          }));
      }
      if (newPostType === "poster") {
        const res = await api.get<Array<{ id: string; title: string; status: string; created_at: string }>>("/api/posters");
        return res.data
          .filter(p => p.status === "draft")
          .map(p => ({
            id: p.id,
            title: p.title || "Untitled poster",
            subtitle: undefined,
            created_at: p.created_at,
          }));
      }
      // blog
      const res = await api.get<Array<{ id: string; title: string; type: string; updated_at: string; data: Record<string, unknown> }>>("/api/seo/saves");
      return res.data
        .filter(s => !((s.data as { scheduledAt?: string })?.scheduledAt))
        .map(s => ({
          id: s.id,
          title: s.title || "Untitled draft",
          subtitle: s.type,
          created_at: s.updated_at,
        }));
    },
  });

  const newRouteFor = (t: "post" | "reel" | "poster" | "blog"): string => {
    if (t === "post") return "/generate/social/new";
    if (t === "reel") return "/generate/reel";
    if (t === "poster") return "/generate/poster/new";
    return "/seo/editor";
  };

  const handlePickDraft = (id: string) => {
    if (!newPostType) return;
    // Convert draft into a CalendarItem-like shape so we can reuse the reschedule dialog.
    const draft = drafts.find(d => d.id === id);
    if (!draft) return;
    setReschedulePost({
      id: draft.id,
      type: newPostType,
      date: new Date().toISOString(),
      title: draft.title,
      platform: null,
      status: "draft",
      image_url: null,
      video_url: null,
      thumbnail_url: null,
      content: null,
      hashtags: null,
      scheduled_at: null,
      published_at: null,
      created_at: draft.created_at,
    });
    const base = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setRescheduleValue(
      `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`
    );
    setNewPostOpen(false);
    setRescheduleOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Drag and drop (posts only)
  // ---------------------------------------------------------------------------
  const handleDrop = async (day: number) => {
    if (!draggingId) return;
    setDragOverDay(null);
    const dragged = items.find(p => p.id === draggingId);
    if (!dragged) { setDraggingId(null); return; }

    const base = new Date(dragged.date);
    const target = new Date(year, month, day, base.getHours(), base.getMinutes());
    if (isSameDay(target, base)) { setDraggingId(null); return; }

    const iso = target.toISOString();
    const label = target.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    try {
      // Unified reschedule endpoint handles all types
      await api.patch(`/api/calendar/${dragged.type}/${draggingId}/reschedule`, {
        scheduled_at: iso,
      });
      qc.invalidateQueries({ queryKey: calendarKey });
      toast.success(`Rescheduled to ${label}`);
    } catch {
      toast.error("Failed to reschedule");
    } finally {
      setDraggingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full gap-3 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Content Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Schedule, preview and manage all your posts
          </p>
        </div>
        <Button
          onClick={() => { setNewPostType(null); setNewPostOpen(true); }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New Post
        </Button>
      </div>

      {/* Month navigation + legend */}
      <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xl font-bold min-w-48 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={loading}
            title="Refresh"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : <RefreshCw className="h-4 w-4 text-muted-foreground" />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
            <span key={key} className={cn("inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium", cfg.bg, cfg.color)}>
              {cfg.icon} {cfg.label}
            </span>
          ))}
          {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
            <span key={key} className={cn("inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium", cfg.bg, cfg.color)}>
              {cfg.icon} {cfg.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
            <Clock className="h-3 w-3" /> Scheduled
          </span>
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
            <CheckCircle2 className="h-3 w-3" /> Published
          </span>
        </div>
      </div>

      {/* Calendar grid — flex-1 so it fills remaining height */}
      <div className="rounded-xl border overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 bg-muted/50 border-b shrink-0">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-sm font-semibold py-3 text-muted-foreground tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 flex-1 overflow-y-auto" style={{ gridAutoRows: 'minmax(8rem, auto)' }}>
          {Array.from({ length: totalCells }).map((_, idx) => {
            const day = idx - firstDay + 1;
            const isCurrentMonth = day >= 1 && day <= daysInMonth;
            const isToday =
              isCurrentMonth &&
              isSameDay(new Date(year, month, day), today);
            const isPast =
              isCurrentMonth &&
              !isToday &&
              new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const dayPosts = isCurrentMonth ? itemsForDay(day) : [];
            const isOver = dragOverDay === day && isCurrentMonth;

            return (
              <div
                key={idx}
                className={cn(
                  "border-b border-r flex justify-end transition-colors",
                  !isCurrentMonth && "bg-muted/20",
                  isPast && "bg-muted/40",
                  isOver && "bg-primary/5 ring-2 ring-inset ring-primary",
                  isCurrentMonth && "hover:bg-sky-50/30",
                )}
                onDragOver={(e) => { e.preventDefault(); if (isCurrentMonth) setDragOverDay(day); }}
                onDragLeave={() => setDragOverDay(null)}
                onDrop={(e) => { e.preventDefault(); if (isCurrentMonth) handleDrop(day); }}
              >
                {/* Scrollable chips area — all chips visible, drag-and-drop works on each */}
                {isCurrentMonth && dayPosts.length > 0 && (
                  <div
                    className="overflow-y-auto h-full pl-1.5 py-1.5 flex flex-col gap-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {dayPosts.map(item => (
                      <ItemChip
                        key={item.id}
                        item={item}
                        className="w-full shrink-0"
                        onClick={() => { setSelectedItem(item); setSheetOpen(true); }}
                        onDragStart={(e) => { e.stopPropagation(); setDraggingId(item.id); e.dataTransfer.effectAllowed = "move"; }}
                      />
                    ))}
                  </div>
                )}

                {/* Day number row — click empty area to create post */}
                <div
                  className={cn("flex justify-end px-1.5 pt-1 shrink-0", isCurrentMonth && "cursor-pointer")}
                  onClick={() => {
                    if (!isCurrentMonth) return;
                    if (dayPosts.length === 0) {
                      const date = new Date(year, month, day);
                      const pad = (n: number) => String(n).padStart(2, "0");
                      router.push(`/generate/social/new?scheduled_date=${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
                    } else {
                      setSelectedDay({ day, items: dayPosts });
                      setDaySheetOpen(true);
                    }
                  }}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full",
                      isToday && "bg-primary text-primary-foreground",
                      isPast && "text-muted-foreground/50",
                      !isToday && !isPast && isCurrentMonth && "text-foreground",
                      !isCurrentMonth && "text-muted-foreground/40",
                    )}
                  >
                    {isCurrentMonth ? day : ""}
                  </span>
                </div>

                
              </div>
            );
          })}
        </div>
      </div>

      {/* Post detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedItem?.title ?? "Post Detail"}</SheetTitle>
          </SheetHeader>
          {selectedItem && (() => {
            const plt = selectedItem.platform ? PLATFORM_CONFIG[selectedItem.platform] : null;
            const typ = TYPE_CONFIG[selectedItem.type];
            const badge = plt ?? typ;
            const sts = STATUS_CONFIG[selectedItem.status] ?? STATUS_CONFIG.draft;
            return (
              <div className="relative flex flex-col h-full overflow-y-auto scrollbar-thin">
                {/* Reel: video player at top */}
                {selectedItem.type === "reel" && selectedItem.video_url ? (
                  <div className="w-full shrink-0 bg-black">
                    <video
                      src={selectedItem.video_url}
                      poster={selectedItem.thumbnail_url ?? undefined}
                      controls
                      className="w-full max-h-64 object-contain"
                    />
                  </div>
                ) : selectedItem.image_url ? (
                  <div className="w-full shrink-0 overflow-hidden">
                    <img
                      src={selectedItem.image_url}
                      alt=""
                      className="w-full max-h-fit object-cover"
                    />
                  </div>
                ) : (
                  <div className={cn("w-full h-16 shrink-0", badge?.bg ?? "bg-muted")} />
                )}

                {/* Scrollable body */}
                <div className="flex-1  px-5 py-4 space-y-4">

                  {/* Type + platform + status row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {badge && (
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", badge.bg, badge.color)}>
                        {badge.icon} {badge.label}
                      </span>
                    )}
                    <Badge variant={sts.variant} className="gap-1">
                      {sts.icon} {sts.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {fmt(selectedItem.created_at)}
                    </span>
                  </div>

                  {/* Time info */}
                  {(selectedItem.scheduled_at || selectedItem.published_at) && (
                    <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm space-y-1">
                      {selectedItem.scheduled_at && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Scheduled:</span>
                          <span className="font-medium">{fmt(selectedItem.scheduled_at)}</span>
                          {selectedItem.status !== "published" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 ml-auto gap-1 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                              onClick={() => openReschedule(selectedItem)}
                            >
                              <Edit2 className="h-3 w-3" />
                              Edit
                            </Button>
                          )}
                        </div>
                      )}
                      {selectedItem.published_at && (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="text-muted-foreground">Published:</span>
                          <span className="font-medium">{fmt(selectedItem.published_at)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Content */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Content</p>
                    {selectedItem.type === "blog" && selectedItem.content ? (
                      <div
                        className="prose prose-sm max-w-none text-foreground [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1"
                        dangerouslySetInnerHTML={{ __html: selectedItem.content }}
                      />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {selectedItem.content?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                      </p>
                    )}
                  </div>

                  {/* Hashtags */}
                  {selectedItem.hashtags && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Hashtags</p>
                      <p className="text-xs text-primary/80 leading-relaxed">{selectedItem.hashtags}</p>
                    </div>
                  )}
                </div>

                {/* Sticky action bar */}
                <div className="shrink-0 w-full fixed bottom-0 border-t px-5 py-3 flex items-center gap-2 bg-background flex-wrap">
                  {/* "View on {platform}" — only shown for published items
                       that came back from the backend with an external_url,
                       AND when the SHOW_VIEW_PUBLISHED_BUTTON flag is on.
                       Opens the live post on the platform in a new tab. */}
                  {SHOW_VIEW_PUBLISHED_BUTTON
                    && selectedItem.status === "published"
                    && selectedItem.external_url && (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      asChild
                    >
                      <a
                        href={selectedItem.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        View on {selectedItem.platform
                          ? selectedItem.platform.charAt(0).toUpperCase() + selectedItem.platform.slice(1)
                          : "platform"}
                      </a>
                    </Button>
                  )}
                  {/* Open in editor — always available so users can tweak
                       the source even after publishing. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setSheetOpen(false);
                      const id = selectedItem.id;
                      if (selectedItem.type === "post")   router.push(`/generate/social/new?id=${id}`);
                      else if (selectedItem.type === "blog")   router.push(`/seo/editor?draft=${id}`);
                      else if (selectedItem.type === "reel")   router.push(`/generate/reel`);
                      else if (selectedItem.type === "poster") router.push(`/generate/poster/new?id=${id}`);
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in editor
                  </Button>
                  {selectedItem.type === "post" && (selectedItem.status === "draft" || selectedItem.status === "scheduled") && (
                    <Button
                      size="sm"
                      onClick={() => handlePublish(selectedItem)}
                      disabled={!!publishingId}
                      className="gap-1.5"
                    >
                      {publishingId === selectedItem.id
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…</>
                        : <><ExternalLink className="h-3.5 w-3.5" /> Publish Now</>
                      }
                    </Button>
                  )}

                  {selectedItem.type === "post" && selectedItem.status !== "published" && (
                    <Button size="sm" variant="outline" onClick={() => openReschedule(selectedItem)} className="gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {selectedItem.scheduled_at ? "Reschedule" : "Schedule"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(selectedItem)}
                    disabled={!!deletingId}
                  >
                    {deletingId === selectedItem.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />
                    }
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* New Post modal — type picker -> drafts list */}
      <Dialog
        open={newPostOpen}
        onOpenChange={(open) => { setNewPostOpen(open); if (!open) setNewPostType(null); }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {newPostType ? `Schedule a ${TYPE_PICKER[newPostType].label}` : "What do you want to schedule?"}
            </DialogTitle>
            <DialogDescription>
              {newPostType
                ? "Pick an unpublished draft below, or create a new one."
                : "Choose a content type to continue."}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1 — type grid */}
          {!newPostType && (
            <div className="grid grid-cols-2 gap-2 py-2">
              {(["post", "reel", "poster", "blog"] as const).map((t) => {
                const cfg = TYPE_PICKER[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewPostType(t)}
                    className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left hover:border-purple-300 hover:bg-purple-50/50 transition-colors"
                  >
                    <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md", cfg.bg)}>
                      <span className="text-white">{cfg.icon}</span>
                    </span>
                    <span className="text-sm font-semibold">{cfg.label}</span>
                    <span className="text-xs text-muted-foreground">{cfg.description}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2 — drafts list + create-new */}
          {newPostType && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Unpublished {TYPE_PICKER[newPostType].label}s
                </p>
                <Button variant="ghost" size="sm" onClick={() => setNewPostType(null)} className="h-7 text-xs">
                  <ChevronLeft className="h-3 w-3" /> Back
                </Button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5 -mx-1 px-1">
                {draftsLoading && (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading drafts…
                  </div>
                )}
                {!draftsLoading && drafts.length === 0 && (
                  <div className="rounded-lg border border-dashed py-6 text-center">
                    <p className="text-sm text-muted-foreground">No drafts yet.</p>
                  </div>
                )}
                {!draftsLoading && drafts.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handlePickDraft(d.id)}
                    className="w-full text-left rounded-lg border p-2.5 hover:border-purple-300 hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-sm font-medium line-clamp-1">{d.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                      {d.subtitle ? `${d.subtitle} • ` : ""}
                      {new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>

              <Button
                onClick={() => {
                  if (!newPostType) return;
                  setNewPostOpen(false);
                  router.push(newRouteFor(newPostType));
                }}
                className="w-full gap-1.5 mt-2 bg-purple-500 hover:bg-purple-600 text-white"
              >
                <Plus className="h-4 w-4" />
                Create new {TYPE_PICKER[newPostType].label.toLowerCase()}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reschedule dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Post</DialogTitle>
            <DialogDescription>
              Pick a date and time. The scheduler will auto-publish at this time (your local timezone).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="schedule-dt">Date & Time</Label>
            {/* DateTimePicker shows its own inline past-time warning. */}
            <DateTimePicker value={rescheduleValue} onChange={setRescheduleValue} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitReschedule}
              disabled={!rescheduleValue || isPastDateTime(rescheduleValue)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Day detail sheet — all posts for a clicked day */}
      <Sheet open={daySheetOpen} onOpenChange={setDaySheetOpen}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
          {/* Header — gradient banner with date + actions */}
          <SheetHeader className="shrink-0 px-6 pt-6 pb-4 border-b bg-linear-to-br from-purple-50 via-fuchsia-50/60 to-rose-50/40">
            {(() => {
              const dayDate = selectedDay
                ? new Date(year, month, selectedDay.day)
                : null;
              const weekday = dayDate
                ? dayDate.toLocaleDateString(undefined, { weekday: "long" })
                : "";
              const itemCount = selectedDay?.items.length ?? 0;
              const counts = {
                scheduled: selectedDay?.items.filter(i => i.status === "scheduled").length ?? 0,
                published: selectedDay?.items.filter(i => i.status === "published").length ?? 0,
                draft: selectedDay?.items.filter(i => i.status === "draft").length ?? 0,
              };
              return (
                <div className="space-y-3 pr-10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">
                        {weekday}
                      </p>
                      <SheetTitle className="text-2xl">
                        {selectedDay
                          ? `${MONTH_NAMES[month]} ${selectedDay.day}, ${year}`
                          : "Day Posts"}
                      </SheetTitle>
                      <SheetDescription className="m-0">
                        {itemCount} item{itemCount !== 1 ? "s" : ""} scheduled or published
                      </SheetDescription>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5 shrink-0 bg-purple-500 hover:bg-purple-600 text-white shadow-sm"
                      onClick={() => {
                        setDaySheetOpen(false);
                        setNewPostType(null);
                        setNewPostOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New Post
                    </Button>
                  </div>
                  {/* Quick stats */}
                  {itemCount > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {counts.published > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" />
                          {counts.published} published
                        </span>
                      )}
                      {counts.scheduled > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                          <Clock className="h-3 w-3" />
                          {counts.scheduled} scheduled
                        </span>
                      )}
                      {counts.draft > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
                          <Edit2 className="h-3 w-3" />
                          {counts.draft} draft
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {selectedDay?.items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <CalendarIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No content for this day</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create your first post to fill this slot
                </p>
              </div>
            )}
            {selectedDay?.items.map(ci => {
              const plt = ci.platform ? PLATFORM_CONFIG[ci.platform] : null;
              const typ = TYPE_CONFIG[ci.type];
              const sts = STATUS_CONFIG[ci.status] ?? STATUS_CONFIG.draft;
              const time = ci.scheduled_at
                ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
                    .format(new Date(ci.scheduled_at))
                : null;
              const canPublish = ci.type === "post" && (ci.status === "draft" || ci.status === "scheduled");
              const canReschedule = ci.type === "post" && ci.status !== "published";
              return (
                <div
                  key={ci.id}
                  className="border rounded-lg p-3 bg-white hover:bg-muted/50 transition-colors"
                >
                  {/* Header: platform • status • time */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      {plt && (
                        <span className="text-muted-foreground">{plt.label}</span>
                      )}
                      {sts && (
                        <span className="capitalize text-[11px] text-muted-foreground">
                          {sts.label}
                        </span>
                      )}
                    </div>
                    {time && (
                      <span className="text-xs text-muted-foreground">{time}</span>
                    )}
                  </div>

                  {/* Content: title only */}
                  <button
                    type="button"
                    onClick={() => { setDaySheetOpen(false); setSelectedItem(ci); setSheetOpen(true); }}
                    className="w-full text-left mb-2"
                  >
                    <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug hover:text-purple-600">
                      {ci.title}
                    </p>
                  </button>

                  {/* Action buttons */}
                  <div className="flex gap-1 items-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => { setDaySheetOpen(false); setSelectedItem(ci); setSheetOpen(true); }}
                    >
                      View
                    </Button>
                    {canPublish && (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs bg-purple-500 hover:bg-purple-600 text-white"
                        disabled={!!publishingId}
                        onClick={async () => {
                          await handlePublish(ci);
                          setSelectedDay(prev => prev
                            ? { ...prev, items: prev.items.map((p: CalendarItem) => p.id === ci.id ? { ...p, status: "published" as const } : p) }
                            : prev
                          );
                        }}
                      >
                        {publishingId === ci.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : "Publish"
                        }
                      </Button>
                    )}
                    {canReschedule && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => openReschedule(ci)}
                      >
                        {ci.scheduled_at ? "Reschedule" : "Schedule"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-red-50 ml-auto"
                      disabled={!!deletingId}
                      onClick={async () => {
                        await handleDelete(ci);
                        setSelectedDay(prev => prev
                          ? { ...prev, items: prev.items.filter((p: CalendarItem) => p.id !== ci.id) }
                          : prev
                        );
                      }}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

