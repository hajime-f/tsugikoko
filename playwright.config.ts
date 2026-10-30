import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fsqFixture } from "./tests/fixtures/foursquare";

const deployedUrl = process.env.E2E_BASE_URL;
const authEmulator = process.env.E2E_AUTH_EMULATOR === "1";
const analytics = process.env.E2E_ANALYTICS === "1";
const adsSignup = process.env.E2E_ADS_SIGNUP === "1";
const adsense = process.env.E2E_ADSENSE === "1";
const adsenseSlot = adsense && process.env.E2E_ADSENSE_SLOT === "1";
const foursquare = process.env.E2E_FOURSQUARE === "1";
const fsqPath = resolve(".agent-bridge/runtime/foursquare-e2e.json");
if (foursquare && authEmulator) { mkdirSync(resolve(".agent-bridge/runtime"), { recursive: true }); writeFileSync(fsqPath, JSON.stringify(fsqFixture())); }
const localUrl = authEmulator ? "http://127.0.0.1:3101" : "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: authEmulator ? (adsense ? "adsense.spec.ts" : foursquare ? "foursquare.spec.ts" : analytics ? ["analytics.spec.ts", "ads-conversion.spec.ts"] : ["auth.spec.ts", "places.spec.ts", "recommendations.spec.ts"]) : "landing.spec.ts",
  timeout: 45_000,
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: deployedUrl ?? localUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: deployedUrl ? undefined : {
    command: authEmulator ? "npm run build && npm run start -- --hostname 127.0.0.1 --port 3101" : "npm run start -- --hostname 127.0.0.1 --port 3100",
    env: authEmulator ? { NEXT_PUBLIC_ADSENSE_SLOT_MYLIST: adsenseSlot ? "1234567890" : "", NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_MYLIST: "", NEXT_PUBLIC_ADSENSE_ENABLED: adsense ? "true" : "false", FOURSQUARE_ENABLED: foursquare ? "true" : "false", FOURSQUARE_CATALOG_PATH: foursquare ? fsqPath : "", NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL: adsSignup ? "TestSignupLabel123" : "", NEXT_PUBLIC_GA_MEASUREMENT_ID: analytics ? "G-TSUGIKOKOTEST" : "", NEXT_PUBLIC_AUTH_EMULATOR_URL: "http://127.0.0.1:9099", NEXT_PUBLIC_AUTH_PROVIDERS: "google.com,twitter.com,facebook.com,apple.com", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "demo-tsugikoko" } : undefined,
    url: localUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
