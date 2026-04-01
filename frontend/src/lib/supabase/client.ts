import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Browser client handles cookies automatically via document.cookie
  // No custom configuration needed - Supabase SSR manages this internally
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
