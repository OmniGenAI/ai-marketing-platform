"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Layers,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  POSTER_TEMPLATES_BY_ID,
  getPosterTemplate,
} from "@/lib/poster/templates";
import type { Poster } from "@/types";

const PAGE_SIZE = 9;

const tools = [
  {
    href: "/generate/poster/new",
    icon: ImageIcon,
    title: "Generate Poster",
    description:
      "Pick a style, type a title, and the AI builds a clean text-free background. You overlay perfectly-spelled headline, tagline and CTA in a live preview, then download as PNG or copy the matching social caption.",
    cta: "Start Generating",
    accent:
      "from-violet-500/10 via-fuchsia-500/10 to-rose-500/10 border-fuchsia-500/20",
    iconColor: "text-fuchsia-500",
    ctaColor:
      "bg-linear-to-r from-violet-600 via-fuchsia-500 to-rose-500 hover:opacity-90 transition-opacity shadow-sm",
  },
];

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PosterHubPage() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api
      .get<Poster[]>("/api/posters")
      .then((res) => setPosters(res.data || []))
      .catch(() => {
        /* non-critical — list stays empty */
      })
      .finally(() => setLoading(false));
  }, []);

  const confirmDelete = (id: string) => setConfirmId(id);

  const deletePoster = async () => {
    if (!confirmId) return;
    const id = confirmId;
    setConfirmId(null);
    const snapshot = posters;
    setPosters((prev) => prev.filter((p) => p.id !== id));
    try {
      await api.delete(`/api/posters/${id}`);
    } catch {
      setPosters(snapshot);
      toast.error("Failed to delete — please try again");
    }
  };

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...posters]
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          (p.theme ?? "").toLowerCase().includes(q) ||
          (p.template_style ?? "").toLowerCase().includes(q),
      );
  }, [posters, search]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goTo = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  return (
    <div className="flex flex-col mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Posters</h1>
        <p className="mt-2 text-muted-foreground">
          Design AI poster backgrounds with perfectly-spelled, editable text
          overlays. Download as PNG or copy the matching social caption.
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 my-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <div
              key={tool.href}
              className={`relative flex flex-col gap-4 rounded-xl border bg-linear-to-br p-6 ${tool.accent}`}
            >
              <div className="flex gap-4 items-center">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-linear-to-br from-violet-600 via-fuchsia-500 to-rose-500 text-white shadow-sm"
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold">{tool.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {tool.description}
              </p>
              <div className="mt-auto pt-2">
                <Link
                  href={tool.href}
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors ${tool.ctaColor}`}
                >
                  {tool.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Saved posters */}
      <div>
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Saved Posters</h2>
            {!loading && posters.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {sorted.length}/{posters.length}
              </span>
            )}
          </div>

          {!loading && posters.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search posters…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-44 rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-48 rounded-lg border bg-muted/30 animate-pulse"
              />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No posters yet — generate your first one above.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paginated.map((item) => (
              <PosterCard
                key={item.id}
                poster={item}
                onDelete={confirmDelete}
              />
            ))}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div className="mt-6">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(safePage - 1);
                    }}
                    aria-disabled={safePage === 1}
                    className={
                      safePage === 1 ? "pointer-events-none opacity-40" : ""
                    }
                  />
                </PaginationItem>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                  if (
                    totalPages > 5 &&
                    p !== 1 &&
                    p !== totalPages &&
                    Math.abs(p - safePage) > 1
                  ) {
                    if (p === 2 || p === totalPages - 1) {
                      return (
                        <PaginationItem key={p}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      );
                    }
                    return null;
                  }
                  return (
                    <PaginationItem key={p}>
                      <PaginationLink
                        href="#"
                        isActive={p === safePage}
                        onClick={(e) => {
                          e.preventDefault();
                          goTo(p);
                        }}
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(safePage + 1);
                    }}
                    aria-disabled={safePage === totalPages}
                    className={
                      safePage === totalPages
                        ? "pointer-events-none opacity-40"
                        : ""
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>

      {/* Confirm delete modal */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirmId(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold mb-2">Delete poster?</h3>
            <p className="text-sm text-muted-foreground mb-5">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmId(null)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deletePoster}
                className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PosterCard({
  poster,
  onDelete,
}: {
  poster: Poster;
  onDelete: (id: string) => void;
}) {
  const template = poster.template_style in POSTER_TEMPLATES_BY_ID
    ? getPosterTemplate(poster.template_style)
    : getPosterTemplate("minimal");

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border bg-card hover:border-foreground/20 transition-colors">
      {/* Thumbnail */}
      <div className="relative aspect-square bg-neutral-100 overflow-hidden">
        {poster.background_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster.background_image_url}
            alt={poster.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            <Layers className="h-2.5 w-2.5" />
            {template.label}
          </span>
          {poster.status === "exported" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/85 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              Exported
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-sm font-medium line-clamp-1">{poster.title}</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {timeAgo(poster.updated_at)} · {poster.aspect_ratio}
          </p>
          <Link
            href={`/generate/poster/new?id=${poster.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </Link>
        </div>
      </div>

      <button
        onClick={() => onDelete(poster.id)}
        className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-white/90 hover:text-red-300 transition-all bg-black/40 rounded p-1 backdrop-blur"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
