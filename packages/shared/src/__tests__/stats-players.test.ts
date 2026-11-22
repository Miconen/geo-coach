import { describe, expect, it } from "vitest";
import {
  CARRY_SHARE,
  DEFAULT_GREY_OUT_ROUNDS,
  ROLLING_WINDOW_ROUNDS,
  carryChips,
  countryRows,
  firstGuesserStats,
  playerSummaries,
  rollingSeries,
  type StatsGuess,
  type StatsRound,
} from "../index.js";
import { makeGame, makeGuess, makeRound } from "./stats-fixtures.js";

const t0 = Date.parse("2026-11-01T18:00:00Z");
const PLAYERS = [{ id: "miko" }, { id: "sora" }];

/** A Duo guess by `playerId` in `countryCode`, `km` off. */
function guess(playerId: string, countryCode: string | null, km: number, o: Partial<StatsGuess> = {}) {
  return makeGuess({ playerId, countryCode, distanceMeters: km * 1000, ...o });
}

function opponent(o: Partial<StatsGuess> = {}) {
  return makeGuess({ playerId: null, isDuo: false, countryCode: "BG", ...o });
}

let seq = 0;
/** A Round in `countryCode` with the given guesses; the first Duo guess listed is the best. */
function round(guesses: StatsGuess[], overrides: Partial<StatsRound> = {}): StatsRound {
  seq += 1;
  let marked = false;
  const withBest = guesses.map((g) => {
    if (!g.isDuo || marked || g.lat === null) return g;
    marked = true;
    return { ...g, isBestForTeam: true };
  });
  return makeRound(`r${seq}`, "g1", {
    countryCode: "BG",
    startedAtMs: t0 + seq * 60_000,
    guesses: withBest,
    ...overrides,
  });
}

const filtered = (rounds: StatsRound[]) => ({ games: [makeGame("g1")], rounds });
const summaryOf = (rounds: StatsRound[], id: string) =>
  playerSummaries(filtered(rounds), PLAYERS).find((s) => s.playerId === id)!;

describe("playerSummaries", () => {
  it("gives each Player's share of Rounds where their guess was the Duo's best", () => {
    const rounds = [
      round([guess("miko", "BG", 10), guess("sora", "BG", 50)]),
      round([guess("miko", "BG", 10), guess("sora", "BG", 50)]),
      round([guess("sora", "BG", 10), guess("miko", "BG", 50)]),
      round([guess("sora", "BG", 10)]),
    ];
    expect(summaryOf(rounds, "miko")).toMatchObject({ rounds: 4, bestRounds: 2, bestShare: 0.5 });
    expect(summaryOf(rounds, "sora")).toMatchObject({ bestRounds: 2, bestShare: 0.5 });
  });

  it("leaves Split Rounds out of a Player's median km", () => {
    const rounds = [
      round([guess("miko", "BG", 10), guess("sora", "BG", 20)]),
      round([guess("miko", "BG", 30), guess("sora", "BG", 40)]),
      // A Split: Sora's guess in Romania is the hedge, not a mistake.
      round([guess("miko", "BG", 20), guess("sora", "RO", 900)]),
    ];
    expect(summaryOf(rounds, "miko").medianKm).toBe(20);
    expect(summaryOf(rounds, "sora").medianKm).toBe(30);
  });

  it("leaves timed-out guesses out of a Player's median time, and gives their timed-out share", () => {
    const rounds = [
      round([guess("miko", "BG", 10, { secondsToGuess: 10 })]),
      round([guess("miko", "BG", 10, { secondsToGuess: 20 })]),
      round([guess("miko", "BG", 10, { secondsToGuess: 61.4, timedOut: true })]),
      round([guess("miko", "BG", 10, { secondsToGuess: 61.2, timedOut: true })]),
    ];
    const s = summaryOf(rounds, "miko");
    expect(s.medianSeconds).toBe(15);
    expect(s.timedOut).toBe(2);
    expect(s.timedOutShare).toBe(0.5);
  });

  it("counts a Round without a placed guess as a no-guess, never the best, and out of the medians", () => {
    const rounds = [
      round([guess("miko", "BG", 10, { secondsToGuess: 30 }), guess("sora", "BG", 20)]),
      round([guess("sora", "BG", 900, { secondsToGuess: 5 })]),
      round([
        guess("miko", null, 0, { lat: null, lng: null, distanceMeters: null, secondsToGuess: 1 }),
        guess("sora", "BG", 900),
      ]),
    ];
    const s = summaryOf(rounds, "miko");
    expect(s.noGuess).toBe(2);
    expect(s.bestRounds).toBe(1);
    expect(s.medianKm).toBe(10);
    expect(s.medianSeconds).toBe(30);
  });

  it("compares pressed with timed-out guesses on Rounds that aren't Splits", () => {
    const rounds = [
      round([guess("miko", "BG", 10, { score: 4800 })]),
      round([guess("miko", "BG", 30, { score: 4600 })]),
      round([guess("miko", "BG", 200, { score: 3000, timedOut: true })]),
      // A Split, left out of both sides.
      round([guess("sora", "BG", 5), guess("miko", "RO", 900, { score: 100, timedOut: true })]),
    ];
    const { pressed, timedOut } = summaryOf(rounds, "miko").waiting;
    expect(pressed).toEqual({ guesses: 2, avgScore: 4700, medianKm: 20 });
    expect(timedOut).toEqual({ guesses: 1, avgScore: 3000, medianKm: 200 });
  });

  it("ignores Opponents' guesses", () => {
    const rounds = [round([opponent({ distanceMeters: 1 }), guess("miko", "BG", 10)])];
    const s = summaryOf(rounds, "miko");
    expect(s.bestShare).toBe(1);
    expect(s.medianKm).toBe(10);
  });
});

describe("firstGuesserStats", () => {
  it("counts who pressed first within the Duo, and Rounds where both timed out", () => {
    const rounds = [
      round([guess("miko", "BG", 10, { secondsToGuess: 10 }), guess("sora", "BG", 20, { secondsToGuess: 20 })]),
      round([guess("miko", "BG", 10, { secondsToGuess: 10 }), guess("sora", "BG", 20, { secondsToGuess: 61, timedOut: true })]),
      round([guess("sora", "BG", 10, { secondsToGuess: 30 }), guess("miko", "BG", 20, { secondsToGuess: 15 })]),
      round([
        guess("miko", "BG", 10, { secondsToGuess: 61.2, timedOut: true }),
        guess("sora", "BG", 20, { secondsToGuess: 61.4, timedOut: true }),
      ]),
    ];
    const stats = firstGuesserStats(rounds, PLAYERS);
    expect(stats.rounds).toBe(4);
    expect(stats.bothTimedOut).toBe(1);
    expect(stats.bothTimedOutShare).toBe(0.25);
    expect(stats.noPressedGuess).toBe(0);
    const miko = stats.players.find((p) => p.playerId === "miko")!;
    expect(miko).toMatchObject({ first: 3, share: 0.75 });
    // First in three, best in two of them.
    expect(miko.bestShareWhenFirst).toBeCloseTo(2 / 3);
    // Sora was never first.
    expect(miko.bestShareWhenOtherFirst).toBeNull();
    const sora = stats.players.find((p) => p.playerId === "sora")!;
    expect(sora).toMatchObject({ first: 0, share: 0, bestShareWhenFirst: null });
    expect(sora.bestShareWhenOtherFirst).toBeCloseTo(1 / 3);
  });

  it("is never moved by the Opponents' guess times", () => {
    const duo = [
      guess("sora", "BG", 10, { secondsToGuess: 25 }),
      guess("miko", "BG", 20, { secondsToGuess: 61, timedOut: true }),
    ];
    const without = firstGuesserStats([round(duo)], PLAYERS);
    const withOpponents = firstGuesserStats(
      [round([opponent({ secondsToGuess: 2 }), ...duo, opponent({ secondsToGuess: 3, guessedFirst: true })])],
      PLAYERS,
    );
    expect(withOpponents.players).toEqual(without.players);
    expect(withOpponents.players.find((p) => p.playerId === "sora")!.first).toBe(1);
  });
});

describe("carryChips", () => {
  const roundsIn = (countryCode: string, mikoBest: number, soraBest: number) => [
    ...Array.from({ length: mikoBest }, () =>
      round([guess("miko", countryCode, 1), guess("sora", countryCode, 2)], { countryCode }),
    ),
    ...Array.from({ length: soraBest }, () =>
      round([guess("sora", countryCode, 1), guess("miko", countryCode, 2)], { countryCode }),
    ),
  ];
  const rowsOf = (rounds: StatsRound[]) =>
    countryRows(filtered(rounds), { learnings: [], slowThresholdSeconds: null });

  it("lists the countries where a Player had the best guess at least CARRY_SHARE of the time, best first", () => {
    expect(CARRY_SHARE).toBe(0.6);
    const rows = rowsOf([...roundsIn("PE", 6, 4), ...roundsIn("PY", 5, 1), ...roundsIn("OM", 2, 4)]);
    expect(carryChips(rows, "miko", DEFAULT_GREY_OUT_ROUNDS)).toEqual([
      { countryCode: "PY", share: 5 / 6, rounds: 6 },
      { countryCode: "PE", share: 0.6, rounds: 10 },
    ]);
    expect(carryChips(rows, "sora", DEFAULT_GREY_OUT_ROUNDS)).toEqual([
      { countryCode: "OM", share: 4 / 6, rounds: 6 },
    ]);
  });

  it("leaves out countries below the grey-out threshold, even at 100%", () => {
    const rows = rowsOf([...roundsIn("KE", 4, 0), ...roundsIn("PY", 5, 0)]);
    expect(carryChips(rows, "miko", 5).map((c) => c.countryCode)).toEqual(["PY"]);
    expect(carryChips(rows, "miko", 4).map((c) => c.countryCode)).toEqual(["PY", "KE"]);
  });
});

describe("rollingSeries", () => {
  /** Rounds in order; `mikoBest[i]` says whether Miko had the best guess on Round i. */
  function series(mikoBest: boolean[], mikoKm: (i: number) => number = () => 10) {
    return mikoBest.map((best, i) =>
      round(
        best
          ? [guess("miko", "BG", mikoKm(i)), guess("sora", "BG", 5000)]
          : [guess("sora", "BG", 1), guess("miko", "BG", mikoKm(i))],
        { startedAtMs: t0 + i * 60_000 },
      ),
    );
  }

  it("is a 50-Round window by default", () => {
    expect(ROLLING_WINDOW_ROUNDS).toBe(50);
  });

  it("shows nothing with fewer Rounds than the window", () => {
    const rounds = series(Array(ROLLING_WINDOW_ROUNDS - 1).fill(true));
    expect(rollingSeries(rounds, "miko", ROLLING_WINDOW_ROUNDS)).toEqual([]);
  });

  it("gives one point per full window, in Round order", () => {
    // Best on Rounds 1–2, not on 3–4; km off is the Round's number.
    const rounds = series([true, true, false, false], (i) => i + 1);
    const shuffled = [rounds[2]!, rounds[0]!, rounds[3]!, rounds[1]!];
    expect(rollingSeries(shuffled, "miko", 3)).toEqual([
      { roundIndex: 3, bestShare: 2 / 3, medianKm: 2 },
      { roundIndex: 4, bestShare: 1 / 3, medianKm: 3 },
    ]);
  });

  it("leaves Splits out of the window's median km, but keeps them in the best-guess share", () => {
    const rounds = [
      round([guess("miko", "BG", 10), guess("sora", "BG", 20)]),
      round([guess("sora", "BG", 5), guess("miko", "RO", 900)]),
    ];
    expect(rollingSeries(rounds, "miko", 2)).toEqual([
      { roundIndex: 2, bestShare: 0.5, medianKm: 10 },
    ]);
  });
});
