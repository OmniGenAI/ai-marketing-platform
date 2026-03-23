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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, Loader2, CheckCircle } from "lucide-react";
import api from "@/lib/api";

interface BusinessConfigState {
  business_name: string;
  niche: string;
  tone: string;
  products: string;
  brand_voice: string;
  hashtags: string;
  target_audience: string;
  platform_preference: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  website_context: string | null;
}

export default function BusinessConfigPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [config, setConfig] = useState<BusinessConfigState>({
    business_name: "",
    niche: "",
    tone: "professional",
    products: "",
    brand_voice: "",
    hashtags: "",
    target_audience: "",
    platform_preference: "both",
    email: "",
    phone: "",
    address: "",
    website: "",
    website_context: null,
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get("/api/business-config");
        if (response.data) {
          setConfig({
            ...config,
            ...response.data,
            email: response.data.email || "",
            phone: response.data.phone || "",
            address: response.data.address || "",
            website: response.data.website || "",
          });
        }
      } catch (error: unknown) {
        const err = error as { response?: { status?: number } };
        if (err.response?.status !== 404) {
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
      const dataToSend = {
        ...config,
        email: config.email || null,
        phone: config.phone || null,
        address: config.address || null,
        website: config.website || null,
      };
      await api.post("/api/business-config", dataToSend);
      toast.success("Business configuration saved!");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeWebsite = async () => {
    if (!config.website) {
      toast.error("Please enter a website URL first");
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await api.post("/api/business-config/scrape-website", {
        url: config.website,
      });

      if (response.data.success) {
        toast.success("Website analyzed successfully!");
        setConfig((prev) => ({
          ...prev,
          website_context: JSON.stringify(response.data.context),
        }));
      } else {
        toast.error(response.data.message || "Failed to analyze website");
      }
    } catch {
      toast.error("Failed to analyze website");
    } finally {
      setIsAnalyzing(false);
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

      <form onSubmit={handleSubmit} className="space-y-6">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
            <CardDescription>
              Add your contact details for AI to include in posts when relevant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Business Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="hello@yourbusiness.com"
                  value={config.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={config.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Business Address</Label>
              <Textarea
                id="address"
                placeholder="123 Main Street, City, State 12345"
                value={config.address}
                onChange={(e) => handleChange("address", e.target.value)}
                rows={2}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="website">Website URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="website"
                    type="url"
                    placeholder="https://www.yourbusiness.com"
                    value={config.website}
                    onChange={(e) => handleChange("website", e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAnalyzeWebsite}
                    disabled={isAnalyzing || !config.website}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Globe className="mr-2 h-4 w-4" />
                        Analyze Website
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll analyze your website to help AI understand your business better.
                </p>
              </div>

              {config.website_context && (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-md">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-300">
                    Website analyzed successfully
                  </span>
                  <Badge variant="secondary" className="ml-auto">
                    Context saved
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={isLoading} size="lg">
          {isLoading ? "Saving..." : "Save Configuration"}
        </Button>
      </form>
    </div>
  );
}
