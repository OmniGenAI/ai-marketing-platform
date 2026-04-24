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
  website_context_used?: boolean;
  seo_keywords_used?: string[];
  primary_keyword?: string | null;
}

export type VoicePreset =
  | "founder_pov"
  | "contrarian"
  | "story_driven"
  | "data_backed"
  | "educational"
  | "technical_deep"
  | "casual_builder";

export type ContentGoal =
  | "clicks"
  | "comments"
  | "authority"
  | "promote"
  | "viral";

export type CtaStyle = "soft" | "hard" | "curiosity" | "none";

export type HookStyle =
  | "curiosity"
  | "contrarian"
  | "data"
  | "story"
  | "bold";

export type PlatformKey =
  | "linkedin"
  | "twitter"
  | "email"
  | "youtube"
  | "instagram"
  | "facebook"
  | "quotes"
  | "carousel";

export interface HookVariant {
  style: HookStyle;
  text: string;
  score?: number;
}

export type PreviewMode = "text" | "preview";

export interface RepurposeFormats {
  hook_variations: HookVariant[];
  linkedin_posts: string[];
  linkedin_post: string; // deprecated mirror
  twitter_thread: string[];
  email: { subject: string; body: string };
  youtube_description: string;
  instagram_captions: string[];
  instagram_caption: string; // deprecated mirror
  facebook_posts: string[];
  facebook_post: string; // deprecated mirror
  quote_cards: string[];
  carousel_outline: string[];
}

export interface RepurposeResponse {
  save_id: string;
  source_url: string;
  primary_keyword: string;
  keywords_used: string[];
  voice: VoicePreset;
  goal: ContentGoal;
  platforms: PlatformKey[];
  formats: RepurposeFormats;
}

export type RewriteSection =
  | "hook_variations"
  | "linkedin"
  | "twitter_thread"
  | "email"
  | "youtube"
  | "instagram"
  | "facebook"
  | "quotes"
  | "carousel";

export type RewritePreset =
  | "sharper"
  | "shorter"
  | "bolder"
  | "curiosity_gap"
  | "more_specific";

export interface RegenerateRequest {
  section: RewriteSection;
  variant_index?: number;
  preset?: RewritePreset | null;
  instruction?: string | null;
}

export interface RegenerateResponse {
  section: RewriteSection;
  variant_index: number;
  formats: RepurposeFormats;
  free_rerolls_remaining: number;
  credits_charged: number;
}

export interface RepurposeSaveItem {
  id: string;
  title: string;
  source_url: string;
  primary_keyword: string;
  created_at: string;
  updated_at: string;
}

export interface BlogSaveItem {
  id: string;
  type: string;
  title: string;
  data: {
    title?: string;
    content?: string;
    primary_keyword?: string;
    secondary_keywords?: string[];
    meta_title?: string;
    meta_description?: string;
  };
  created_at: string;
  updated_at: string;
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

export interface Reel {
  id: string;
  user_id: string;
  topic: string;
  tone: string;
  voice: string;
  duration_target: number;
  script: string | null;
  hashtags: string | null;
  primary_keyword: string | null;
  audio_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  status: "pending" | "generating_script" | "script_ready" | "generating_audio" | "fetching_videos" | "generating_ai_video" | "downloading_videos" | "processing_video" | "composing_video" | "ready" | "published" | "failed" | "publish_failed";
  error_message: string | null;
  platform: string;
  published_at: string | null;
  instagram_media_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: "male" | "female";
  language: string;
  description: string;
}

export interface VoicesResponse {
  voices: VoiceOption[];
}
