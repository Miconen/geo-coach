import { describe, expect, it } from "vitest";
import type { CountryRow } from "@geo-coach/shared";
import {
  countAndDamage,
  gapTakeaway,
  learningTakeaway,
  placeName,
  rowCountryOf,
} from "../rankings-text.js";

function row(countryCode: string, gap: number, rounds = 10, overrides: Partial<CountryRow> = {}): CountryRow {
  return {
    countryCode,
    rounds,
    gap,
    rawGap: gap,
    avgScore: 4000,
    rawAvgScore: 4000,
    netDamage: 0,
    rawNetDamage: 0,
    medianKm: null,
    wrongCountry: 0,
    far: 0,
    slow: 0,
    splits: 0,
    splitsCaught: 0,
    learnings: 0,
    firstLearningAtMs: null,
    beforeLearning: { rounds: 0, avgScore: null },
    afterLearning: { rounds: 0, avgScore: null },
    bestGuessShare: {},
    ...overrides,
  };
}

describe("placeName and rowCountryOf", () => {
  it("names countries, overseas Regions and the water", () => {
    expect(placeName("FR")).toBe("France");
    expect(placeName("FR-GUF")).toBe("French Guiana");
    expect(placeName(null)).toBe("the water");
  });

  it("maps an overseas Region back to its country's row", () => {
    expect(rowCountryOf("FR-GUF")).toBe("FR");
    expect(rowCountryOf("BG")).toBe("BG");
  });
});

describe("countAndDamage", () => {
  it("leaves out the damage when none was taken", () => {
    expect(countAndDamage({ count: 3, damage: 1234 })).toBe("3× · −1,234");
    expect(countAndDamage({ count: 1, damage: 0 })).toBe("1×");
  });
});

describe("gapTakeaway", () => {
  it("names the costliest and the strongest country", () => {
    const text = gapTakeaway([row("FR", 320, 8), row("BG", -40), row("RU", -680, 9)], 5);
    expect(text).toContain("Russia costs us most (−680 per Round over 9 Rounds)");
    expect(text).toContain("France carries us most (+320 per Round over 8 Rounds)");
  });

  it("says when no country reaches the threshold", () => {
    expect(gapTakeaway([], 5)).toBe("No country has 5 Rounds or more in this filter.");
  });
});

describe("learningTakeaway", () => {
  it("compares the average score before and after the first Learning", () => {
    const r = row("BG", 0, 3, {
      firstLearningAtMs: 1,
      beforeLearning: { rounds: 2, avgScore: 3200 },
      afterLearning: { rounds: 1, avgScore: 4500 },
    });
    expect(learningTakeaway(r)).toBe(
      "Average score before the first Learning: 3,200 over 2 Rounds; after: 4,500 over 1 Round.",
    );
  });

  it("says when no Learning names the country", () => {
    expect(learningTakeaway(row("BG", 0))).toBe("No Learning names Bulgaria yet.");
  });
});
