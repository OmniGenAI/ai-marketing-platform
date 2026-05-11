"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PublishedPostsPanel } from "@/components/analytics/PublishedPostsPanel";
import {
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  Activity,
} from "lucide-react";
import api from "@/lib/api";

type Site = {
  id: string;
  domain: string;
  name: string | null;
  created_at: string;
};

type Summary = {
  site: { id: string; domain: string; name: string | null };
  range: string;
  totals: {
    pageviews: number;
    visitors: number;
    bounce_rate: number;
    pages_per_visit: number;
  };
  timeseries: { date: string; pageviews: number }[];
  top_pages: { value: string; count: number }[];
  top_referrers: { value: string; count: number }[];
  top_countries: { value: string; count: number }[];
  devices: { value: string; count: number }[];
  browsers: { value: string; count: number }[];
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AnalyticsPage() {
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("7d");
  const [addOpen, setAddOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState<Site | null>(null);

  const { data: sites = [], isLoading: loadingSites, refetch: loadSites } = useQuery<Site[]>({
    queryKey: ["analytics-sites"],
    queryFn: async () => {
      const res = await api.get<Site[]>("/api/analytics/sites");
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  // Auto-select first site
  useEffect(() => {
    if (sites.length && !activeSiteId) setActiveSiteId(sites[0].id);
  }, [sites, activeSiteId]);

  const { data: summary, isLoading: loadingSummary, refetch: loadSummary } = useQuery<Summary>({
    queryKey: ["analytics-summary", activeSiteId, range],
    queryFn: async () => {
      const res = await api.get<Summary>(
        `/api/analytics/site/${activeSiteId}/summary?range=${range}`
      );
      return res.data;
    },
    enabled: !!activeSiteId,
    staleTime: 60 * 1000,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-6 w-6" /> Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Real visitor analytics for your websites — privacy-friendly, no cookies.
          </p>
        </div>
      </div>

      <Tabs defaultValue="posts" className="w-full">
        <TabsList>
          <TabsTrigger value="posts">Published Posts</TabsTrigger>
          <TabsTrigger value="sites">My Sites</TabsTrigger>
          <TabsTrigger value="inspect">Inspect URL</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-4">
          <PublishedPostsPanel />
        </TabsContent>

        <TabsContent value="inspect" className="mt-4">
          <UrlInspectTab />
        </TabsContent>

        <TabsContent value="sites" className="mt-4 space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Site
          </Button>
        </div>

      {loadingSites ? (
        <Skeleton className="h-32 w-full" />
      ) : sites.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <SiteList
            sites={sites}
            activeId={activeSiteId}
            onSelect={setActiveSiteId}
            onShowInstall={(s) => setInstallOpen(s)}
            onDeleted={async (id) => {
              if (activeSiteId === id) setActiveSiteId(null);
              await loadSites();
              // summary auto-clears: query is disabled when activeSiteId is null
            }}
          />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
                {activeSiteId && <LiveBadge siteId={activeSiteId} />}
              </div>
              <Button variant="outline" size="sm" onClick={() => loadSummary()} disabled={loadingSummary}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingSummary ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {loadingSummary && !summary ? (
              <Skeleton className="h-96 w-full" />
            ) : summary ? (
              <SummaryView summary={summary} siteId={activeSiteId!} range={range} />
            ) : null}
          </div>
        </div>
      )}

        </TabsContent>
      </Tabs>

      <AddSiteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={async (site) => {
          await loadSites();
          setActiveSiteId(site.id);
          setAddOpen(false);
          setInstallOpen(site);
        }}
      />

      {installOpen && (
        <InstallDialog
          site={installOpen}
          onOpenChange={(open) => !open && setInstallOpen(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Globe className="h-10 w-10 text-muted-foreground" />
        <div className="text-lg font-semibold">No sites yet</div>
        <p className="max-w-md text-sm text-muted-foreground">
          Add your website to install a 1-line tracking snippet. We&apos;ll start
          counting pageviews, visitors, top pages, and referrers.
        </p>
        <Button onClick={onAdd} className="mt-2">
          <Plus className="mr-2 h-4 w-4" /> Add your first site
        </Button>
      </CardContent>
    </Card>
  );
}

function SiteList({
  sites,
  activeId,
  onSelect,
  onShowInstall,
  onDeleted,
}: {
  sites: Site[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onShowInstall: (s: Site) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">My Sites</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 p-2">
        {sites.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm cursor-pointer ${
              activeId === s.id ? "bg-accent" : "hover:bg-accent/50"
            }`}
            onClick={() => onSelect(s.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.domain}</div>
              {s.name && (
                <div className="truncate text-xs text-muted-foreground">{s.name}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Install snippet"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowInstall(s);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-destructive"
                title="Delete site"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`Delete ${s.domain}? This will remove all its analytics data.`))
                    return;
                  try {
                    await api.delete(`/api/analytics/sites/${s.id}`);
                    toast.success("Site deleted");
                    onDeleted(s.id);
                  } catch {
                    toast.error("Could not delete site");
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LiveBadge({ siteId }: { siteId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.get(`/api/analytics/site/${siteId}/realtime`);
        if (!cancelled) setCount(res.data?.active_visitors ?? 0);
      } catch {
        if (!cancelled) setCount(null);
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [siteId]);
  if (count === null) return null;
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      {count} live
    </Badge>
  );
}

function InsightsCard({ siteId, range }: { siteId: string; range: string }) {
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/analytics/site/${siteId}/insights?range=${range}`);
      setBullets(res.data?.insights || []);
    } catch {
      setBullets([]);
    } finally {
      setLoading(false);
    }
  }, [siteId, range]);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4" /> AI insights
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !bullets ? (
          <Skeleton className="h-16 w-full" />
        ) : bullets && bullets.length ? (
          <ul className="space-y-1.5 text-sm">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">No insights available.</div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryView({ summary, siteId, range }: { summary: Summary; siteId: string; range: string }) {
  const t = summary.totals;
  const hasData = t.pageviews > 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pageviews" value={t.pageviews.toLocaleString()} />
        <Stat label="Visitors" value={t.visitors.toLocaleString()} />
        <Stat label="Bounce rate" value={`${t.bounce_rate}%`} />
        <Stat label="Pages / visit" value={t.pages_per_visit.toString()} />
      </div>

      {!hasData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No events yet. Make sure the snippet is installed on{" "}
            <span className="font-medium">{summary.site.domain}</span> and visit a page.
          </CardContent>
        </Card>
      )}

      {hasData && <InsightsCard siteId={siteId} range={range} />}

      {hasData && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Pageviews over time</CardTitle>
            </CardHeader>
            <CardContent>
              <Sparkline data={summary.timeseries} range={summary.range as "24h" | "7d" | "30d" | "90d"} />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownCard title="Top pages" rows={summary.top_pages} />
            <BreakdownCard title="Top referrers" rows={summary.top_referrers} />
            <BreakdownCard title="Countries" rows={summary.top_countries} />
            <BreakdownCard title="Devices" rows={summary.devices} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Sparkline({
  data,
  range,
}: {
  data: { date: string; pageviews: number }[];
  range: "24h" | "7d" | "30d" | "90d";
}) {
  const series = useMemo(() => {
    const days = range === "24h" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const map = new Map<string, number>();
    for (const d of data) {
      const key = new Date(d.date).toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + d.pageviews);
    }
    const out: { date: string; pageviews: number }[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, pageviews: map.get(key) || 0 });
    }
    return out;
  }, [data, range]);

  const max = useMemo(
    () => Math.max(1, ...series.map((d) => d.pageviews)),
    [series]
  );

  return (
    <div className="flex h-32 items-end gap-1">
      {series.map((d) => (
        <div
          key={d.date}
          className="group relative h-full flex-1 max-w-[40px] flex items-end"
          title={`${new Date(d.date).toLocaleDateString()} — ${d.pageviews} pageviews`}
        >
          <div
            className="w-full rounded-sm bg-primary/80 transition-all hover:bg-primary"
            style={{
              height: d.pageviews ? `${(d.pageviews / max) * 100}%` : "2px",
              opacity: d.pageviews ? 1 : 0.15,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: { value: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data.</div>
        ) : (
          <div className="space-y-1.5">
            {rows.slice(0, 8).map((r) => (
              <div key={r.value} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate">{r.value || "(direct)"}</span>
                  <span className="ml-2 shrink-0 text-muted-foreground">
                    {r.count}
                  </span>
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-muted">
                  <div
                    className="h-1 rounded-full bg-primary"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddSiteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (site: Site) => void;
}) {
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!domain.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<Site>("/api/analytics/sites", {
        domain: domain.trim(),
        name: name.trim() || null,
      });
      toast.success("Site added");
      setDomain("");
      setName("");
      onCreated(res.data);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Could not add site";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a website</DialogTitle>
          <DialogDescription>
            Enter the domain you want to track. We&apos;ll give you a 1-line snippet to paste.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              placeholder="My company blog"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !domain.trim()}>
            {busy ? "Adding…" : "Add site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallDialog({
  site,
  onOpenChange,
}: {
  site: Site;
  onOpenChange: (v: boolean) => void;
}) {
  const snippet = `<script src="${API_BASE}/track.js" data-site="${site.id}" defer></script>`;
  const [verified, setVerified] = useState(false);
  const [polling, setPolling] = useState(false);

  const checkOnce = useCallback(async () => {
    try {
      const res = await api.get(`/api/analytics/site/${site.id}/realtime`);
      if (res.data?.verified) {
        setVerified(true);
        return true;
      }
    } catch {}
    return false;
  }, [site.id]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const ok = await checkOnce();
      if (ok || attempts >= 30) {
        setPolling(false);
        return;
      }
      setTimeout(tick, 3000);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [polling, checkOnce]);

  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    toast.success("Snippet copied");
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Install on {site.domain}</DialogTitle>
          <DialogDescription>
            Paste this snippet into the <code>&lt;head&gt;</code> of your site
            (or before the closing <code>&lt;/body&gt;</code>).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all">
            {snippet}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={copy} size="sm">
              <Copy className="mr-2 h-3.5 w-3.5" /> Copy snippet
            </Button>
            <Button
              size="sm"
              variant={verified ? "secondary" : "outline"}
              onClick={() => {
                setVerified(false);
                setPolling(true);
              }}
              disabled={polling}
            >
              {polling
                ? "Listening for events…"
                : verified
                ? "✓ Verified"
                : "Verify installation"}
            </Button>
            {verified && <Badge variant="secondary">Receiving events</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            Privacy: no cookies, no PII stored. Visitor IDs hash IP+UA daily.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type UrlInspect = {
  url: string;
  fetched_at: string;
  score: number;
  checks: { name: string; ok: boolean; value: string }[];
  content: {
    title: string;
    meta_description: string;
    h1: string[];
    h2_count: number;
    h3_count: number;
    word_count: number;
    reading_minutes: number;
    image_count: number;
    missing_alt_count: number;
    internal_links: number;
    external_links: number;
    html_size_kb: number;
  };
};

function UrlInspectTab() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UrlInspect | null>(null);

  const run = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<UrlInspect>("/api/analytics/url/inspect", {
        url: url.trim(),
      });
      setResult(res.data);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Could not inspect URL";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-2 p-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="https://yourblog.com/article-slug"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <Button onClick={run} disabled={busy || !url.trim()}>
            {busy ? "Analyzing…" : "Analyze"}
          </Button>
        </CardContent>
      </Card>

      {busy && !result && <Skeleton className="h-64 w-full" />}

      {result && (
        <>
          <Card>
            <CardContent className="flex items-center gap-6 p-6">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4"
                   style={{ borderColor: result.score >= 80 ? "#16a34a" : result.score >= 50 ? "#eab308" : "#dc2626" }}>
                <div className="text-2xl font-bold">{result.score}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-muted-foreground">{result.url}</div>
                <div className="mt-1 text-lg font-semibold">SEO health score</div>
                <div className="text-xs text-muted-foreground">
                  {result.content.word_count.toLocaleString()} words • {result.content.reading_minutes} min read
                  {" • "}{result.content.html_size_kb} KB
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">SEO checks</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {result.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2">
                      {c.ok ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.value}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Content</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Title">{result.content.title || "(missing)"}</Row>
                <Row label="Meta description">{result.content.meta_description || "(missing)"}</Row>
                <Row label="H1">{result.content.h1.join(" • ") || "(none)"}</Row>
                <Row label="H2 / H3">{result.content.h2_count} / {result.content.h3_count}</Row>
                <Row label="Images (missing alt)">{result.content.image_count} ({result.content.missing_alt_count})</Row>
                <Row label="Links (internal / external)">{result.content.internal_links} / {result.content.external_links}</Row>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!busy && !result && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <div className="font-medium">Inspect any blog or article URL</div>
            <p className="max-w-md text-sm text-muted-foreground">
              We&apos;ll fetch the page and report SEO health, content stats, and structural issues.
              No tracking install required.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}
