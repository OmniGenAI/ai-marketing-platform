"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function FacebookCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      // User denied permission or an error occurred
      window.location.href = "/settings?error=facebook_denied";
      return;
    }

    if (code && state) {
      // Redirect to backend callback to complete OAuth flow
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      window.location.href = `${backendUrl}/api/social/facebook/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    } else {
      // Missing parameters
      window.location.href = "/settings?error=facebook_failed";
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Connecting your Facebook account...</p>
      </div>
    </div>
  );
}
