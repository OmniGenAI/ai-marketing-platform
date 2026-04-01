import axios from "axios";
import { createClient } from "@/lib/supabase/client";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 60000, // 60 second timeout
});

// Track if we're currently refreshing to prevent multiple refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

// Cache session to avoid repeated Supabase calls
let cachedSession: { token: string; expiry: number } | null = null;

async function refreshToken(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    return null;
  }
  // Update cache with refreshed token
  cachedSession = {
    token: data.session.access_token,
    expiry: Date.now() + 5 * 60 * 1000,
  };
  return data.session.access_token;
}

api.interceptors.request.use(
  async (config) => {
    try {
      // Check if we have a valid cached token
      const now = Date.now();
      if (cachedSession && cachedSession.expiry > now) {
        config.headers.Authorization = `Bearer ${cachedSession.token}`;
        return config;
      }

      const supabase = createClient();

      // Get session from storage - this is fast and doesn't make a network call
      // The backend will validate the token; if invalid, we'll get 401 and refresh
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        // Check if token is expired
        const tokenExpiry = session.expires_at ? session.expires_at * 1000 : now + 3600000;
        const isExpiringSoon = tokenExpiry - now < 60000; // Less than 1 minute left

        if (isExpiringSoon) {
          // Token is expiring soon, refresh it
          const newToken = await refreshToken();
          if (newToken) {
            config.headers.Authorization = `Bearer ${newToken}`;
            return config;
          }
        }

        // Cache for 5 minutes or until token expiry (whichever is shorter)
        const cacheExpiry = Math.min(now + 5 * 60 * 1000, tokenExpiry - 60000);
        cachedSession = {
          token: session.access_token,
          expiry: cacheExpiry,
        };
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }

      return config;
    } catch (error) {
      console.error("[API] Request interceptor error:", error);
      cachedSession = null;
      // Still allow request to proceed without auth token
      return config;
    }
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't tried refreshing yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // If not already refreshing, start refresh
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = refreshToken();
      }

      try {
        const newToken = await refreshPromise;
        isRefreshing = false;
        refreshPromise = null;

        if (newToken) {
          // Clear old cache and update with new token
          cachedSession = {
            token: newToken,
            expiry: Date.now() + 5 * 60 * 1000,
          };
          // Retry the original request with new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
      } catch {
        isRefreshing = false;
        refreshPromise = null;
      }

      // Clear cache on auth failure
      cachedSession = null;

      // If refresh failed, sign out and redirect
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
