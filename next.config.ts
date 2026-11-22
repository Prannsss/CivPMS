import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // CSP + clickjacking/sniffing/referrer headers on every route (docs/DECISIONS.md D9a).
  async headers() {
    const headers = securityHeaders({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      mediaApiUrl: process.env.NEXT_PUBLIC_MEDIA_API_URL,
      isDev: process.env.NODE_ENV !== "production",
    });
    return [{ source: "/:path*", headers }];
  },
  // The floating dev-tools badge overlaps the mobile bottom-left corner (sheet nav, toasts).
  devIndicators: false,
  // Next logs every Server Function call with its arguments in development, which would
  // print passwords (sign-in, sign-up, password change) to the dev terminal. Keep it off.
  logging: {
    serverFunctions: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/**" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
