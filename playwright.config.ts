import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against its own throwaway database and dev server on :3100 (see tests/e2e/server.mjs).
 * Uses the MySQL server and user from DATABASE_URL (see .env.example); never the database named there.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://localhost:3100/login",
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
