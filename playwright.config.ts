import { defineConfig, devices } from "@playwright/test";

const deployedUrl = process.env.E2E_BASE_URL;
const authEmulator = process.env.E2E_AUTH_EMULATOR === "1";
const localUrl = authEmulator ? "http://127.0.0.1:3101" : "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: authEmulator ? ["auth.spec.ts", "places.spec.ts", "recommendations.spec.ts"] : "landing.spec.ts",
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
    env: authEmulator ? { NEXT_PUBLIC_AUTH_EMULATOR_URL: "http://127.0.0.1:9099", NEXT_PUBLIC_AUTH_PROVIDERS: "google.com,twitter.com,facebook.com,apple.com", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "demo-tsugikoko" } : undefined,
    url: localUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
