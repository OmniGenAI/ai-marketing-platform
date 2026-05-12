"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/queries";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import api from "@/lib/api";
import type { SocialAccount } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  Loader2,
  Trash2,
  Bug,
  Code2,
  MessageSquare,
  Twitter,
  AtSign,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  SocialConnectCard,
  type ProviderStatus,
} from "@/components/settings/SocialConnectCard";

// Per-platform display config for the new connect cards.
// `iconColor` matches each brand's primary; `description` shows what each
// connection unlocks in the app.
const PLATFORM_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; iconColor: string; description: string }
> = {
  facebook: {
    label: "Facebook",
    icon: <Facebook className="h-5 w-5" />,
    iconColor: "#1877F2",
    description: "Publish posts to your Facebook Page + read engagement.",
  },
  instagram: {
    label: "Instagram",
    icon: <Instagram className="h-5 w-5" />,
    iconColor: "#E4405F",
    description: "Share to your Instagram Business account. Sign in with the Facebook account that admins your linked Page.",
  },
  linkedin: {
    label: "LinkedIn",
    icon: <Linkedin className="h-5 w-5" />,
    iconColor: "#0A66C2",
    description: "Publish to your LinkedIn profile.",
  },
  youtube: {
    label: "YouTube",
    icon: <Youtube className="h-5 w-5" />,
    iconColor: "#FF0000",
    description: "Upload videos and read view stats from your channel.",
  },
  devto: {
    label: "Dev.to",
    icon: <Code2 className="h-5 w-5" />,
    iconColor: "#0A0A0A",
    description: "Cross-post articles to Dev.to. Uses your personal API key.",
  },
  reddit: {
    label: "Reddit",
    icon: <MessageSquare className="h-5 w-5" />,
    iconColor: "#FF4500",
    description: "Submit posts to subreddits and track upvotes.",
  },
  twitter: {
    label: "Twitter / X",
    icon: <Twitter className="h-5 w-5" />,
    iconColor: "#000000",
    description: "Post tweets and threads directly from the dashboard.",
  },
  threads: {
    label: "Threads",
    icon: <AtSign className="h-5 w-5" />,
    iconColor: "#000000",
    description: "Cross-post to Threads from your Instagram-linked account.",
  },
};

// Order matches what users typically prioritize.
const PLATFORM_ORDER = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "devto",
  "reddit",
  "twitter",
  "threads",
];

// Platforms that don't have a backend provider yet — rendered as
// "Coming Soon" cards so users can see what's on the roadmap. Empty now
// that Twitter and Threads have full backend support; keep the mechanism
// for future additions.
const COMING_SOON_PLATFORMS = new Set<string>();

function SettingsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const { data: providers = [], isLoading: providersLoading } = useQuery<ProviderStatus[]>({
    queryKey: QUERY_KEYS.socialProviders,
    queryFn: async () => (await api.get<ProviderStatus[]>("/api/social/providers")).data,
    staleTime: 30 * 1000,
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<SocialAccount[]>({
    queryKey: QUERY_KEYS.socialAccounts,
    queryFn: async () => (await api.get<SocialAccount[]>("/api/social/accounts")).data,
    staleTime: 30 * 1000,
  });
  const loading = providersLoading || accountsLoading;

  // Stable reference — won't cause useEffect to re-run on every render
  const fetchAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: QUERY_KEYS.socialProviders });
    qc.invalidateQueries({ queryKey: QUERY_KEYS.socialAccounts });
  }, [qc]);

  // Handle OAuth callback query params
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const message = searchParams.get("message");

    if (connected) {
      toast.success(
        `${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`
      );
      router.replace("/settings");
      fetchAll();
    } else if (error) {
      const errorMsg = message || "Connection failed. Please try again.";
      toast.error(errorMsg, { duration: 5000 });
      router.replace("/settings");
    }
  }, [searchParams, router, fetchAll]);

  const connectFacebook = async () => {
    setConnecting("facebook");
    try {
      const response = await api.get<{ auth_url: string }>("/api/social/facebook/auth");
      // Direct redirect to Facebook OAuth
      window.location.href = response.data.auth_url;
    } catch {
      toast.error("Failed to initiate Facebook connection");
      setConnecting(null);
    }
  };

  const connectInstagram = async () => {
    setConnecting("instagram");
    try {
      const response = await api.get<{ auth_url: string }>("/api/social/instagram/auth");
      // Direct redirect to Instagram OAuth
      window.location.href = response.data.auth_url;
    } catch {
      toast.error("Failed to initiate Instagram connection");
      setConnecting(null);
    }
  };

  const quickConnectFacebook = async () => {
    setConnecting("facebook-quick");
    try {
      const response = await api.post<{ message: string; page_name: string; page_id: string }>("/api/social/facebook/quick-connect");
      await fetchAll();
      toast.success(`Quick connected to ${response.data.page_name}!`);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || "Failed to quick connect Facebook";
      toast.error(errorMessage);
    } finally {
      setConnecting(null);
    }
  };

  const quickConnectInstagram = async () => {
    setConnecting("instagram-quick");
    try {
      const response = await api.post<{ message: string; page_name: string; page_id: string }>("/api/social/instagram/quick-connect");
      await fetchAll();
      toast.success(`Quick connected to @${response.data.page_name}!`);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || "Failed to quick connect Instagram";
      toast.error(errorMessage);
    } finally {
      setConnecting(null);
    }
  };

  const disconnectAccount = async (accountId: string) => {
    setDisconnecting(accountId);
    try {
      await api.delete(`/api/social/accounts/${accountId}`);
      // Optimistically drop the disconnected account from the cached list so
      // the UI updates instantly; React Query refetches on next focus anyway.
      qc.setQueryData<SocialAccount[]>(QUERY_KEYS.socialAccounts, (prev = []) =>
        prev.filter((acc) => acc.id !== accountId)
      );
      qc.invalidateQueries({ queryKey: QUERY_KEYS.socialProviders });
      toast.success("Account disconnected successfully");
    } catch {
      toast.error("Failed to disconnect account");
    } finally {
      setDisconnecting(null);
    }
  };

  // Dev mode: Mock connections for testing
  const mockConnectFacebook = async () => {
    setConnecting("facebook-mock");
    try {
      await api.post("/api/social/dev/mock/facebook");
      await fetchAll();
      toast.success("Facebook connected (Dev Mode)");
    } catch {
      toast.error("Failed to connect mock Facebook");
    } finally {
      setConnecting(null);
    }
  };

  const mockConnectInstagram = async () => {
    setConnecting("instagram-mock");
    try {
      await api.post("/api/social/dev/mock/instagram");
      await fetchAll();
      toast.success("Instagram connected (Dev Mode)");
    } catch {
      toast.error("Failed to connect mock Instagram");
    } finally {
      setConnecting(null);
    }
  };

  const facebookConnected = accounts.some((acc) => acc.platform === "facebook");
  const instagramConnected = accounts.some((acc) => acc.platform === "instagram");
  const isDev = process.env.NODE_ENV === "development" || typeof window !== "undefined" && window.location.hostname === "localhost";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input defaultValue={user?.name || ""} disabled />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input defaultValue={user?.email || ""} disabled />
          </div>
          <div className="space-y-2">
            <Label>Member Since</Label>
            <Input
              defaultValue={
                user?.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : ""
              }
              disabled
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Connect your social media accounts to publish posts directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* All-platform connect grid (uses /api/social/providers).
                  Sorted by PLATFORM_ORDER, then "Coming Soon" / unconfigured
                  platforms are pushed to the end so connectable cards stay
                  on top. Configured-but-not-yet-connected cards stay first. */}
              {(() => {
                const sortedPlatforms = [...PLATFORM_ORDER].sort((a, b) => {
                  const aIsComingSoon =
                    COMING_SOON_PLATFORMS.has(a) ||
                    !(providers.find((p) => p.platform === a)?.configured);
                  const bIsComingSoon =
                    COMING_SOON_PLATFORMS.has(b) ||
                    !(providers.find((p) => p.platform === b)?.configured);
                  if (aIsComingSoon === bIsComingSoon) {
                    // Stable: preserve PLATFORM_ORDER ordering within each group.
                    return PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b);
                  }
                  return aIsComingSoon ? 1 : -1;
                });
                return (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedPlatforms.map((platform) => {
                      const cfg = PLATFORM_CONFIG[platform];
                      if (!cfg) return null;
                      if (COMING_SOON_PLATFORMS.has(platform)) {
                        return (
                          <ComingSoonCard
                            key={platform}
                            label={cfg.label}
                            icon={cfg.icon}
                            iconColor={cfg.iconColor}
                            description={cfg.description}
                          />
                        );
                      }
                      const status = providers.find((p) => p.platform === platform);
                      if (!status) return null;
                      // Match by platform name to find the matching account row for delete.
                      const account = accounts.find(
                        (a) => a.platform === platform
                      );
                      return (
                        <SocialConnectCard
                          key={platform}
                          status={status}
                          label={cfg.label}
                          icon={cfg.icon}
                          iconColor={cfg.iconColor}
                          description={cfg.description}
                          accountId={account?.id}
                          onChanged={fetchAll}
                        />
                      );
                    })}
                  </div>
                );
              })()}

            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions for your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <Button variant="destructive" disabled>
            Delete Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Compact card for platforms that aren't wired up yet. Matches the visual
// rhythm of SocialConnectCard so the grid stays consistent.
function ComingSoonCard({
  label,
  icon,
  iconColor,
  description,
}: {
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  description?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-dashed bg-muted/20">
      <CardHeader className="px-3 pb-2">
        <div className="flex items-center gap-2.5 pr-6">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white opacity-60 [&_svg]:h-3.5 [&_svg]:w-3.5"
            style={{ backgroundColor: iconColor }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-1.5 text-sm leading-tight">
              <span className="truncate text-muted-foreground">{label}</span>
              <Badge
                variant="outline"
                className="h-4 border-amber-400 bg-amber-50 px-1.5 text-[9px] font-semibold text-amber-700"
              >
                Coming Soon
              </Badge>
            </CardTitle>
            {description && (
              <CardDescription className="mt-0.5 line-clamp-1 text-[11px] leading-tight">
                {description}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          Support for {label} is on the roadmap — stay tuned.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
