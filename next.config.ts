import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL ? ".next-auth-test" : ".next",
};

export default nextConfig;
