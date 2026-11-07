import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Off: GET API routes must serve live store data, not build-time prerenders.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
