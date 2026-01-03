import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React StrictMode intentionally double-invokes effects in development.
  // This project creates WebGL + PartySocket connections on mount; the double-mount
  // can lead to duplicate connects and WebGL context churn (and eventual context loss)
  // on some GPUs/browsers. Keep it off unless we're explicitly testing StrictMode.
  reactStrictMode: false,
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
