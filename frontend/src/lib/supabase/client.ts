import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Use default cookie handling but ensure proper settings for production
      },
      cookieOptions: {
        // Ensure cookies work in production HTTPS environment
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
    }
  );
}
