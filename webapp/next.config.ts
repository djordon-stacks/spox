import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages (`out/`). Local `pnpm dev` is unaffected.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath
    ? {
        basePath,
        assetPrefix: basePath,
      }
    : {}),
  webpack: (config) => {
    config.resolve.alias["pino-pretty"] = false;
    return config;
  },
};

export default nextConfig;
