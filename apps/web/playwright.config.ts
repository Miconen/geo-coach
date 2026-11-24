import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach_e2e";

// Run `pnpm e2e:seed` first: it recreates E2E_DATABASE_URL's database and writes e2e/.seed.json.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite dev --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      DATABASE_URL: E2E_DATABASE_URL,
      E2E_SPIKE: "1",
      // The worker API (e2e plays the worker) and a short online window for the worker-status tests.
      PROCESSOR_SECRET: "e2e-processor-secret",
      PROCESSOR_ONLINE_MS: "3000",
    },
  },
});
