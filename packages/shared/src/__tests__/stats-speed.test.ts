import { describe, expect, it } from "vitest";
import {
  SPEED_BUCKETS,
  firstPressSeconds,
  firstTeam,
  scoreByTime,
  speedSeries,
  speedStats,
  type StatsGuess,
  type StatsRound,
} from "../index.js";
import { makeGame, makeGuess, makeRound } from "./stats-fixtures.js";

const t0 = Date.parse("2026-11-01T18:00:00Z");

const duo = (playerId: string, seconds: number | null, o: Partial<StatsGuess> = {}) =>
  makeGuess({ playerId, countryCode: "BG", secondsToGuess: seconds, ...o });
const opp = (seconds: number | null, o: Partial<StatsGuess> = {}) =>
  makeGuess({ playerId: null, isDuo: false, countryCode: "BG", secondsToGuess: seconds, ...o });

let seq = 0;
function round(guesses: StatsGuess[], o: Partial<StatsRound> = {}): StatsRound {
  seq += 1;
  return makeRound(`r${seq}`, "g1", { startedAtMs: t0 + seq * 60_000, guesses, ...o });
}

describe("firstPressSeconds", () => {
  it("is the side's earliest pressed guess, ignoring timed-out guesses", () => {
    const r = round([duo("a", 30), duo("b", 5, { timedOut: true }), opp(12), opp(40)]);
    expect(firstPressSeconds(r, true)).toBe(30);
    expect(firstPressSeconds(r, false)).toBe(12);
  });

  it("is null when nobody on the side pressed guess", () => {
    expect(firstPressSeconds(round([duo("a", 60, { timedOut: true })]), true)).toBeNull();
  });
});

describe("firstTeam", () => {
  it("names the team whose first pressed guess came first", () => {
    expect(firstTeam(round([duo("a", 10), opp(20)]))).toBe("duo");
    expect(firstTeam(round([duo("a", 30), opp(20)]))).toBe("opponents");
  });

  it("counts a pressed guess as first against a side that only timed out", () => {
    expect(firstTeam(round([duo("a", 70, { timedOut: true }), opp(50)]))).toBe("opponents");
    expect(firstTeam(round([duo("a", 50), opp(70, { timedOut: true })]))).toBe("duo");
  });

  it("is a tie at the same moment, and nobody when no one pressed", () => {
    expect(firstTeam(round([duo("a", 20), opp(20)]))).toBe("tie");
    expect(firstTeam(round([duo("a", 70, { timedOut: true }), opp(70, { timedOut: true })]))).toBe("nobody");
  });
});

describe("scoreByTime", () => {
  it("buckets each side's pressed guesses by time and keeps timed-out guesses apart", () => {
    const rows = scoreByTime([
      round([duo("a", 5, { score: 4800 }), duo("b", 15, { score: 3000 }), opp(8, { score: 4000 })]),
      round([duo("a", 7, { score: 4600 }), opp(70, { timedOut: true, score: 1000 })]),
    ]);
    const duoRows = rows.filter((r) => r.side === "duo");
    expect(duoRows).toHaveLength(SPEED_BUCKETS.length + 1);
    expect(duoRows[0]).toMatchObject({ from: 0, to: 10, guesses: 2, avgScore: 4700 });
    expect(duoRows[1]).toMatchObject({ from: 10, to: 20, guesses: 1, avgScore: 3000 });
    const oppTimedOut = rows.find((r) => r.side === "opponents" && r.timedOut);
    expect(oppTimedOut).toMatchObject({ guesses: 1, avgScore: 1000, from: null });
  });

  it("leaves out a side's guesses on Rounds where that side Split", () => {
    const rows = scoreByTime([
      round([duo("a", 5, { countryCode: "BG" }), duo("b", 6, { countryCode: "RO" }), opp(5)]),
    ]);
    expect(rows.filter((r) => r.side === "duo").every((r) => r.guesses === 0)).toBe(true);
    expect(rows.find((r) => r.side === "opponents" && r.from === 0)?.guesses).toBe(1);
  });
});

describe("speedSeries", () => {
  it("gives rolling medians of each team's first press and the Duo's first share", () => {
    const rounds = [
      round([duo("a", 10), opp(20)]),
      round([duo("a", 30), opp(20)]),
      round([duo("a", 20), opp(40)]),
    ];
    expect(speedSeries(rounds, 2)).toEqual([
      { roundIndex: 2, duoMedian: 20, opponentsMedian: 20, duoFirstShare: 0.5 },
      { roundIndex: 3, duoMedian: 25, opponentsMedian: 30, duoFirstShare: 0.5 },
    ]);
  });
});

describe("speedStats", () => {
  it("compares the Duo's first press, the Opponents', each Player and each Opponent", () => {
    const rounds = [
      round([duo("a", 10), duo("b", 30), opp(20), opp(25)], { hpDelta: 500 }),
      round([duo("a", 40), duo("b", 50), opp(15), opp(18)], { hpDelta: -800 }),
    ];
    const stats = speedStats({ games: [makeGame("g1")], rounds }, [{ id: "a" }, { id: "b" }], 50);
    const medianOf = (kind: string, playerId?: string) =>
      stats.spreads.find((s) => s.group.kind === kind && (!playerId || ("playerId" in s.group && s.group.playerId === playerId)))
        ?.median;
    expect(medianOf("duo-first")).toBe(25);
    expect(medianOf("opponents-first")).toBe(17.5);
    expect(medianOf("player", "b")).toBe(40);
    expect(medianOf("opponent-each")).toBe(19);

    const duoFirst = stats.firstTeams.find((f) => f.team === "duo")!;
    const oppFirst = stats.firstTeams.find((f) => f.team === "opponents")!;
    expect(duoFirst).toMatchObject({ rounds: 1, share: 0.5, roundWinRate: 1, avgNetDamage: 500 });
    expect(oppFirst).toMatchObject({ rounds: 1, roundWinRate: 0, avgNetDamage: -800 });
    expect(stats.series).toEqual([]);
  });
});
