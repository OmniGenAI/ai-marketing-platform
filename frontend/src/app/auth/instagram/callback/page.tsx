"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

function InstagramCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting your Instagram account...");

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const error = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      // Check if this is a redirect from backend (already processed)
      const connected = searchParams.get("connected");
      const backendError = searchParams.get("error");

      if (connected) {
        // Backend already processed, notify parent and close
        setStatus("success");
        setMessage(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`);

        // Notify parent window
        if (window.opener) {
          window.opener.postMessage({ type: "INSTAGRAM_CONNECTED", platform: connected }, "*");
          setTimeout(() => window.close(), 1500);
        }
        return;
      }

      if (backendError && !code) {
        // Error from backend redirect
        setStatus("error");
        setMessage(searchParams.get("message") || "Connection failed");

        if (window.opener) {
          window.opener.postMessage({ type: "INSTAGRAM_ERROR", error: backendError }, "*");
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      if (error) {
        // User denied permission
        setStatus("error");
        setMessage(errorDescription || "Instagram connection was cancelled");

        if (window.opener) {
          window.opener.postMessage({ type: "INSTAGRAM_ERROR", error: "denied" }, "*");
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      if (code && state) {
        // Redirect to backend callback to complete OAuth flow
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        window.location.href = `${backendUrl}/api/social/instagram/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      } else {
        setStatus("error");
        setMessage("Missing authorization parameters");

        if (window.opener) {
          window.opener.postMessage({ type: "INSTAGRAM_ERROR", error: "missing_params" }, "*");
          setTimeout(() => window.close(), 2000);
        }
      }
    };

    handleCallback();
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center p-8">
        {status === "loading" && (
          <>
            <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p className="text-green-600 font-medium">{message}</p>
            <p className="text-sm text-muted-foreground mt-2">This window will close automatically...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <p className="text-red-600 font-medium">{message}</p>
            <p className="text-sm text-muted-foreground mt-2">This window will close automatically...</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function InstagramCallbackPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <InstagramCallbackContent />
    </Suspense>
  );
}
