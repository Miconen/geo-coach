import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
  test: {
    environment: "node",
    // e2e/ holds Playwright specs (pnpm e2e).
    exclude: [...configDefaults.exclude, "e2e/**"],
    testTimeout: 20_000,
    // Each file migrates a fresh PGlite database in beforeEach, slow when every package tests at once
    hookTimeout: 30_000,
  },
});
