import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 20_000,
    // Each file migrates a fresh PGlite database in beforeEach, slow when every package tests at once
    hookTimeout: 30_000,
  },
});
