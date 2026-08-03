import type { NextConfig } from "next";

// GitHub Pages serves this repo at /Bim/, so only prefix paths when
// building for that target (GH_PAGES=1, set by the deploy workflow).
// Local dev, `next start`, and the Capacitor build stay at the root.
const basePath = process.env.GH_PAGES === "1" ? "/Bim" : "";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath,
};

export default nextConfig;
