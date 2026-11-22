import { describe, expect, it } from "vitest";
import type { FirstTeamOutcome, ScoreByTimeRow, SpeedStats } from "@geo-coach/shared";
import {
  bucketLabel,
  fasterTrendTakeaway,
  firstTeamTakeaway,
  slowerTakeaway,
  speedPaysTakeaway,
  spreadLabel,
} from "../speed-text.js";

const nameOf = (id: string) => (id === "miko" ? "Mico" : "?");

function outcome(team: FirstTeamOutcome["team"], o: Partial<FirstTeamOutcome> = {}): FirstTeamOutcome {
  return { team, rounds: 0, share: 0, roundWinRate: null, avgNetDamage: null, avgDuoScore: null, avgOpponentScore: null, ...o };
}

function stats(o: Partial<SpeedStats> = {}): SpeedStats {
  return {
    rounds: 100,
    spreads: [
      { group: { kind: "duo-first" }, count: 100, p25: 15, median: 23.4, p75: 30 },
      { group: { kind: "opponents-first" }, count: 100, p25: 12, median: 19.1, p75: 28 },
    ],
    firstTeams: [
      outcome("duo", { rounds: 45, share: 0.45, roundWinRate: 0.62 }),
      outcome("opponents", { rounds: 55, share: 0.55, roundWinRate: 0.41 }),
    ],
    scoreByTime: [],
    series: [],
    ...o,
  };
}

const row = (o: Partial<ScoreByTimeRow>): ScoreByTimeRow => ({
  side: "duo",
  from: 0,
  to: 10,
  timedOut: false,
  guesses: 10,
  avgScore: 4000,
  medianKm: 100,
  ...o,
});

describe("speed labels", () => {
  it("names groups and buckets", () => {
    expect(spreadLabel({ group: { kind: "player", playerId: "miko" }, count: 0, p25: null, median: null, p75: null }, nameOf)).toBe("Mico");
    expect(bucketLabel({ from: 10, to: 20, timedOut: false })).toBe("10–20 s");
    expect(bucketLabel({ from: 90, to: null, timedOut: false })).toBe("90 s+");
    expect(bucketLabel({ from: null, to: null, timedOut: true })).toBe("Timed out");
  });
});

describe("speed takeaways", () => {
  it("says whether we're slower than the Opponents", () => {
    expect(slowerTakeaway(stats())).toBe(
      "Our first guess comes at a median 23.4 s, the Opponents' at 19.1 s: we're 4.3 s slower.",
    );
  });

  it("says who presses first and how those Rounds go", () => {
    expect(firstTeamTakeaway(stats())).toBe(
      "We press guess first in 45% of 100 Rounds and win 62% of them; when they press first we win 41%.",
    );
  });

  it("compares our fastest and slowest well-filled buckets", () => {
    expect(
      speedPaysTakeaway([
        row({ from: 0, to: 10, avgScore: 4321 }),
        row({ from: 10, to: 20, guesses: 2, avgScore: 100 }),
        row({ from: 30, to: 45, avgScore: 3800 }),
        row({ from: 60, to: 90, guesses: 1 }),
        row({ from: null, to: null, timedOut: true, avgScore: 2500 }),
        row({ side: "opponents", from: 90, to: null }),
      ]),
    ).toBe("Our guesses at 0–10 s average 4,321 points, at 30–45 s 3,800, and timed-out guesses 2,500.");
    expect(speedPaysTakeaway([row({})])).toMatch(/^Need at least two/);
  });

  it("describes the speed trend, or why there is none", () => {
    expect(fasterTrendTakeaway([], 10, 50)).toBe("Trends need at least 50 Rounds; this filter has 10.");
    expect(
      fasterTrendTakeaway(
        [
          { roundIndex: 50, duoMedian: 25, opponentsMedian: 20, duoFirstShare: 0.4 },
          { roundIndex: 60, duoMedian: 21, opponentsMedian: 20.5, duoFirstShare: 0.5 },
        ],
        60,
        50,
      ),
    ).toBe("Over 50-Round windows, our first guess went 25.0 s → 21.0 s, theirs 20.0 s → 20.5 s.");
  });
});
