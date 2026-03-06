"use client";

import { useState, useEffect } from "react";
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
import { Facebook, Instagram, Loader2, Trash2, Bug } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Handle OAuth callback query params
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const message = searchParams.get("message");

    if (connected) {
      toast.success(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`);
      router.replace("/settings");
    } else if (error) {
      const errorMessages: Record<string, string> = {
        facebook_denied: "Facebook connection was cancelled",
        facebook_failed: "Failed to connect Facebook",
        instagram_denied: "Instagram connection was cancelled",
        instagram_failed: "Failed to connect Instagram",
      };
      const errorMsg = message || errorMessages[error] || "Connection failed";
      toast.error(errorMsg, { duration: 5000 });
      router.replace("/settings");
    }
  }, [searchParams, router]);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const response = await api.get<SocialAccount[]>("/api/social/accounts");
      setAccounts(response.data);
    } catch {
      toast.error("Failed to load connected accounts");
    } finally {
      setLoading(false);
    }
  };

  const connectFacebook = async () => {
    setConnecting("facebook");
    try {
      const response = await api.get<{ auth_url: string }>("/api/social/facebook/auth");
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
      window.location.href = response.data.auth_url;
    } catch {
      toast.error("Failed to initiate Instagram connection");
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
      await fetchAccounts();
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
      await fetchAccounts();
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
              {/* Connected Accounts List */}
              {accounts.length > 0 && (
                <div className="space-y-3 mb-6">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        {account.platform === "facebook" ? (
                          <Facebook className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Instagram className="h-5 w-5 text-pink-600" />
                        )}
                        <div>
                          <p className="font-medium">{account.page_name}</p>
                          <p className="text-sm text-muted-foreground capitalize">
                            {account.platform}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => disconnectAccount(account.id)}
                        disabled={disconnecting === account.id}
                      >
                        {disconnecting === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Connect Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant={facebookConnected ? "outline" : "default"}
                  onClick={connectFacebook}
                  disabled={connecting === "facebook" || facebookConnected}
                  className="flex items-center gap-2"
                >
                  {connecting === "facebook" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Facebook className="h-4 w-4" />
                  )}
                  {facebookConnected ? "Facebook Connected" : "Connect Facebook"}
                </Button>
                <Button
                  variant={instagramConnected ? "outline" : "default"}
                  onClick={connectInstagram}
                  disabled={connecting === "instagram" || instagramConnected}
                  className="flex items-center gap-2"
                >
                  {connecting === "instagram" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Instagram className="h-4 w-4" />
                  )}
                  {instagramConnected ? "Instagram Connected" : "Connect Instagram"}
                </Button>
              </div>

              {!facebookConnected && !instagramConnected && (
                <p className="text-sm text-muted-foreground mt-2">
                  Connect at least one social account to start publishing posts.
                </p>
              )}

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
