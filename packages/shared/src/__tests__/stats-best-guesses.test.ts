import { describe, expect, it } from "vitest";
import {
  BEST_GUESSES_PER_PLAYER,
  STANDOUT_WEIGHTS,
  bestGuesses,
  standoutScore,
  type StatsGame,
  type StatsGuess,
  type StatsRound,
} from "../index.js";
import { makeGame, makeGuess, makeRound } from "./stats-fixtures.js";

/** A guess `km` off in `countryCode` scoring `score`, guessed after `seconds`. */
function g(
  playerId: string | null,
  countryCode: string | null,
  km: number,
  score: number,
  seconds: number,
  o: Partial<StatsGuess> = {},
): StatsGuess {
  return makeGuess({
    playerId,
    isDuo: playerId !== null,
    countryCode,
    distanceMeters: km * 1000,
    score,
    secondsToGuess: seconds,
    ...o,
  });
}

let seq = 0;
function round(gameId: string, guesses: StatsGuess[], o: Partial<StatsRound> = {}): StatsRound {
  seq += 1;
  return makeRound(`r${seq}`, gameId, { countryCode: "KE", regionCode: "KE-30", guesses, ...o });
}

function listFor(rounds: StatsRound[], playerId: string, games: StatsGame[] = [makeGame("g1")]) {
  return bestGuesses({ games, rounds }, playerId);
}

describe("bestGuesses", () => {
  it("ranks a fast, closest guess with the others in other countries above a 4,900 that beat the next guess by 100", () => {
    const kenya = round("g1", [
      g("miko", "KE", 120, 3600, 7),
      g("sora", "TZ", 700, 1900, 60.4, { timedOut: true }),
      g(null, "UG", 650, 2000, 61.2, { timedOut: true }),
      g(null, "TZ", 900, 1500, 61.3, { timedOut: true }),
    ]);
    const nearMiss = round("g1", [
      g("miko", "FR", 3, 4900, 40),
      g("sora", "FR", 20, 4700, 30),
      g(null, "FR", 8, 4800, 35),
      g(null, "FR", 30, 4600, 38),
    ], { countryCode: "FR", regionCode: "FR-IDF" });

    const list = listFor([nearMiss, kenya], "miko");
    expect(list.map((b) => b.roundId)).toEqual([kenya.id, nearMiss.id]);
    expect(list[0]).toMatchObject({
      countryCode: "KE",
      regionCode: "KE-30",
      mode: "nm",
      score: 3600,
      lead: 1600,
      othersInOtherCountry: 3,
      secondsSooner: 53.4,
    });
    expect(list[1]).toMatchObject({ lead: 100, othersInOtherCountry: 0, secondsSooner: 0 });
  });

  it("only takes guesses that were the closest of all four", () => {
    const opponentCloser = round("g1", [
      g("miko", "KE", 50, 4500, 10),
      g("sora", "KE", 300, 3000, 20),
      g(null, "KE", 40, 4550, 30),
    ]);
    const partnerCloser = round("g1", [g("miko", "KE", 50, 4500, 10), g("sora", "KE", 20, 4800, 20)]);
    const tied = round("g1", [g("miko", "KE", 50, 4500, 10), g(null, "KE", 50, 4500, 20)]);
    const alone = round("g1", [g("miko", "KE", 50, 4500, 10)]);
    const unplaced = round("g1", [
      g("miko", null, 0, 0, 10, { lat: null, lng: null, distanceMeters: null }),
      g(null, "KE", 500, 2000, 20),
    ]);
    expect(listFor([opponentCloser, partnerCloser, tied, alone, unplaced], "miko")).toEqual([]);
    expect(listFor([partnerCloser], "sora")).toHaveLength(1);
  });

  it("gives no speed to a timed-out guess, and measures it against the next guess in time", () => {
    const timedOut = round("g1", [
      g("miko", "KE", 10, 4900, 61.3, { timedOut: true }),
      g(null, "TZ", 900, 1000, 20),
    ]);
    const notFirst = round("g1", [
      g("miko", "KE", 10, 4900, 30),
      g("sora", "KE", 200, 3000, 12),
      g(null, "KE", 300, 2500, 50),
    ]);
    const [a, b] = [timedOut, notFirst].map((r) => listFor([r], "miko")[0]!);
    expect(a!.secondsSooner).toBe(0);
    expect(b!.secondsSooner).toBe(0);
  });

  it("ranks a harder Mode and lower-scoring others higher, all else equal", () => {
    const games = [makeGame("nmpz", { mode: "nmpz" }), makeGame("moving", { mode: "moving" })];
    const guesses = () => [g("miko", "KE", 10, 4000, 30), g(null, "KE", 200, 3000, 30)];
    const list = listFor([round("moving", guesses()), round("nmpz", guesses())], "miko", games);
    expect(list.map((b) => b.mode)).toEqual(["nmpz", "moving"]);

    const low = round("g1", [g("miko", "KE", 10, 4000, 30), g(null, "KE", 200, 3000, 30), g(null, "KE", 900, 500, 30)]);
    const high = round("g1", [g("miko", "KE", 10, 4000, 30), g(null, "KE", 200, 3000, 30), g(null, "KE", 300, 2900, 30)]);
    expect(listFor([high, low], "miko").map((b) => b.roundId)).toEqual([low.id, high.id]);
  });

  it("keeps the top BEST_GUESSES_PER_PLAYER", () => {
    const rounds = Array.from({ length: BEST_GUESSES_PER_PLAYER + 3 }, (_, i) =>
      round("g1", [g("miko", "KE", 10, 4000, 30), g(null, "KE", 200, 4000 - 100 * (i + 1), 30)]),
    );
    const list = listFor(rounds, "miko");
    expect(list).toHaveLength(BEST_GUESSES_PER_PLAYER);
    expect(list[0]!.lead).toBe(100 * (BEST_GUESSES_PER_PLAYER + 3));
  });
});

describe("standoutScore", () => {
  it("adds up the weighted signals", () => {
    const signals = { lead: 1000, othersInOtherCountry: 2, secondsSooner: 10, mode: "nmpz" as const, othersAvgScore: 2000 };
    const w = STANDOUT_WEIGHTS;
    expect(standoutScore(signals)).toBeCloseTo(
      1000 * w.lead + 2 * w.otherCountry + 10 * w.secondSooner + 2 * w.modeLevel + (5000 - 2000) * w.othersLowPoint,
    );
  });
});
