import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "weaviate-client",
    "pdf-parse",
    "mammoth",
    "@prisma/client",
    "@prisma/adapter-pg",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
  ],
  images: {
    localPatterns: [
      // cache-busted logo
      { pathname: "/logo.png", search: "?v=2" },
      // all other local images (no query string)
      { pathname: "/**", search: "" },
    ],
    remotePatterns: [
      // site favicons for connected sources (Google favicon service)
      { protocol: "https", hostname: "www.google.com", pathname: "/s2/favicons" },
    ],
  },
};

export default nextConfig;
