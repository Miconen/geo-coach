import { describe, expect, it } from "vitest";
import type { HedgeKind, HedgeKindStats, HedgeSummary, TeamHedgeSummary } from "@geo-coach/shared";
import { callsNote, countryHedgeTakeaway, distancePhrase, hedgeTakeaway } from "../hedge-text.js";

function kind(k: HedgeKind, rounds: number, share: number | null, avgScoreGap: number | null): HedgeKindStats {
  return {
    kind: k,
    rounds,
    share,
    avgScoreGap,
    avgDamage: avgScoreGap,
    rightCountry: null,
    rightRegion: null,
    medianDistanceKm: null,
    medianSpread: null,
  };
}

function team(t: "duo" | "opponents", counts: [number, number, number], gaps: [number, number, number]): TeamHedgeSummary {
  const total = counts[0] + counts[1] + counts[2];
  const share = (n: number) => (total ? n / total : null);
  return {
    team: t,
    kinds: [
      kind("committed", counts[0], share(counts[0]), counts[0] ? gaps[0] : null),
      kind("spread", counts[1], share(counts[1]), counts[1] ? gaps[1] : null),
      kind("split", counts[2], share(counts[2]), counts[2] ? gaps[2] : null),
    ],
    classified: total,
    unclassified: 0,
  };
}

const none = { called: 0, notCalled: 0, unlabelled: 0 };

function summary(calls: HedgeSummary["calls"] = { split: none, spread: none }): HedgeSummary {
  return {
    duo: team("duo", [10, 60, 30], [160, -50, -3]),
    opponents: team("opponents", [8, 62, 30], [470, 100, -260]),
    calls,
  };
}

describe("hedgeTakeaway", () => {
  it("gives our shares against the Opponents and describes each kind's gap", () => {
    expect(hedgeTakeaway(summary(), 5)).toBe(
      "Of 100 Rounds, we commit in 10% (Opponents 8%), Spread in 60% (Opponents 62%), Split in 30% (Opponents 30%). " +
        "When we commit, our score gap averages +160; when we Spread, −50; when we Split, −3.",
    );
  });

  it("leaves kinds below the grey-out threshold out of the outcomes", () => {
    expect(hedgeTakeaway(summary(), 20)).not.toMatch(/when we commit/i);
  });

  it("never claims causation", () => {
    expect(hedgeTakeaway(summary(), 5)).not.toMatch(/because|causes|leads to|should/i);
  });

  it("says when no Round has both guesses placed", () => {
    const empty = { ...summary(), duo: team("duo", [0, 0, 0], [0, 0, 0]) };
    expect(hedgeTakeaway(empty, 5)).toBe("No Rounds where both of our guesses were placed in this filter.");
  });
});

describe("callsNote", () => {
  it("says unlabelled Rounds are unlabelled, not not called", () => {
    expect(callsNote(summary({ split: { called: 0, notCalled: 0, unlabelled: 3 }, spread: { called: 0, notCalled: 0, unlabelled: 7 } }))).toBe(
      "None of our 10 Splits and Spreads has a Call label yet: no calls run has read them.",
    );
    expect(callsNote(summary({ split: { called: 2, notCalled: 1, unlabelled: 3 }, spread: none }))).toBe(
      '3 of 6 Splits and Spreads have a Call label; the rest are unlabelled, not "not called".',
    );
  });
});

describe("countryHedgeTakeaway", () => {
  it("describes the kinds at or above the threshold in the country", () => {
    const duo = team("duo", [2, 12, 6], [100, -40, 20]);
    expect(countryHedgeTakeaway(duo, "Spain", 5)).toBe(
      "In Spain, our score gap averages −40 when we Spread (12 Rounds) and +20 when we Split (6 Rounds).",
    );
    expect(countryHedgeTakeaway(duo, "Spain", 50)).toBe(
      "No way of placing our guesses has 50 Rounds or more in Spain.",
    );
  });
});

describe("distancePhrase", () => {
  it("shows the distance and its share of the country's size", () => {
    expect(distancePhrase({ medianDistanceKm: 528, medianSpread: 0.479 })).toBe(
      "Median 528 km between the guesses, 0.48× the country's size",
    );
    expect(distancePhrase({ medianDistanceKm: null, medianSpread: null })).toBe("No distance between the guesses");
  });
});
