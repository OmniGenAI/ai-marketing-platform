import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "**.supabase.in",
      },
    ],
  },
  // Server-side proxy: when API_PROXY_TARGET is set (e.g. via ngrok dev),
  // /api/* requests from the browser are silently forwarded to the local
  // backend. This lets a single HTTPS tunnel front both frontend and
  // backend, avoiding mixed-content / CORS issues on free ngrok.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    if (!target) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${target.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
