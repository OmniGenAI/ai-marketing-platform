"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import api, { setAccessToken } from "@/lib/api";
import type { User } from "@/types";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  // Fetch backend user when we have a session
  const fetchBackendUser = async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      console.log("[Auth] Fetching backend user...");
      const response = await api.get<User>("/api/auth/me");
      console.log("[Auth] Backend user:", response.data?.email);
      setUser(response.data);
    } catch (error: any) {
      console.error("[Auth] Backend error:", error?.response?.status, error?.message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log("[Auth] Initializing...");

    // Listen for auth state changes - this is the primary source
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("[Auth] State change:", event, "User:", newSession?.user?.email);

        // Update global token for API calls
        setAccessToken(newSession?.access_token ?? null);

        setSession(newSession);
        setSupabaseUser(newSession?.user ?? null);

        // Fetch backend user on sign in or initial
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
          await fetchBackendUser(newSession);
        } else if (event === "SIGNED_OUT") {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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

  const fetchUser = async () => {
    await fetchBackendUser(session);
  };

  return { user, supabaseUser, session, loading, login, register, logout, fetchUser };
}
