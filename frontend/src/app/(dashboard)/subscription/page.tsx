"use client";

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
import { Check } from "lucide-react";

const plans = [
  {
    name: "Free",
    slug: "free",
    price: 0,
    credits: 10,
    features: ["10 AI posts/month", "Basic tone selection", "Draft saving"],
    popular: false,
  },
  {
    name: "Starter",
    slug: "starter",
    price: 9,
    credits: 100,
    features: [
      "100 AI posts/month",
      "All tone options",
      "Draft saving",
      "Facebook publishing",
    ],
    popular: true,
  },
  {
    name: "Pro",
    slug: "pro",
    price: 29,
    credits: -1,
    features: [
      "Unlimited AI posts",
      "All tone options",
      "Draft saving",
      "Facebook + Instagram publishing",
      "Priority support",
    ],
    popular: false,
  },
];

export default function SubscriptionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Subscription Plans</h1>
        <p className="text-muted-foreground">
          Choose a plan that fits your business needs.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.slug}
            className={plan.popular ? "border-primary shadow-md" : ""}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{plan.name}</CardTitle>
                {plan.popular && <Badge>Popular</Badge>}
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
                {plan.features.map((feature) => (
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
                variant={plan.popular ? "default" : "outline"}
              >
                {plan.price === 0 ? "Current Plan" : "Subscribe"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
