"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, CreditCard, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Plan, Subscription } from "@/types";

export default function SubscriptionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [activatingPlan, setActivatingPlan] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verificationAttempted = useRef(false);

  const fetchSubscription = useCallback(async () => {
    try {
      const response = await api.get<Subscription | null>("/api/subscription/status");
      setSubscription(response.data);
      return response.data;
    } catch {
      return null;
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    try {
      const response = await api.get<Plan[]>("/api/plans");
      setPlans(response.data);
    } catch {
      toast.error("Failed to load plans");
    }
  }, []);

  // Verify checkout session and activate subscription
  const verifyCheckoutSession = useCallback(async (sessionId: string) => {
    if (verificationAttempted.current) return;
    verificationAttempted.current = true;

    setVerifying(true);
    try {
      const response = await api.post("/api/subscription/verify", {
        session_id: sessionId,
      });

      if (response.data.status === "activated") {
        toast.success(response.data.message);
        if (response.data.credits_added > 0) {
          toast.info(`${response.data.credits_added} credits added to your account!`);
        } else if (response.data.credits_added === -1) {
          toast.info("Unlimited credits activated!");
        }
      } else if (response.data.status === "already_active") {
        toast.info(response.data.message);
      }

      await fetchSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      const errorMsg = err.response?.data?.detail || "Failed to verify payment";
      toast.error(errorMsg);
      console.error("Verification error:", errorMsg);
    } finally {
      setVerifying(false);
      // Clean up URL
      router.replace("/subscription");
    }
  }, [router, fetchSubscription]);

  // Handle Stripe redirect query params
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");
    const sessionId = searchParams.get("session_id");

    if (success === "true" && sessionId) {
      // Verify the checkout session to activate subscription
      verifyCheckoutSession(sessionId);
    } else if (success === "true" && !sessionId) {
      // Fallback: no session ID, just show success and refresh
      toast.success("Payment successful! Refreshing subscription status...");
      fetchSubscription();
      router.replace("/subscription");
    } else if (canceled === "true") {
      toast.info("Subscription checkout was cancelled");
      router.replace("/subscription");
    }
  }, [searchParams, router, verifyCheckoutSession, fetchSubscription]);

  useEffect(() => {
    Promise.all([fetchPlans(), fetchSubscription()]).finally(() => {
      setLoading(false);
    });
  }, [fetchPlans, fetchSubscription]);

  const handleSubscribe = async (planId: string) => {
    setSubscribingPlanId(planId);
    try {
      const response = await api.post<{ checkout_url: string; session_id: string }>(
        "/api/subscription/checkout",
        { plan_id: planId }
      );
      // Redirect to Stripe checkout
      window.location.href = response.data.checkout_url;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to initiate checkout");
      setSubscribingPlanId(null);
    }
  };

  // Dev mode: manually activate subscription
  const handleDevActivate = async (planSlug: string) => {
    setActivatingPlan(planSlug);
    try {
      const response = await api.post(`/api/subscription/dev/activate/${planSlug}`);
      toast.success(response.data.message);
      if (response.data.credits_added > 0) {
        toast.info(`${response.data.credits_added} credits added!`);
      } else if (response.data.credits_added === -1) {
        toast.info("Unlimited credits activated!");
      }
      await fetchSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to activate");
    } finally {
      setActivatingPlan(null);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.")) {
      return;
    }

    setCancelling(true);
    try {
      const response = await api.post("/api/subscription/cancel");
      toast.success(response.data.message);
      await fetchSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to cancel subscription");
    } finally {
      setCancelling(false);
    }
  };

  const handleManageBilling = async () => {
    setOpeningPortal(true);
    try {
      const response = await api.get<{ portal_url: string }>("/api/subscription/billing-portal");
      // Open in new tab to avoid navigation issues
      window.open(response.data.portal_url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to open billing portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  const getButtonState = (plan: Plan) => {
    const currentPlanPrice = subscription?.plan?.price ?? 0;
    const isSubscriptionActive = subscription?.status === "active" ||
      (subscription?.status === "cancelled" &&
        subscription.current_period_end &&
        new Date(subscription.current_period_end) > new Date());

    const isCurrentPlan = subscription?.plan_id === plan.id && isSubscriptionActive;
    const isUpgrade = plan.price > currentPlanPrice;
    const isDowngrade = plan.price < currentPlanPrice;

    // If no subscription or cancelled and expired, free plan is current
    if (!isSubscriptionActive && plan.price === 0) {
      return {
        text: "Current Plan",
        disabled: true,
        variant: "outline" as const,
        action: "none" as const,
      };
    }

    if (isCurrentPlan) {
      return {
        text: "Current Plan",
        disabled: true,
        variant: "outline" as const,
        action: "none" as const,
      };
    }

    if (isUpgrade) {
      return {
        text: subscribingPlanId === plan.id ? "Redirecting..." : "Upgrade",
        disabled: subscribingPlanId === plan.id,
        variant: "default" as const,
        action: "upgrade" as const,
      };
    }

    if (isDowngrade) {
      return {
        text: activatingPlan === plan.slug ? "Switching..." : "Switch",
        disabled: activatingPlan === plan.slug,
        variant: "outline" as const,
        action: "downgrade" as const,
      };
    }

    return {
      text: "Subscribe",
      disabled: false,
      variant: "outline" as const,
      action: "subscribe" as const,
    };
  };

  const handlePlanAction = async (plan: Plan) => {
    const buttonState = getButtonState(plan);

    if (buttonState.action === "upgrade") {
      await handleSubscribe(plan.id);
    } else if (buttonState.action === "downgrade") {
      await handleDevActivate(plan.slug);
    }
  };

  const getFeatures = (plan: Plan): string[] => {
    const credits = plan.credits === -1 ? "Unlimited" : plan.credits;
    const baseFeatures = [`${credits} AI posts/month`];

    if (plan.features) {
      if (plan.features.all_tones) baseFeatures.push("All tone options");
      if (plan.features.draft_saving) baseFeatures.push("Draft saving");
      if (plan.features.facebook_publishing) baseFeatures.push("Facebook publishing");
      if (plan.features.instagram_publishing) baseFeatures.push("Instagram publishing");
      if (plan.features.priority_support) baseFeatures.push("Priority support");
    }

    return baseFeatures;
  };

  const isEffectivelyActive =
    subscription?.status === "active" ||
    (subscription?.status === "cancelled" &&
      subscription.current_period_end &&
      new Date(subscription.current_period_end) > new Date());

  const hasPaidPlan = isEffectivelyActive && (subscription?.plan?.price ?? 0) > 0;

  if (loading || verifying) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        {verifying && (
          <p className="text-muted-foreground">Activating your subscription...</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Subscription Plans</h1>
        <p className="text-muted-foreground">
          Choose a plan that fits your business needs.
        </p>
      </div>

      {/* Current Subscription Status */}
      {subscription && (
        <Card className={`${subscription.status === "cancelled" ? "border-yellow-500/50 bg-yellow-50/50" : "bg-primary/5 border-primary/20"}`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm">
                  You are currently on the <strong>{subscription.plan?.name || "Free"}</strong> plan.
                  {subscription.status === "active" && subscription.current_period_end && (
                    <span className="text-muted-foreground">
                      {" "}Renews on {new Date(subscription.current_period_end).toLocaleDateString()}
                    </span>
                  )}
                  {subscription.status === "cancelled" && subscription.current_period_end && (
                    <span className="text-yellow-600">
                      {" "}Cancelled - Access until {new Date(subscription.current_period_end).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>
              {hasPaidPlan && subscription.status !== "cancelled" && (
                <div className="flex gap-2">
                  {subscription.stripe_customer_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleManageBilling}
                      disabled={openingPortal}
                    >
                      {openingPortal ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CreditCard className="h-4 w-4 mr-2" />
                      )}
                      Manage Billing
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    {cancelling ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Cancel Plan
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No plans available.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please restart the backend server to seed default plans.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const buttonState = getButtonState(plan);
            const features = getFeatures(plan);
            const isCurrentPlan =
              (subscription?.plan_id === plan.id && isEffectivelyActive) ||
              (!isEffectivelyActive && plan.price === 0);
            const isPopular = plan.slug === "starter" && !isCurrentPlan;

            return (
              <Card
                key={plan.id}
                className={
                  isCurrentPlan
                    ? "border-2 border-primary shadow-lg ring-2 ring-primary/20"
                    : isPopular
                    ? "border-primary shadow-md"
                    : ""
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{plan.name}</CardTitle>
                    <div className="flex gap-2">
                      {isCurrentPlan && <Badge className="bg-primary">Current</Badge>}
                      {isPopular && <Badge variant="secondary">Popular</Badge>}
                    </div>
                  </div>
                  <CardDescription>
                    <span className="text-3xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground">/month</span>
                  </CardDescription>
                  <p className="text-sm text-muted-foreground">
                    {plan.credits === -1 ? "Unlimited credits" : `${plan.credits} credits/month`}
                  </p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={buttonState.variant}
                    disabled={buttonState.disabled}
                    onClick={() => handlePlanAction(plan)}
                  >
                    {(subscribingPlanId === plan.id || activatingPlan === plan.slug) && (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    )}
                    {buttonState.text}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
