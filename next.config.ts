import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run runs `node server.js` from this trimmed, self-contained
  // output (Dockerfile's runtime stage) rather than a full `node_modules`
  // checkout.
  output: "standalone",
};

export default nextConfig;
