import axios from "axios";
import { createClient } from "@/lib/supabase/client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
console.log("[API] Base URL:", apiUrl);

const api = axios.create({
  baseURL: apiUrl,
  timeout: 60000,
});

// Store current access token globally
let currentAccessToken: string | null = null;

// Function to update token (called from auth hook)
export function setAccessToken(token: string | null) {
  currentAccessToken = token;
  console.log("[API] Token updated:", token ? "yes" : "no");
}

// Request interceptor - add auth token
api.interceptors.request.use(
  async (config) => {
    // Use stored token first
    if (currentAccessToken) {
      config.headers.Authorization = `Bearer ${currentAccessToken}`;
      return config;
    }

    // Fallback: try to get from Supabase (with timeout)
    try {
      const supabase = createClient();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 2000)
      );
      const sessionPromise = supabase.auth.getSession();

      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]) as any;

      if (session?.access_token) {
        currentAccessToken = session.access_token;
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.warn("[API] Could not get session token");
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const supabase = createClient();
        const { data } = await supabase.auth.refreshSession();

        if (data.session) {
          currentAccessToken = data.session.access_token;
          originalRequest.headers.Authorization = `Bearer ${data.session.access_token}`;
          return api(originalRequest);
        }
      } catch {
        // Refresh failed
      }

      // Redirect to login
      if (typeof window !== "undefined") {
        currentAccessToken = null;
        const supabase = createClient();
        await supabase.auth.signOut();
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default api;
