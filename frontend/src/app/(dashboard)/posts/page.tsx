"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Post } from "@/types";

const statusColors: Record<string, string> = {
  draft: "secondary",
  published: "default",
  failed: "destructive",
  scheduled: "outline",
};

export default function PostsPage() {
  const qc = useQueryClient();

  const { data: posts = [], isLoading } = useQuery<Post[]>({
    queryKey: ["posts"],
    queryFn: async () => (await api.get<Post[]>("/api/posts")).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => (await api.post<Post>(`/api/posts/${id}/publish`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Post published successfully!");
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err.response?.data?.detail || "Failed to publish post");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/api/posts/${id}`); return id; },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Post deleted");
    },
    onError: () => toast.error("Failed to delete post"),
  });

  const publishingId = publishMutation.isPending ? publishMutation.variables ?? null : null;

  const handlePublish = (id: string) => publishMutation.mutate(id);
  const handleDelete = (id: string) => deleteMutation.mutate(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Posts</h1>
        <p className="text-muted-foreground">
          View and manage your generated social media posts.
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading posts...</p>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No posts yet.</p>
            <p className="text-sm text-muted-foreground">
              Go to Generate Post to create your first post!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Card key={post.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge
                    variant={
                      statusColors[post.status] as
                        | "default"
                        | "secondary"
                        | "destructive"
                    }
                  >
                    {post.status}
                  </Badge>
                  <Badge variant="outline">{post.platform}</Badge>
                </div>
                <CardDescription className="text-xs">
                  {new Date(post.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-4 text-sm">{post.content}</p>
                {post.hashtags && (
                  <p className="text-xs text-muted-foreground">
                    {post.hashtags}
                  </p>
                )}
                <div className="flex gap-2">
                  {post.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => handlePublish(post.id)}
                      disabled={publishingId === post.id}
                    >
                      {publishingId === post.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3 w-3" />
                      )}
                      {publishingId === post.id ? "Publishing..." : "Publish"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(post.id)}
                    className="gap-1 text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
