"use client";

/**
 * Generic OAuth callback handler — works for every supported platform.
 *
 * The OAuth provider redirects the browser here with `?code=...&state=...`.
 * This page forwards those query params to the backend's matching callback
 * endpoint (`/api/social/{platform}/callback`), which exchanges the code for
 * a token, persists the account, then 302s back to /settings?connected=...
 *
 * Why a passthrough page? OAuth providers must redirect to a stable URL
 * registered in their developer console. Pointing them directly at the
 * backend works locally but breaks in production where backend + frontend
 * have different domains. Front-end passthrough sidesteps that and keeps the
 * single source of truth (FRONTEND_URL/auth/{platform}/callback).
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

const NICE_NAMES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  reddit: "Reddit",
  devto: "Dev.to",
};

function CallbackContent() {
  const params = useParams<{ platform: string }>();
  const search = useSearchParams();
  const [state, setState] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const platform = (params?.platform || "").toLowerCase();
  const label = NICE_NAMES[platform] || platform;

  useEffect(() => {
    if (!platform) {
      setState("error");
      setErrorMsg("Unknown platform.");
      return;
    }

    // The OAuth provider may signal a denial here. Skip the backend call and
    // bounce straight back to /settings with a friendly message.
    const oauthErr = search.get("error");
    if (oauthErr) {
      const desc = search.get("error_description") || oauthErr;
      window.location.replace(
        `/settings?error=${encodeURIComponent(platform + "_failed")}` +
          `&message=${encodeURIComponent(desc)}`
      );
      return;
    }

    // Forward `code` + `state` (and anything else) to the backend callback,
    // which will handle the token exchange + redirect to /settings.
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const qs = search.toString();
    window.location.replace(
      `${apiBase}/api/social/${platform}/callback${qs ? `?${qs}` : ""}`
    );
  }, [platform, search]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        {state === "loading" ? (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
            <h1 className="text-lg font-semibold">Connecting {label}…</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hang tight, finishing authorization.
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
            <h1 className="text-lg font-semibold">Connection failed</h1>
            <p className="mt-1 text-sm text-muted-foreground">{errorMsg}</p>
            <a
              href="/settings"
              className="mt-4 inline-block text-sm text-primary underline"
            >
              Back to settings
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function PlatformCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
