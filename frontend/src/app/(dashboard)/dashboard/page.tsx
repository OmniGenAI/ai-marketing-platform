"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import api from "@/lib/api";
import type { Wallet, Subscription, Post } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Sparkles, FileText, CreditCard, Building2, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [walletRes, subscriptionRes, postsRes] = await Promise.all([
          api.get<Wallet>("/api/wallet").catch(() => ({ data: null })),
          api.get<Subscription | null>("/api/subscription/status").catch(() => ({ data: null })),
          api.get<Post[]>("/api/posts").catch(() => ({ data: [] })),
        ]);

        setWallet(walletRes.data);
        setSubscription(subscriptionRes.data);
        setPosts(postsRes.data || []);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const publishedCount = posts.filter((p) => p.status === "published").length;
  const recentPosts = posts.slice(0, 3);
  const planName = subscription?.plan?.name || "Free";
  const credits = wallet?.balance ?? 0;

  // Format credits: -1 means unlimited
  const formatCredits = (balance: number) => {
    if (balance === -1) return "Unlimited";
    return balance.toString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          Welcome back{user?.name ? `, ${user.name}` : ""}!
        </h1>
        <p className="text-muted-foreground">
          Here&apos;s an overview of your AI marketing activity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Credits Remaining
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : formatCredits(credits)}
            </div>
            <p className="text-xs text-muted-foreground">available credits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Posts Generated
            </CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : posts.length}
            </div>
            <p className="text-xs text-muted-foreground">total posts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Posts Published
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : publishedCount}
            </div>
            <p className="text-xs text-muted-foreground">total published</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Plan</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : planName}
            </div>
            <p className="text-xs text-muted-foreground">current plan</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Get started with these actions</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link href="/generate/social">
              <Button className="w-full justify-start gap-2">
                <Sparkles className="h-4 w-4" />
                Generate New Post
              </Button>
            </Link>
            <Link href="/brand-kit">
              <Button variant="outline" className="w-full justify-start gap-2">
                <Building2 className="h-4 w-4" />
                Configure Business
              </Button>
            </Link>
            <Link href="/posts">
              <Button variant="outline" className="w-full justify-start gap-2">
                <FileText className="h-4 w-4" />
                View My Posts
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Posts</CardTitle>
            <CardDescription>Your latest generated posts</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recentPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No posts yet. Generate your first post to get started!
              </p>
            ) : (
              <div className="space-y-3">
                {recentPosts.map((post) => (
                  <div
                    key={post.id}
                    className="flex items-start justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">{post.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(post.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-xs">
                        {post.platform}
                      </Badge>
                      <Badge
                        variant={
                          post.status === "published"
                            ? "default"
                            : post.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-xs"
                      >
                        {post.status}
                      </Badge>
                    </div>                  </div>
                ))}
                {posts.length > 3 && (
                  <Link href="/posts">
                    <Button variant="ghost" size="sm" className="w-full mt-2">
                      View all {posts.length} posts
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
