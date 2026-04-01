import axios from "axios";
import { createClient } from "@/lib/supabase/client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
console.log("[API] Base URL:", apiUrl);

const api = axios.create({
  baseURL: apiUrl,
  timeout: 60000,
});

// Request interceptor - add auth token
api.interceptors.request.use(
  async (config) => {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.error("[API] Auth error:", error);
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
          originalRequest.headers.Authorization = `Bearer ${data.session.access_token}`;
          return api(originalRequest);
        }
      } catch {
        // Refresh failed
      }

      // Redirect to login
      if (typeof window !== "undefined") {
        const supabase = createClient();
        await supabase.auth.signOut();
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default api;
