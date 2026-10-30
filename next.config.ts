import type { NextConfig } from "next";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

// 有効化した公開ビルドでは、実行時に必要な地域データの欠落を先に検出する。
let catalogFiles: string[] = [];
if (process.env.FOURSQUARE_ENABLED === "true") {
  if (!process.env.FOURSQUARE_CATALOG_PATH) throw new Error("Foursquare catalog path is required");
  const path = resolve(process.env.FOURSQUARE_CATALOG_PATH);
  const local = relative(process.cwd(), path).replaceAll("\\", "/");
  if (local.startsWith("../") || !local.endsWith(".json") || /[*?{}[\]]/.test(local)) throw new Error("Foursquare catalog must be a project-local JSON file");
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 50_000_000) throw new Error("Invalid Foursquare catalog file");
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  if (catalog.format !== 1 || catalog.source !== "Foursquare OS Places" || !Array.isArray(catalog.rows) || catalog.rows.length > 100_000 ||
      createHash("sha256").update(JSON.stringify(catalog.rows)).digest("hex") !== catalog.version) throw new Error("Invalid Foursquare catalog integrity");
  catalogFiles = [local];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL ? ".next-auth-test" : ".next",
  outputFileTracingIncludes: catalogFiles.length ? { "/api/places{,/**}": catalogFiles } : {},
};

export default nextConfig;
