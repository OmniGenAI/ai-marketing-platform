"use client";

import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import type { Subscription, Plan, Wallet } from "@/types";

interface UseSubscriptionReturn {
  subscription: Subscription | null;
  wallet: Wallet | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Feature checks
  currentPlan: Plan | null;
  isActive: boolean;
  canUseCredits: (amount?: number) => boolean;
  hasFeature: (feature: string) => boolean;
  creditsRemaining: number;
  // Plan info
  planSlug: string;
  isFreePlan: boolean;
  isPaidPlan: boolean;
}

/**
 * Hook for managing subscription state and feature gating.
 *
 * Usage:
 * ```tsx
 * const { canUseCredits, hasFeature, creditsRemaining } = useSubscription();
 *
 * if (!canUseCredits(1)) {
 *   toast.error("Not enough credits!");
 *   return;
 * }
 * ```
 */
export function useSubscription(): UseSubscriptionReturn {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch subscription status (may be null for free users)
      const subResponse = await api
        .get<Subscription | null>("/api/subscription/status")
        .catch(() => ({ data: null }));

      // Fetch wallet (may 404 if user doesn't have one yet)
      const walletResponse = await api
        .get<Wallet>("/api/wallet")
        .catch(() => ({ data: null }));

      setSubscription(subResponse.data);
      setWallet(walletResponse.data);
    } catch (err) {
      setError("Failed to load subscription data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Determine if subscription is effectively active
  const isActive = (() => {
    if (!subscription) return false;
    if (subscription.status === "active") return true;
    // Cancelled subscriptions remain active until period end
    if (subscription.status === "cancelled" && subscription.current_period_end) {
      return new Date(subscription.current_period_end) > new Date();
    }
    return false;
  })();

  const currentPlan = subscription?.plan || null;
  const planSlug = currentPlan?.slug || "free";
  const isFreePlan = planSlug === "free" || !isActive;
  const isPaidPlan = !isFreePlan;

  // Credits: -1 means unlimited (in both plan.credits and wallet.balance)
  const creditsRemaining = (() => {
    // Check wallet balance first - if -1, it's unlimited
    if (wallet?.balance === -1) return Infinity;
    // If plan credits is -1, unlimited
    if (currentPlan?.credits === -1) return Infinity;
    // If no subscription/plan, default to wallet balance or 10
    if (!currentPlan) return wallet?.balance ?? 10;
    // Otherwise return wallet balance
    return wallet?.balance ?? 0;
  })();

  const canUseCredits = useCallback(
    (amount: number = 1): boolean => {
      // Wallet balance of -1 means unlimited
      if (wallet?.balance === -1) return true;
      // Plan credits of -1 means unlimited
      if (currentPlan?.credits === -1) return true;
      // No subscription = free plan = check wallet balance
      if (!currentPlan) {
        return (wallet?.balance ?? 10) >= amount;
      }
      // Check wallet balance
      return (wallet?.balance ?? 0) >= amount;
    },
    [currentPlan, wallet]
  );

  const hasFeature = useCallback(
    (feature: string): boolean => {
      if (!currentPlan) {
        // Free plan features
        const freeFeatures = ["basic_tones"];
        return freeFeatures.includes(feature);
      }
      return currentPlan.features?.[feature] === true;
    },
    [currentPlan]
  );

  return {
    subscription,
    wallet,
    loading,
    error,
    refresh: fetchData,
    currentPlan,
    isActive,
    canUseCredits,
    hasFeature,
    creditsRemaining,
    planSlug,
    isFreePlan,
    isPaidPlan,
  };
}

/**
 * Plan limits for feature gating.
 */
export const PLAN_LIMITS = {
  free: {
    posts_per_month: 10,
    features: ["basic_tones"],
  },
  starter: {
    posts_per_month: 100,
    features: ["all_tones", "draft_saving", "facebook_publishing"],
  },
  pro: {
    posts_per_month: -1, // Unlimited
    features: [
      "all_tones",
      "draft_saving",
      "facebook_publishing",
      "instagram_publishing",
      "priority_support",
    ],
  },
} as const;

export type PlanSlug = keyof typeof PLAN_LIMITS;
