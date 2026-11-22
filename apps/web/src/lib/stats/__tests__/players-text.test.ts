import { describe, expect, it } from "vitest";
import type { BestGuess, FirstGuesserStats, PlayerSummary } from "@geo-coach/shared";
import {
  bestGuessReasons,
  carryTakeaway,
  firstTakeaway,
  flagEmoji,
  trendTakeaway,
  waitingTakeaway,
} from "../players-text.js";

const NAMES: Record<string, string> = { miko: "Mico", sora: "Cerkie" };
const nameOf = (id: string) => NAMES[id] ?? "?";

function summary(playerId: string, overrides: Partial<PlayerSummary> = {}): PlayerSummary {
  const group = { guesses: 0, avgScore: null, medianKm: null };
  return {
    playerId,
    rounds: 100,
    bestRounds: 50,
    bestShare: 0.5,
    medianKm: 100,
    medianSeconds: 20,
    placed: 100,
    timedOut: 0,
    timedOutShare: 0,
    noGuess: 0,
    waiting: { pressed: group, timedOut: group },
    ...overrides,
  };
}

describe("players takeaways", () => {
  it("says who carries", () => {
    expect(
      carryTakeaway([summary("miko", { bestShare: 0.52 }), summary("sora", { bestShare: 0.48 })], nameOf),
    ).toBe("Mico had the best guess in 52% and Cerkie 48% of 100 Rounds.");
    expect(carryTakeaway([summary("miko", { rounds: 0 })], nameOf)).toBe("No Rounds in this filter.");
  });

  it("says who presses first and how often they're then the best", () => {
    const stats: FirstGuesserStats = {
      rounds: 100,
      bothTimedOut: 26,
      bothTimedOutShare: 0.26,
      noPressedGuess: 0,
      players: [
        { playerId: "miko", first: 61, share: 0.61, bestShareWhenFirst: 0.51, bestShareWhenOtherFirst: 0.4 },
        { playerId: "sora", first: 13, share: 0.13, bestShareWhenFirst: 0.58, bestShareWhenOtherFirst: 0.49 },
      ],
    };
    expect(firstTakeaway(stats, nameOf)).toBe(
      "Mico pressed guess first in 61% and Cerkie 13% of Rounds; both timed out in 26%. " +
        "Best guess when first: Mico 51% (40% otherwise) and Cerkie 58% (49% otherwise).",
    );
  });

  it("compares timed-out with pressed guesses", () => {
    const waiting = (pressed: number, timedOut: number) => ({
      pressed: { guesses: 10, avgScore: pressed, medianKm: 1 },
      timedOut: { guesses: 10, avgScore: timedOut, medianKm: 1 },
    });
    expect(
      waitingTakeaway(
        [summary("miko", { waiting: waiting(4210, 3900) }), summary("sora", { waiting: waiting(4000, 4050) })],
        nameOf,
      ),
    ).toBe(
      "Timed-out guesses average 310 points less than pressed ones for Mico and 50 points more for Cerkie, on Rounds that aren't Splits.",
    );
    expect(waitingTakeaway([summary("miko")], nameOf)).toMatch(/^No Player/);
  });

  it("explains an empty trend", () => {
    expect(trendTakeaway([], 32, 50, nameOf)).toBe("Trends need at least 50 Rounds; this filter has 32.");
    expect(
      trendTakeaway(
        [
          {
            playerId: "miko",
            points: [
              { roundIndex: 50, bestShare: 0.48, medianKm: 320 },
              { roundIndex: 51, bestShare: 0.55, medianKm: 250 },
            ],
          },
        ],
        51,
        50,
        nameOf,
      ),
    ).toBe("Over 50-Round windows, first to latest: Mico 48% → 55% best, 320 → 250 km.");
  });
});

describe("best-guess rows", () => {
  it("turns country codes into flags", () => {
    expect(flagEmoji("KE")).toBe("🇰🇪");
    expect(flagEmoji(null)).toBe("");
  });

  it("lists the reasons a guess stands out", () => {
    const b: BestGuess = {
      roundId: "r1",
      gameId: "g1",
      countryCode: "KE",
      regionCode: null,
      score: 3600,
      distanceMeters: 120_000,
      lead: 2100,
      othersInOtherCountry: 3,
      secondsSooner: 18.4,
      mode: "nmpz",
      othersAvgScore: 1800,
      standout: 0,
    };
    expect(bestGuessReasons(b)).toEqual([
      "+2,100 over next",
      "3 others in another country",
      "18 s sooner",
      "NMPZ",
    ]);
    expect(bestGuessReasons({ ...b, othersInOtherCountry: 1, secondsSooner: 0, mode: "moving" })).toEqual([
      "+2,100 over next",
      "1 other in another country",
    ]);
  });
});
