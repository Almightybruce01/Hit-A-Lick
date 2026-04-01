// @ts-check
import { defineConfig, devices } from "@playwright/test";

const appUrl =
  process.env.HITALICK_E2E_APP || "https://hit-a-lick-database.web.app/app.html";

let baseURL = "https://hit-a-lick-database.web.app";
try {
  baseURL = new URL(appUrl).origin;
} catch {
  /* keep default */
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
      ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1400, height: 900 },
    actionTimeout: 45_000,
    navigationTimeout: 120_000,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
});
