import { describe, expect, it } from "vitest";
import type { Overview, RatingGapPoint } from "@geo-coach/shared";
import {
  climbingTakeaway,
  damageTakeaway,
  formatSigned,
  ratedAboveTakeaway,
} from "../overview-text.js";

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    countryFiltered: false,
    games: {
      games: 10,
      decided: 10,
      wins: 6,
      winRate: 0.6,
      ratingFrom: 1180,
      rating: 1222,
      ratingChange: 42,
      position: 398,
    },
    rounds: {
      rounds: 50,
      roundsWon: 30,
      roundsDecided: 48,
      roundWinRate: 30 / 48,
      avgDuoScore: 4000,
      avgOpponentScore: 3800,
      avgDamageDealt: 600,
      avgDamageTaken: 400,
      medianDuoSecondsToGuess: 18,
      medianOpponentSecondsToGuess: 21,
    },
    rating: [],
    streaks: { current: 2, best: 4, worst: 3, winRuns: [], lossRuns: [] },
    ratedAbove: { unit: "games", points: [], bands: [] },
    damage: { slowThresholdSeconds: 31.6, points: [], classes: [] },
    ...overrides,
  };
}

const point = (ratingGap: number, won: boolean): RatingGapPoint => ({
  id: `${ratingGap}${won}`,
  gameId: "g",
  startedAtMs: 0,
  ratingGap,
  won,
  netDamage: 0,
  scoreGapPerRound: 0,
});

describe("overview takeaways", () => {
  it("sums up the climb", () => {
    expect(climbingTakeaway(overview())).toBe("Up 42 over 10 Games (1180 → 1222), winning 60% of 10.");
    expect(
      climbingTakeaway(overview({ games: { ...overview().games, ratingChange: null } })),
    ).toBe("No rated Games in this filter.");
  });

  it("compares the win rate against higher-rated Opponents with the rest, in the chart's unit", () => {
    const points = [point(80, true), point(120, false), point(-40, true), point(0, true)];
    expect(ratedAboveTakeaway(overview({ ratedAbove: { unit: "games", points, bands: [] } }))).toBe(
      "We win 50% of 2 Games against higher-rated Opponents, against 100% of 2 Games against the rest.",
    );
    expect(ratedAboveTakeaway(overview({ ratedAbove: { unit: "rounds", points, bands: [] } }))).toBe(
      "We win 50% of 2 Rounds against higher-rated Opponents, against 100% of 2 Rounds against the rest. " +
        "Rounds stand in for Games under a country filter.",
    );
  });

  it("names the mistake class that costs most", () => {
    const o = overview({
      damage: {
        slowThresholdSeconds: 31.6,
        points: [
          {
            roundId: "r",
            gameId: "g",
            countryCode: "BG",
            regionCode: null,
            mistakeClass: "wrong-country",
            km: 400,
            share: 1.2,
            points: 1200,
            damage: 3000,
            secondsToGuess: 40,
            slow: true,
          },
        ],
        classes: [
          { mistakeClass: "wrong-country", rounds: 3, damage: 3000 },
          { mistakeClass: "far", rounds: 2, damage: 800 },
          { mistakeClass: "close", rounds: 5, damage: 200 },
        ],
      },
    });
    expect(damageTakeaway(o)).toBe(
      "Wrong country costs most: 3,000 damage over 3 Rounds, 75% of the damage taken. " +
        "Ringed guesses were slow (over 32 s).",
    );
    expect(damageTakeaway(overview())).toBe("No lost Rounds in this filter.");
  });

  it("signs numbers with a real minus", () => {
    expect(formatSigned(1234.4)).toBe("+1,234");
    expect(formatSigned(-50)).toBe("−50");
    expect(formatSigned(0)).toBe("±0");
  });
});
