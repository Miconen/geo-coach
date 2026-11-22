import { describe, expect, it } from "vitest";
import {
  gameHeadline,
  gameRatingGapPoints,
  ratingGapBands,
  ratingSeries,
  roundHeadline,
  roundRatingGapPoints,
  streaks,
  type RatingGapPoint,
} from "../index.js";
import { makeGame, makeGuess, makeRound } from "./stats-fixtures.js";

const HOUR = 3_600_000;
const t0 = Date.parse("2026-11-01T18:00:00Z");

/** Games from a string of results ("WWL-"), one hour apart; "-" is an undecided Game. */
function results(pattern: string, gapsMs: Record<number, number> = {}) {
  let at = t0;
  return [...pattern].map((c, i) => {
    at += HOUR + (gapsMs[i] ?? 0);
    return makeGame(`g${i}`, { startedAtMs: at, won: c === "-" ? null : c === "W" });
  });
}

describe("streaks", () => {
  it("ends a win run on a loss", () => {
    const s = streaks(results("WWLW"));
    expect(s.current).toBe(1);
    expect(s.best).toBe(2);
    expect(s.worst).toBe(1);
  });

  it("ignores gaps in time and undecided Games", () => {
    const s = streaks(results("WW-W", { 2: 30 * 24 * HOUR }));
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });

  it("is negative while losing", () => {
    expect(streaks(results("WWWLL")).current).toBe(-2);
  });

  it("finds runs of 3 or more in both directions", () => {
    const s = streaks(results("WWWLWLLLLWW"));
    expect(s.winRuns).toEqual([{ won: true, length: 3, firstGameId: "g0", lastGameId: "g2" }]);
    expect(s.lossRuns).toEqual([{ won: false, length: 4, firstGameId: "g5", lastGameId: "g8" }]);
    expect(s).toMatchObject({ current: 2, best: 3, worst: 4 });
  });

  it("orders Games by start time, whatever order they come in", () => {
    expect(streaks(results("LLW").reverse()).current).toBe(1);
  });

  it("is zero with no decided Games", () => {
    expect(streaks([])).toEqual({ current: 0, best: 0, worst: 0, winRuns: [], lossRuns: [] });
  });
});

describe("ratingSeries", () => {
  it("numbers every Game in order, with the rating and position after it", () => {
    const games = [
      makeGame("b", { startedAtMs: t0 + 2 * HOUR, ratingAfter: 1225, positionAfter: 90 }),
      makeGame("a", { startedAtMs: t0 + HOUR, ratingAfter: 1210, positionAfter: 120 }),
      makeGame("c", { startedAtMs: t0 + 3 * HOUR, ratingAfter: null, won: null }),
    ];
    expect(ratingSeries(games).map((p) => [p.gameNumber, p.gameId, p.rating, p.position])).toEqual([
      [1, "a", 1210, 120],
      [2, "b", 1225, 90],
      [3, "c", null, null],
    ]);
  });
});

describe("gameHeadline", () => {
  it("gives the win rate, the rating change over the Games and the latest position", () => {
    const games = [
      makeGame("a", { startedAtMs: t0, ratingBefore: 1180, ratingAfter: 1195, won: true }),
      makeGame("b", { startedAtMs: t0 + HOUR, ratingBefore: 1195, ratingAfter: 1182, won: false }),
      makeGame("c", { startedAtMs: t0 + 2 * HOUR, won: null, ratingBefore: null, ratingAfter: null }),
      makeGame("d", {
        startedAtMs: t0 + 3 * HOUR,
        ratingBefore: 1182,
        ratingAfter: 1200,
        positionAfter: 77,
        won: true,
      }),
    ];
    expect(gameHeadline(games)).toMatchObject({
      games: 4,
      decided: 3,
      wins: 2,
      winRate: 2 / 3,
      ratingFrom: 1180,
      rating: 1200,
      ratingChange: 20,
      position: 77,
    });
  });

  it("has no rates for no Games", () => {
    expect(gameHeadline([])).toMatchObject({ games: 0, winRate: null, rating: null, ratingChange: null });
  });
});

describe("roundHeadline", () => {
  it("averages score and Damage per Round, and the median time to guess per side", () => {
    const rounds = [
      makeRound("r1", "g", {
        duoBestScore: 5000,
        opponentBestScore: 3000,
        hpDelta: 2000,
        guesses: [
          makeGuess({ secondsToGuess: 10 }),
          makeGuess({ secondsToGuess: 30 }),
          makeGuess({ isDuo: false, secondsToGuess: 20 }),
        ],
      }),
      makeRound("r2", "g", {
        duoBestScore: 2000,
        opponentBestScore: 4000,
        hpDelta: -4000,
        guesses: [makeGuess({ secondsToGuess: 20 }), makeGuess({ isDuo: false, secondsToGuess: null })],
      }),
      makeRound("r3", "g", { duoBestScore: 5000, opponentBestScore: 5000, hpDelta: 0 }),
    ];
    expect(roundHeadline(rounds)).toEqual({
      rounds: 3,
      roundsWon: 1,
      roundsDecided: 2,
      roundWinRate: 0.5,
      avgDuoScore: 4000,
      avgOpponentScore: 4000,
      avgDamageDealt: 2000 / 3,
      avgDamageTaken: 4000 / 3,
      medianDuoSecondsToGuess: 20,
      medianOpponentSecondsToGuess: 20,
    });
  });
});

describe("rating-gap bands", () => {
  const game = (id: string, gap: number, won: boolean) =>
    makeGame(id, { ratingBefore: 1200, opponentRatingBefore: 1200 + gap, won });

  it("places each Game by the rating gap (Opponents − Duo) with its net Damage and score gap", () => {
    const g = game("g", 80, true);
    const rounds = [
      makeRound("r1", "g", { hpDelta: 1000, duoBestScore: 4500, opponentBestScore: 3500 }),
      makeRound("r2", "g", { hpDelta: -400, duoBestScore: 3000, opponentBestScore: 3400 }),
      makeRound("rx", "other", { hpDelta: 9999 }),
    ];
    expect(gameRatingGapPoints({ games: [g], rounds })).toEqual([
      {
        id: "g",
        gameId: "g",
        startedAtMs: g.startedAtMs,
        ratingGap: 80,
        won: true,
        netDamage: 600,
        scoreGapPerRound: 300,
      },
    ]);
  });

  it("skips Games without both ratings or a result", () => {
    const games = [
      makeGame("a", { opponentRatingBefore: null }),
      makeGame("b", { ratingBefore: null }),
      makeGame("c", { won: null }),
    ];
    expect(gameRatingGapPoints({ games, rounds: [] })).toEqual([]);
  });

  it("stands Rounds in for Games: won when the Duo dealt Damage, ties left out", () => {
    const g = game("g", -30, false);
    const rounds = [
      makeRound("r1", "g", { hpDelta: 500, duoBestScore: 4000, opponentBestScore: 3500 }),
      makeRound("r2", "g", { hpDelta: 0 }),
    ];
    expect(roundRatingGapPoints({ games: [g], rounds })).toEqual([
      {
        id: "r1",
        gameId: "g",
        startedAtMs: rounds[0]!.startedAtMs,
        ratingGap: -30,
        won: true,
        netDamage: 500,
        scoreGapPerRound: 500,
      },
    ]);
  });

  const point = (ratingGap: number, won: boolean, netDamage: number): RatingGapPoint => ({
    id: `${ratingGap}-${netDamage}`,
    gameId: "g",
    startedAtMs: 0,
    ratingGap,
    won,
    netDamage,
    scoreGapPerRound: netDamage / 5,
  });

  it("groups points into 50-point bands centred on multiples of 50, hiding bands under 5", () => {
    const points = [
      point(30, true, 1000),
      point(60, true, 3000),
      point(74, false, -2000),
      point(51, false, -1000),
      point(40, true, 2000),
      // Only four in the band around 100: hidden.
      point(80, true, 500),
      point(110, true, 500),
      point(100, false, -500),
      point(120, false, -500),
    ];
    const bands = ratingGapBands(points);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toEqual({
      band: 50,
      from: 25,
      to: 75,
      count: 5,
      wins: 3,
      losses: 2,
      winRate: 0.6,
      avgNetDamage: 600,
      avgNetDamageWins: 2000,
      avgNetDamageLosses: -1500,
      avgScoreGapPerRound: 120,
    });
  });
});
