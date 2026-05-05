"use client";

/**
 * Reusable connect/disconnect card for any supported social platform.
 *
 * - For OAuth platforms: clicking Connect hits `/api/social/{platform}/auth`
 *   and redirects the user to the provider's authorization page.
 * - For Dev.to (api_method === "api_key"): renders an inline input + POST
 *   to `/api/social/devto/connect`.
 * - When `configured === false` (env vars missing), the card is rendered
 *   disabled with a tooltip explaining what's needed.
 */
import { useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2, ExternalLink, Info } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

// Per-platform "How to connect" instructions surfaced via the info icon.
// Keep this map free of platform secrets — it only documents the user-facing
// steps. Edit copy here when the provider changes their UI.
const HOW_TO_CONNECT: Record<
  string,
  { steps: string[]; helpUrl: string; helpLabel: string }
> = {
  facebook: {
    steps: [
      "Click Connect — you'll be redirected to Facebook to log in.",
      "Approve permissions to manage Pages and read engagement.",
      "Pick the Facebook Page you want to publish from.",
      "You'll be returned here once the connection is complete.",
    ],
    helpUrl: "https://www.facebook.com/business/help/162540421027900",
    helpLabel: "Need a Facebook Page?",
  },
  instagram: {
    steps: [
      "Convert your Instagram to a Business or Creator account first.",
      "Link it to a Facebook Page (Instagram → Settings → Account).",
      "Click Connect and approve the same Facebook permissions.",
      "Your Instagram will appear automatically — no separate login.",
    ],
    helpUrl: "https://help.instagram.com/502981923235522",
    helpLabel: "Switch to Business account",
  },
  linkedin: {
    steps: [
      "Click Connect — opens LinkedIn's login.",
      "Approve the w_member_social permission to publish posts.",
      "We'll fetch your profile name and you're done.",
      "Token lasts 60 days — you'll be asked to reconnect after that.",
    ],
    helpUrl: "https://www.linkedin.com/developers/apps",
    helpLabel: "LinkedIn Developer Portal",
  },
  youtube: {
    steps: [
      "Click Connect — opens Google sign-in.",
      "Pick the Google account that owns your YouTube channel.",
      "Approve youtube.upload + youtube.readonly permissions.",
      "Your channel name shows up once linked.",
    ],
    helpUrl: "https://studio.youtube.com",
    helpLabel: "Open YouTube Studio",
  },
  devto: {
    steps: [
      "Open dev.to → click your avatar → Settings → Extensions.",
      "Generate a new API key (DEV Community API Keys section).",
      "Copy the key and paste it into the field below.",
      "Click Connect — we validate the key by calling /users/me.",
    ],
    helpUrl: "https://dev.to/settings/extensions",
    helpLabel: "Get your Dev.to API key",
  },
  reddit: {
    steps: [
      "Click Connect — Reddit's authorize page opens.",
      "Log in (or stay logged in) and approve the requested scopes.",
      "We'll show your u/username once linked.",
      "Token auto-refreshes via the refresh_token Reddit issues.",
    ],
    helpUrl: "https://www.reddit.com/prefs/apps",
    helpLabel: "Reddit app preferences",
  },
};

export type ProviderStatus = {
  platform: string;
  configured: boolean;
  auth_method: "oauth" | "api_key";
  connected: boolean;
  page_name: string | null;
};

type Props = {
  status: ProviderStatus;
  /** Display name for the platform e.g. "Facebook", "LinkedIn". */
  label: string;
  /** Inline icon node — caller passes a lucide-react icon. */
  icon: ReactNode;
  /** Hex color for the icon background — keeps each card visually distinct. */
  iconColor?: string;
  /** Short helper text shown under the title. */
  description?: string;
  /** Account row id (only set when `connected === true`) — used for delete. */
  accountId?: string;
  onChanged: () => void;
};

export function SocialConnectCard({
  status,
  label,
  icon,
  iconColor = "#6366f1",
  description,
  accountId,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const isApiKey = status.auth_method === "api_key";
  const help = HOW_TO_CONNECT[status.platform];

  const handleOAuthConnect = async () => {
    setBusy(true);
    try {
      const res = await api.get<{ auth_url: string }>(
        `/api/social/${status.platform}/auth`
      );
      // Full-page redirect — provider's domain handles the rest, we land back
      // on /auth/{platform}/callback which redirects to /settings?connected=...
      window.location.href = res.data.auth_url;
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        `Failed to start ${label} connection`;
      toast.error(msg);
      setBusy(false);
    }
  };

  const handleApiKeyConnect = async () => {
    if (!apiKey.trim()) {
      toast.error("Please paste your API key first");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/social/${status.platform}/connect`, {
        api_key: apiKey.trim(),
      });
      toast.success(`${label} connected!`);
      setApiKey("");
      onChanged();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Connection failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!accountId) return;
    if (!confirm(`Disconnect ${label}? You can reconnect anytime.`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/social/accounts/${accountId}`);
      toast.success(`${label} disconnected`);
      onChanged();
    } catch {
      toast.error(`Failed to disconnect ${label}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="relative gap-0 py-3">
      {/* Info button — opens a dialog with step-by-step connection instructions.
          Positioned absolute top-right so it doesn't interfere with the card's
          flex layout below. Only render if we have help copy for this platform. */}
      {help && (
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label={`How to connect ${label}`}
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
      <CardHeader className="px-3 pb-2">
        <div className="flex items-center gap-2.5 pr-6">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white [&_svg]:h-3.5 [&_svg]:w-3.5"
            style={{ backgroundColor: iconColor }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-1.5 text-sm leading-tight">
              <span className="truncate">{label}</span>
              {status.connected && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                  Connected
                </Badge>
              )}
              {!status.configured && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                  Not set
                </Badge>
              )}
            </CardTitle>
            {description && (
              <CardDescription className="mt-0.5 line-clamp-1 text-[11px] leading-tight">
                {description}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-1">
        {status.connected ? (
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {status.page_name || "—"}
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={busy}
              className="h-7 px-2 text-destructive hover:bg-destructive/10"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        ) : !status.configured ? (
          <p className="text-[11px] text-muted-foreground">
            Admin must add {label} credentials in environment variables.
          </p>
        ) : isApiKey ? (
          <div className="flex gap-1.5">
            <Input
              type="password"
              placeholder={`${label} API key`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              className="h-8 text-xs"
            />
            <Button
              onClick={handleApiKeyConnect}
              disabled={busy}
              size="sm"
              className="h-8 shrink-0 px-3 text-xs"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleOAuthConnect}
            disabled={busy}
            size="sm"
            className="h-8 w-full text-xs"
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            )}
            Connect
          </Button>
        )}
      </CardContent>

      {/* "How to connect" dialog — shown when the info button is clicked. */}
      {help && (
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded text-white [&_svg]:h-3.5 [&_svg]:w-3.5"
                  style={{ backgroundColor: iconColor }}
                >
                  {icon}
                </span>
                How to connect {label}
              </DialogTitle>
              <DialogDescription>
                Follow these steps to link your {label} account.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-2.5 text-sm">
              {help.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed text-muted-foreground">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <a
              href={help.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {help.helpLabel}
            </a>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
