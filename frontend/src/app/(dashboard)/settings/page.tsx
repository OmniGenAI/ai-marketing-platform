"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
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
    description: "Share to your Instagram Business account.",
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
};

// Order matches what users typically prioritize.
const PLATFORM_ORDER = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "devto",
  "reddit",
];

function SettingsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Fetch BOTH /providers (for the unified card grid) and /accounts (for the
  // legacy quick-connect section). They overlap but serve different UI needs.
  const fetchAll = useCallback(async () => {
    try {
      const [provRes, acctRes] = await Promise.all([
        api.get<ProviderStatus[]>("/api/social/providers"),
        api.get<SocialAccount[]>("/api/social/accounts"),
      ]);
      setProviders(provRes.data);
      setAccounts(acctRes.data);
    } catch {
      toast.error("Failed to load social connections");
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle OAuth callback query params (works for ALL platforms now — backend
  // redirects to /settings?connected={platform} or ?error={platform}_failed).
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

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
      setAccounts(accounts.filter((acc) => acc.id !== accountId));
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
                  Sorted by PLATFORM_ORDER so the most-used networks come first. */}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PLATFORM_ORDER.map((platform) => {
                  const status = providers.find((p) => p.platform === platform);
                  const cfg = PLATFORM_CONFIG[platform];
                  if (!status || !cfg) return null;
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

              <Separator className="my-4" />

              {/* Legacy quick-connect — uses pre-configured page tokens from .env.
                  Kept for testing/dev: skips OAuth, attaches to the operator's
                  shared FB/IG. New users should use the OAuth cards above. */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Quick Connect (testing — uses shared accounts from .env)
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant={facebookConnected ? "outline" : "secondary"}
                    onClick={quickConnectFacebook}
                    disabled={connecting === "facebook-quick" || facebookConnected}
                    className="flex items-center gap-2"
                    size="sm"
                  >
                    {connecting === "facebook-quick" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Facebook className="h-4 w-4" />
                    )}
                    {facebookConnected ? "FB Connected" : "Quick Connect FB"}
                  </Button>
                  <Button
                    variant={instagramConnected ? "outline" : "secondary"}
                    onClick={quickConnectInstagram}
                    disabled={connecting === "instagram-quick" || instagramConnected}
                    className="flex items-center gap-2"
                    size="sm"
                  >
                    {connecting === "instagram-quick" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Instagram className="h-4 w-4" />
                    )}
                    {instagramConnected ? "IG Connected" : "Quick Connect IG"}
                  </Button>
                </div>
              </div>

              {/* Dev Mode Section */}
              {isDev && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Bug className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium">Development Mode</span>
                      <Badge variant="outline" className="text-orange-500 border-orange-500">
                        Testing Only
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use mock accounts to test publishing without real Facebook OAuth setup.
                      These won&apos;t actually post to social media.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={mockConnectFacebook}
                        disabled={connecting === "facebook-mock" || facebookConnected}
                        className="flex items-center gap-2"
                      >
                        {connecting === "facebook-mock" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Facebook className="h-4 w-4" />
                        )}
                        Mock Facebook
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={mockConnectInstagram}
                        disabled={connecting === "instagram-mock" || instagramConnected}
                        className="flex items-center gap-2"
                      >
                        {connecting === "instagram-mock" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Instagram className="h-4 w-4" />
                        )}
                        Mock Instagram
                      </Button>
                    </div>
                  </div>
                </>
              )}
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

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
