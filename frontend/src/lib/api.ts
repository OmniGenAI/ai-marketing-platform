import axios from "axios";
import { createClient } from "@/lib/supabase/client";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  // Don't set default Content-Type - let axios set it based on the data being sent
  timeout: 60000, // 60 second timeout
});

// Cache the session to avoid repeated async calls
let cachedSession: { token: string; expiry: number } | null = null;

api.interceptors.request.use(
  async (config) => {
    try {
      console.log("[API] Making request to:", (config.baseURL ?? "") + config.url);
      
      // Check if we have a valid cached token
      const now = Date.now();
      if (cachedSession && cachedSession.expiry > now) {
        config.headers.Authorization = `Bearer ${cachedSession.token}`;
        console.log("[API] Using cached auth token");
        return config;
      }
      
      // Get the Supabase session token with timeout
      const supabase = createClient();
      
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Session fetch timeout")), 5000)
      );
      
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);

      if (session?.access_token) {
        // Cache for 5 minutes
        cachedSession = {
          token: session.access_token,
          expiry: now + 5 * 60 * 1000
        };
        config.headers.Authorization = `Bearer ${session.access_token}`;
        console.log("[API] Added auth token to request");
      } else {
        console.warn("[API] No session found - request will be unauthenticated");
      }

      return config;
    } catch (error) {
      console.error("[API] Request interceptor error:", error);
      // Still allow request to proceed without auth token
      return config;
    }
  },
  (error) => {
    console.error("[API] Request interceptor failed:", error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Sign out from Supabase
      const supabase = createClient();
      await supabase.auth.signOut();

      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
