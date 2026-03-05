import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
};

if (process.env.NODE_ENV === "development") {
  nextConfig.rewrites = async () => [
    {
      source: "/api/:path*",
      destination: "http://localhost:3001/api/:path*",
    },
  ];
}

export default nextConfig;
