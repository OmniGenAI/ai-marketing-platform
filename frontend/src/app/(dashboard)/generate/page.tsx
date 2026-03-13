"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Sparkles, Copy, Save, RefreshCw, Coins, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useSubscription, PLAN_LIMITS } from "@/hooks/use-subscription";

export default function GeneratePage() {
  const router = useRouter();
  const {
    subscription,
    wallet,
    loading: subscriptionLoading,
    canUseCredits,
    hasFeature,
    creditsRemaining,
    planSlug,
    isFreePlan,
    refresh: refreshSubscription,
  } = useSubscription();

  const [platform, setPlatform] = useState("facebook");
  const [tone, setTone] = useState("professional");
  const [topic, setTopic] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatedHashtags, setGeneratedHashtags] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Get available tones based on plan
  const getAvailableTones = () => {
    const basicTones = [
      { value: "professional", label: "Professional" },
      { value: "friendly", label: "Friendly" },
    ];

    const premiumTones = [
      { value: "witty", label: "Witty" },
      { value: "formal", label: "Formal" },
      { value: "casual", label: "Casual" },
    ];

    if (hasFeature("all_tones")) {
      return [...basicTones, ...premiumTones];
    }
    return basicTones;
  };

  const availableTones = getAvailableTones();

  const handleGenerate = async () => {
    // Check credits before generating
    if (!canUseCredits(1)) {
      toast.error("Not enough credits! Upgrade your plan to get more.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await api.post("/api/generate", {
        platform,
        tone,
        topic,
      });
      setGeneratedContent(response.data.content);
      setGeneratedHashtags(response.data.hashtags);
      toast.success("Post generated! 1 credit used.");
      // Refresh subscription/wallet to update credit count
      refreshSubscription();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string }; status?: number } };
      if (err.response?.status === 402 || err.response?.data?.detail?.includes("credit")) {
        toast.error("Not enough credits! Upgrade your plan to continue.");
      } else {
        toast.error(err.response?.data?.detail || "Failed to generate post.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    // Check if user has draft saving feature
    if (!hasFeature("draft_saving") && isFreePlan) {
      toast.error("Draft saving requires a paid plan. Upgrade to save drafts!");
      return;
    }

    setIsSaving(true);
    try {
      await api.post("/api/posts", {
        content: generatedContent,
        hashtags: generatedHashtags,
        platform,
        tone,
        status: "draft",
      });
      toast.success("Post saved as draft!");
    } catch {
      toast.error("Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `${generatedContent}\n\n${generatedHashtags}`
    );
    toast.success("Copied to clipboard!");
  };

  // Format credits display
  const formatCredits = (credits: number) => {
    if (credits === Infinity || credits === -1) return "Unlimited";
    return credits.toString();
  };

  const showLowCreditsWarning = creditsRemaining !== Infinity && creditsRemaining <= 3;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Generate Post</h1>
          <p className="text-muted-foreground">
            Use AI to generate engaging social media posts for your business.
          </p>
        </div>

        {/* Credits Display */}
        <Card className="w-fit">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">
                {formatCredits(creditsRemaining)} credits
              </p>
              <p className="text-xs text-muted-foreground capitalize">
                {planSlug} plan
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Credits Warning */}
      {showLowCreditsWarning && (
        <Alert variant="destructive" className="bg-yellow-50 border-yellow-200 text-yellow-800">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              You have {creditsRemaining} credit{creditsRemaining !== 1 ? "s" : ""} remaining.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/subscription")}
              className="ml-4"
            >
              Upgrade Plan
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* No Credits Warning */}
      {creditsRemaining === 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              You have no credits remaining. Upgrade your plan to continue generating posts.
            </span>
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push("/subscription")}
              className="ml-4"
            >
              Upgrade Now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Post Settings</CardTitle>
            <CardDescription>
              Configure what kind of post you want to generate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  Tone
                  {isFreePlan && (
                    <span className="text-xs text-muted-foreground ml-2">
                      (Upgrade for more options)
                    </span>
                  )}
                </Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTones.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Topic (optional)</Label>
              <Textarea
                id="topic"
                placeholder="e.g., New product launch, Holiday sale, Behind the scenes..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || creditsRemaining === 0}
              className="w-full gap-2"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Post (1 Credit)
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Generated Post
              <Badge variant="secondary">{platform}</Badge>
            </CardTitle>
            <CardDescription>
              Review and edit the AI-generated content below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatedContent ? (
              <>
                <div className="space-y-2">
                  <Label>Content</Label>
                  <Textarea
                    value={generatedContent}
                    onChange={(e) => setGeneratedContent(e.target.value)}
                    rows={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Hashtags</Label>
                  <Textarea
                    value={generatedHashtags}
                    onChange={(e) => setGeneratedHashtags(e.target.value)}
                    rows={2}
                  />
                </div>

                <Separator />

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={isSaving}
                    className="gap-1"
                    title={isFreePlan ? "Upgrade to save drafts" : "Save as draft"}
                  >
                    <Save className="h-3 w-3" />
                    {isSaving ? "Saving..." : "Save Draft"}
                    {isFreePlan && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        Pro
                      </Badge>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleGenerate}
                    disabled={isGenerating || creditsRemaining === 0}
                    className="gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                <p>Generated content will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
