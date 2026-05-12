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
  creditCosts: ["credit-costs"] as const,
  calendar: (year: number, month: number) => ["calendar", year, month] as const,
};

// Shape mirrors the backend CreditCostsResponse — keep keys in sync with
// app/routers/credits.py if you add a new chargeable feature.
export interface CreditCosts {
  social_post: number;
  poster: number;
  reel_video: number;
  reel_cancel: number;
  blog: number;
  seo_brief: number;
  seo_keywords: number;
  seo_tips: number;
  seo_apply_tips: number;
  repurpose: number;
  repurpose_reroll: number;
  repurpose_free_rerolls_per_day: number;
}

// Fallback values used while the costs API is in flight (or fails) — keep
// them aligned with the backend defaults in app/config.py so the UI never
// shows a misleading 0 cost.
export const CREDIT_COSTS_FALLBACK: CreditCosts = {
  social_post: 1,
  poster: 1,
  reel_video: 4,
  reel_cancel: 1,
  blog: 3,
  seo_brief: 2,
  seo_keywords: 1,
  seo_tips: 1,
  seo_apply_tips: 2,
  repurpose: 1,
  repurpose_reroll: 1,
  repurpose_free_rerolls_per_day: 3,
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
/**
 * Returns the live credit-cost catalog from the backend.
 *
 * Use this anywhere the UI shows a price ("Generate Video (4 credits)").
 * Falls back to a sane hardcoded table while the request is in flight so
 * buttons never flicker through a "0 credits" state.
 *
 * Cached for 10 min — costs change rarely, and a stale value for a few
 * minutes is acceptable since the backend re-validates on the actual
 * deduction call (the user gets a 402 if they're under-credited).
 */
export function useCreditCostsQuery() {
  return useQuery<CreditCosts>({
    queryKey: QUERY_KEYS.creditCosts,
    queryFn: async () => (await api.get<CreditCosts>("/api/credits/costs")).data,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    initialData: CREDIT_COSTS_FALLBACK,
  });
}

/**
 * Convenience wrapper that always returns a CreditCosts object (falling
 * back to the defaults) — avoids `costs?.reel_video ?? 4` boilerplate.
 */
export function useCreditCosts(): CreditCosts {
  const { data } = useCreditCostsQuery();
  return data ?? CREDIT_COSTS_FALLBACK;
}