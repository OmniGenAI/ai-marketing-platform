"use client";

import { useState, useEffect, useCallback } from "react";
import Cookies from "js-cookie";
import api from "@/lib/api";
import type { User } from "@/types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = Cookies.get("access_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await api.get<User>("/api/auth/me");
      setUser(response.data);
    } catch {
      Cookies.remove("access_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (email: string, password: string) => {
    const response = await api.post("/api/auth/login", { email, password });
    Cookies.set("access_token", response.data.access_token, { expires: 1 });
    await fetchUser();
    return response.data;
  };

  const register = async (name: string, email: string, password: string) => {
    const response = await api.post("/api/auth/register", {
      name,
      email,
      password,
    });
    return response.data;
  };

  const logout = () => {
    Cookies.remove("access_token");
    setUser(null);
    window.location.href = "/login";
  };

  return { user, loading, login, register, logout, fetchUser };
}
