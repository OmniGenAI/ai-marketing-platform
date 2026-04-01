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
      // Use getUser() to validate session with server (not getSession which only reads localStorage)
      const { data: { user: supabaseUserData }, error } = await supabase.auth.getUser();

      if (error || !supabaseUserData) {
        setSession(null);
        setSupabaseUser(null);
        setUser(null);
        return;
      }

      setSupabaseUser(supabaseUserData);

      // Get the session for access token (safe to use after getUser validates)
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);

      // Fetch user profile from our backend
      const response = await api.get<User>("/api/auth/me");
      setUser(response.data);
    } catch {
      setUser(null);
      setSession(null);
      setSupabaseUser(null);
    } finally {
      setLoading(false);
    }
  }, [supabase.auth]);

  useEffect(() => {
    fetchUser();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setSupabaseUser(session?.user ?? null);

        if (session?.user) {
          try {
            const response = await api.get<User>("/api/auth/me");
            setUser(response.data);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }

        if (event === "SIGNED_OUT") {
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

    if (error) {
      throw error;
    }

    return data;
  };

  const register = async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          full_name: name,
        },
      },
    });

    if (error) {
      throw error;
    }

    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
    setSession(null);
    window.location.href = "/login";
  };

  return {
    user,
    supabaseUser,
    session,
    loading,
    login,
    register,
    logout,
    fetchUser,
  };
}
