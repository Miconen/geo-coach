import { describe, expect, it } from "vitest";
import { parseDeveloperMode, serializeDeveloperMode } from "../developer-mode-storage.js";

describe("Developer mode storage", () => {
  it("defaults to off", () => {
    expect(parseDeveloperMode(null)).toBe(false);
    expect(parseDeveloperMode(undefined)).toBe(false);
    expect(parseDeveloperMode("garbage")).toBe(false);
  });

  it("round-trips both values", () => {
    expect(parseDeveloperMode(serializeDeveloperMode(true))).toBe(true);
    expect(parseDeveloperMode(serializeDeveloperMode(false))).toBe(false);
  });
});
