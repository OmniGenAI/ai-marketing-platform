"use client";

import { useState, useEffect } from "react";
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
import { Check, Loader2 } from "lucide-react";
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

  // Handle Stripe redirect query params
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success === "true") {
      toast.success("Subscription activated successfully!");
      router.replace("/subscription");
      // Refresh subscription status
      fetchSubscription();
    } else if (canceled === "true") {
      toast.info("Subscription checkout was cancelled");
      router.replace("/subscription");
    }
  }, [searchParams, router]);

  useEffect(() => {
    Promise.all([fetchPlans(), fetchSubscription()]).finally(() => {
      setLoading(false);
    });
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await api.get<Plan[]>("/api/plans");
      setPlans(response.data);
    } catch {
      toast.error("Failed to load plans");
    }
  };

  const fetchSubscription = async () => {
    try {
      const response = await api.get<Subscription | null>("/api/subscription/status");
      setSubscription(response.data);
    } catch {
      // User may not have a subscription yet
    }
  };

  const handleSubscribe = async (planId: string) => {
    setSubscribingPlanId(planId);
    try {
      const response = await api.post<{ checkout_url: string }>("/api/subscription/checkout", {
        plan_id: planId,
      });
      // Redirect to Stripe checkout
      window.location.href = response.data.checkout_url;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to initiate checkout");
      setSubscribingPlanId(null);
    }
  };

  // Dev mode: manually activate subscription after Stripe payment
  const handleDevActivate = async (planSlug: string) => {
    setActivatingPlan(planSlug);
    try {
      const response = await api.post(`/api/subscription/dev/activate/${planSlug}`);
      toast.success(response.data.message);
      // Refresh data
      await Promise.all([fetchPlans(), fetchSubscription()]);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Failed to activate");
    } finally {
      setActivatingPlan(null);
    }
  };

  const getButtonState = (plan: Plan) => {
    // Determine current plan price
    const currentPlanPrice = subscription?.plan?.price ?? 0;
    const isCurrentPlan = subscription?.plan_id === plan.id || (!subscription && plan.price === 0);
    const isUpgrade = plan.price > currentPlanPrice;
    const isDowngrade = plan.price < currentPlanPrice;

    // Current plan
    if (isCurrentPlan) {
      return {
        text: "Current Plan",
        disabled: true,
        variant: "outline" as const,
        action: "none" as const
      };
    }

    // Upgrade
    if (isUpgrade) {
      return {
        text: subscribingPlanId === plan.id ? "Redirecting..." : "Upgrade",
        disabled: subscribingPlanId === plan.id,
        variant: "default" as const,
        action: "upgrade" as const
      };
    }

    // Downgrade
    if (isDowngrade) {
      return {
        text: activatingPlan === plan.slug ? "Switching..." : "Downgrade",
        disabled: activatingPlan === plan.slug,
        variant: "outline" as const,
        action: "downgrade" as const
      };
    }

    // Default (shouldn't reach here)
    return {
      text: "Subscribe",
      disabled: false,
      variant: "outline" as const,
      action: "subscribe" as const
    };
  };

  const handlePlanAction = async (plan: Plan) => {
    const buttonState = getButtonState(plan);

    if (buttonState.action === "upgrade") {
      // Go to Stripe checkout for upgrade
      await handleSubscribe(plan.id);
    } else if (buttonState.action === "downgrade") {
      // For downgrade, use dev activate endpoint
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

      {subscription && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <p className="text-sm">
              You are currently on the <strong>{subscription.plan?.name || "Free"}</strong> plan.
              {subscription.status === "active" && subscription.current_period_end && (
                <span className="text-muted-foreground">
                  {" "}Renews on {new Date(subscription.current_period_end).toLocaleDateString()}
                </span>
              )}
            </p>
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
          const isCurrentPlan = subscription?.plan_id === plan.id || (!subscription && plan.price === 0);
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
                    {isCurrentPlan && (
                      <Badge className="bg-primary">Current</Badge>
                    )}
                    {isPopular && <Badge variant="secondary">Popular</Badge>}
                  </div>
                </div>
                <CardDescription>
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-muted-foreground">/month</span>
                </CardDescription>
                <p className="text-sm text-muted-foreground">
                  {plan.credits === -1
                    ? "Unlimited credits"
                    : `${plan.credits} credits/month`}
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
