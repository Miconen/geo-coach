import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMOOTHING,
  SMOOTHING_LEVELS,
  SMOOTHING_PARAM,
  parseSmoothing,
  rollingMean,
  rollingWindows,
  smoothingWindow,
} from "../index.js";

describe("parseSmoothing", () => {
  it("reads a known level from the URL", () => {
    for (const level of SMOOTHING_LEVELS) {
      expect(parseSmoothing(new URLSearchParams({ [SMOOTHING_PARAM]: level }))).toBe(level);
    }
  });

  it("falls back to the default for a missing or unknown level", () => {
    expect(parseSmoothing(new URLSearchParams())).toBe(DEFAULT_SMOOTHING);
    expect(parseSmoothing(new URLSearchParams({ [SMOOTHING_PARAM]: "extreme" }))).toBe(DEFAULT_SMOOTHING);
  });
});

describe("smoothingWindow", () => {
  it("keeps the 50-Round Players window at the default level", () => {
    expect(smoothingWindow(DEFAULT_SMOOTHING, "rounds")).toBe(50);
  });

  it("is one Game (no smoothing) when off, but never below a usable Round window", () => {
    expect(smoothingWindow("off", "games")).toBe(1);
    expect(smoothingWindow("off", "rounds")).toBeGreaterThan(1);
  });

  it("grows with the level", () => {
    for (const unit of ["games", "rounds"] as const) {
      const windows = SMOOTHING_LEVELS.map((l) => smoothingWindow(l, unit));
      expect([...windows].sort((a, b) => a - b)).toEqual(windows);
    }
  });
});

describe("rollingMean", () => {
  it("averages each full trailing window and leaves earlier points null", () => {
    expect(rollingMean([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns the values unchanged with a window of 1", () => {
    expect(rollingMean([5, null, 7], 1)).toEqual([5, null, 7]);
  });

  it("skips nulls inside a window, and is null when the whole window is null", () => {
    expect(rollingMean([1, null, 3, null, null], 2)).toEqual([null, 1, 3, 3, null]);
  });
});

describe("rollingWindows", () => {
  it("gives each full window with its 1-based end, never a partial one", () => {
    expect(rollingWindows(["a", "b", "c"], 2)).toEqual([
      { end: 2, items: ["a", "b"] },
      { end: 3, items: ["b", "c"] },
    ]);
    expect(rollingWindows(["a"], 2)).toEqual([]);
  });
});
