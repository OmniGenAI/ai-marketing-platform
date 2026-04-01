"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import api from "@/lib/api";
import type { User } from "@/types";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchUser = useCallback(async () => {
    try {
      console.log("[Auth] Starting auth check...");

      // Get session directly (faster, reads from cookies)
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("[Auth] Session error:", sessionError.message);
        setLoading(false);
        return;
      }

      console.log("[Auth] Session exists:", !!currentSession);
      console.log("[Auth] Session user:", currentSession?.user?.email);

      if (currentSession?.user) {
        setSession(currentSession);
        setSupabaseUser(currentSession.user);

        // Fetch user from backend
        try {
          console.log("[Auth] Fetching from backend...");
          const response = await api.get<User>("/api/auth/me");
          console.log("[Auth] Backend response:", response.data?.email);
          setUser(response.data);
        } catch (backendError: any) {
          console.error("[Auth] Backend error:", backendError?.response?.status, backendError?.message);
          // Try refreshing session
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData.session) {
            setSession(refreshData.session);
            try {
              const response = await api.get<User>("/api/auth/me");
              setUser(response.data);
            } catch {
              setUser(null);
            }
          }
        }
      } else {
        console.log("[Auth] No session found");
        setSession(null);
        setSupabaseUser(null);
        setUser(null);
      }
    } catch (err: any) {
      console.error("[Auth] Fatal error:", err?.message);
      setUser(null);
      setSession(null);
      setSupabaseUser(null);
    } finally {
      setLoading(false);
    }
  }, [supabase.auth]);

  useEffect(() => {
    fetchUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("[Auth] State change:", event);
        setSession(newSession);
        setSupabaseUser(newSession?.user ?? null);

        if (newSession?.user) {
          try {
            const response = await api.get<User>("/api/auth/me");
            setUser(response.data);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchUser, supabase.auth]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  };

  const register = async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, full_name: name } },
    });

    if (error) throw error;
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
    setSession(null);
    window.location.href = "/login";
  };

  return { user, supabaseUser, session, loading, login, register, logout, fetchUser };
}
