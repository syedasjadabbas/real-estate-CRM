import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, E2E_STORAGE_DIR, testDatabaseUrl } from "./e2e/support/guard";

/**
 * End-to-end tests (e2e/). They run the production build (`next start`) against the separate
 * TEST database only, with uploads in a temporary folder. Run `npm run test:e2e` (builds first).
 * Do not run at the same time as the Vitest suite: both reset the test database.
 */
const testDb = testDatabaseUrl();

export default defineConfig({
  testDir: "./e2e",
  // One worker: every test creates its own records, but they share one database and server.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: E2E_BASE_URL,
    // The installed Google Chrome: no Playwright browser download is needed.
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile-only/ },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, channel: "chrome" }, grep: /@mobile/ },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: testDb, FILE_STORAGE_DIR: E2E_STORAGE_DIR, NODE_ENV: "production" },
  },
});
