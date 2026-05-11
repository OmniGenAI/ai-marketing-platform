"use client";

/**
 * Shared React Query hooks for commonly fetched data.
 * Import these in any component instead of duplicating fetch logic.
 * Invalidation keys are exported so mutations can invalidate related queries.
 */

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { Post, Wallet, Subscription, Plan } from "@/types";

// ---------------------------------------------------------------------------
// Query keys — centralised so invalidation is consistent everywhere
// ---------------------------------------------------------------------------
export const QUERY_KEYS = {
  posts: ["posts"] as const,
  wallet: ["wallet"] as const,
  subscription: ["subscription"] as const,
  plans: ["plans"] as const,
  seoSaves: ["seo-saves"] as const,
  blogSaves: ["blog-saves"] as const,
  socialProviders: ["social-providers"] as const,
  socialAccounts: ["social-accounts"] as const,
  calendar: (year: number, month: number) => ["calendar", year, month] as const,
};

const DEFAULT_OPTIONS = {
  staleTime: 30 * 1000,          // 30s fresh
  refetchOnWindowFocus: true,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function usePostsQuery() {
  return useQuery<Post[]>({
    queryKey: QUERY_KEYS.posts,
    queryFn: async () => (await api.get<Post[]>("/api/posts")).data,
    ...DEFAULT_OPTIONS,
  });
}

export function useWalletQuery() {
  return useQuery<Wallet | null>({
    queryKey: QUERY_KEYS.wallet,
    queryFn: async () => {
      try {
        return (await api.get<Wallet>("/api/wallet")).data;
      } catch {
        return null;
      }
    },
    ...DEFAULT_OPTIONS,
  });
}

export function useSubscriptionQuery() {
  return useQuery<Subscription | null>({
    queryKey: QUERY_KEYS.subscription,
    queryFn: async () => {
      try {
        return (await api.get<Subscription | null>("/api/subscription/status")).data;
      } catch {
        return null;
      }
    },
    ...DEFAULT_OPTIONS,
  });
}

export function usePlansQuery() {
  return useQuery<Plan[]>({
    queryKey: QUERY_KEYS.plans,
    queryFn: async () => (await api.get<Plan[]>("/api/plans")).data,
    staleTime: 5 * 60 * 1000, // Plans rarely change — cache 5 min
    refetchOnWindowFocus: false,
  });
}

interface SeoSaveItem {
  id: string;
  type: "brief" | "draft";
  title: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function useSeoSavesQuery() {
  return useQuery<SeoSaveItem[]>({
    queryKey: QUERY_KEYS.seoSaves,
    queryFn: async () => (await api.get<SeoSaveItem[]>("/api/seo/saves")).data,
    ...DEFAULT_OPTIONS,
  });
}

export function useBlogSavesQuery() {
  return useQuery<SeoSaveItem[]>({
    queryKey: QUERY_KEYS.blogSaves,
    queryFn: async () => {
      const res = await api.get<SeoSaveItem[]>("/api/seo/saves");
      return (res.data || []).filter((s) => s.type === "draft");
    },
    ...DEFAULT_OPTIONS,
  });
}
