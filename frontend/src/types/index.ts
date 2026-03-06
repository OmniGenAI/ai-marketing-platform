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
  stripe_subscription_id: string | null;
  status: "active" | "canceled" | "past_due" | "trialing";
  current_period_start: string;
  current_period_end: string;
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
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  content: string;
  hashtags: string;
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
