import { describe, expect, it } from "vitest";
import type { CountryVersusRow, VersusNumbers, VersusPoint } from "@geo-coach/shared";
import { aheadTakeaway, outGuessedCountries, outGuessedTakeaway, versusHeadline } from "../versus-text.js";

function numbers(o: Partial<VersusNumbers> = {}): VersusNumbers {
  return {
    rounds: 10,
    avgDuoScore: 4000,
    avgOpponentScore: 4000,
    duoMedianKm: 120,
    opponentsMedianKm: 150,
    compared: 10,
    closerShare: 0.6,
    ...o,
  };
}
const country = (countryCode: string, o: Partial<VersusNumbers> = {}): CountryVersusRow => ({
  countryCode,
  ...numbers(o),
});
const point = (roundIndex: number, closerShare: number): VersusPoint => ({ roundIndex, ...numbers({ closerShare }) });

describe("versus takeaways", () => {
  it("sums up the best-guess comparison", () => {
    expect(versusHeadline(numbers())).toBe(
      "Our best guess was the closer one in 60% of 10 Rounds: median 120 km off against their 150 km.",
    );
    expect(versusHeadline(numbers({ compared: 0 }))).toMatch(/^No Rounds/);
  });

  it("names the countries where the Opponents are closer most often, above the threshold", () => {
    const rows = [
      country("BR", { closerShare: 0.3 }),
      country("RU", { closerShare: 0.45 }),
      country("US", { closerShare: 0.2, rounds: 2 }),
      country("FR", { closerShare: 0.7 }),
    ];
    expect(outGuessedCountries(rows, 5).map((r) => r.countryCode)).toEqual(["BR", "RU", "FR"]);
    expect(outGuessedTakeaway(rows, 5)).toBe(
      "The Opponents out-guess us most in Brazil (ours closer 30%) and Russia (ours closer 45%).",
    );
    expect(outGuessedTakeaway([country("FR")], 5)).toMatch(/at least half the time/);
    expect(outGuessedTakeaway([country("FR", { rounds: 1 })], 5)).toMatch(/^No country/);
  });

  it("says whether we're pulling ahead", () => {
    expect(aheadTakeaway([point(50, 0.45), point(80, 0.55)], 80, 50)).toBe(
      "Over 50-Round windows, we're pulling ahead: our best guess was closer in 45% → 55% of Rounds.",
    );
    expect(aheadTakeaway([point(50, 0.5), point(80, 0.51)], 80, 50)).toMatch(/holding level/);
    expect(aheadTakeaway([], 3, 50)).toBe("Trends need at least 50 Rounds; this filter has 3.");
  });
});
