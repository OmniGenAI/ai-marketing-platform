export interface User {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  role: string;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  credits: number;
  features: Record<string, boolean>;
  is_active: boolean;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  plan?: Plan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: "active" | "cancelled" | "past_due" | "trialing";
  current_period_start: string;
  current_period_end: string;
}

/**
 * Helper to determine if a subscription is effectively active.
 * A cancelled subscription is still active until period end.
 */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  if (subscription.status === "active") return true;
  // Cancelled subscriptions remain active until period end
  if (subscription.status === "cancelled" && subscription.current_period_end) {
    return new Date(subscription.current_period_end) > new Date();
  }
  return false;
}

/**
 * Get the current plan slug, defaulting to "free" if no active subscription.
 */
export function getCurrentPlanSlug(subscription: Subscription | null): string {
  if (!subscription || !isSubscriptionActive(subscription)) return "free";
  return subscription.plan?.slug || "free";
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  total_credits_used: number;
}

export interface UsageLog {
  id: string;
  wallet_id: string;
  action: string;
  credits_used: number;
  description: string;
  created_at: string;
}

export interface BusinessConfig {
  id: string;
  user_id: string;
  business_name: string;
  niche: string;
  tone: string;
  products: string;
  brand_voice: string;
  hashtags: string;
  target_audience: string;
  platform_preference: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  website_context: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessImage {
  id: string;
  user_id: string;
  url: string;
  filename: string;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  content: string;
  hashtags: string;
  image_url: string | null;
  image_option: "none" | "business" | "ai";
  platform: string;
  tone: string;
  status: "draft" | "published" | "failed";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string;
  page_id: string;
  page_name: string;
}

export interface AuthTokens {
  access_token: string;
  token_type: string;
}

export interface ApiError {
  detail: string;
}

export interface GenerateResponse {
  content: string;
  hashtags: string;
  image_url: string | null;
}

export interface WebsiteContext {
  url: string;
  title: string;
  meta_description: string;
  main_content: string;
  about_content: string;
  services: string;
  contact_info: string;
}
