"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import api from "@/lib/api";

export default function BusinessConfigPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [config, setConfig] = useState({
    business_name: "",
    niche: "",
    tone: "professional",
    products: "",
    brand_voice: "",
    hashtags: "",
    target_audience: "",
    platform_preference: "both",
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get("/api/business-config");
        if (response.data) {
          setConfig(response.data);
        }
      } catch (error: any) {
        if (error.response?.status !== 404) {
          toast.error("Failed to load configuration");
        }
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, []);

  const handleChange = (field: string, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await api.post("/api/business-config", config);
      toast.success("Business configuration saved!");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading your configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Business Configuration</h1>
        <p className="text-muted-foreground">
          Set up your business profile. This information will be used by AI to
          generate relevant social media posts.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Business Details</CardTitle>
            <CardDescription>
              Tell us about your business so AI can create tailored content.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business_name">Business Name</Label>
                <Input
                  id="business_name"
                  placeholder="e.g., Sunrise Bakery"
                  value={config.business_name}
                  onChange={(e) =>
                    handleChange("business_name", e.target.value)
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="niche">Niche / Industry</Label>
                <Input
                  id="niche"
                  placeholder="e.g., Food & Beverages"
                  value={config.niche}
                  onChange={(e) => handleChange("niche", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tone">Tone</Label>
                <Select
                  value={config.tone}
                  onValueChange={(value) => handleChange("tone", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select tone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="witty">Witty</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform_preference">
                  Platform Preference
                </Label>
                <Select
                  value={config.platform_preference}
                  onValueChange={(value) =>
                    handleChange("platform_preference", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="products">Products / Services</Label>
              <Textarea
                id="products"
                placeholder="Describe your main products or services..."
                value={config.products}
                onChange={(e) => handleChange("products", e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand_voice">Brand Voice</Label>
              <Textarea
                id="brand_voice"
                placeholder="How does your brand speak? e.g., We're warm, approachable, and passionate about fresh baking..."
                value={config.brand_voice}
                onChange={(e) => handleChange("brand_voice", e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_audience">Target Audience</Label>
              <Textarea
                id="target_audience"
                placeholder="Who is your ideal customer? e.g., Health-conscious millennials in urban areas..."
                value={config.target_audience}
                onChange={(e) =>
                  handleChange("target_audience", e.target.value)
                }
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hashtags">Preferred Hashtags</Label>
              <Input
                id="hashtags"
                placeholder="#bakery #freshbread #artisan"
                value={config.hashtags}
                onChange={(e) => handleChange("hashtags", e.target.value)}
              />
            </div>

            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Configuration"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
