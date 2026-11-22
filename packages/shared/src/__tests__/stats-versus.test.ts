import { describe, expect, it } from "vitest";
import {
  countryVersusRows,
  duoCloser,
  versusNumbers,
  versusSeries,
  type StatsGuess,
  type StatsRound,
} from "../index.js";
import { makeGuess, makeRound } from "./stats-fixtures.js";

const t0 = Date.parse("2026-11-01T18:00:00Z");

const duoBest = (km: number, o: Partial<StatsGuess> = {}) =>
  makeGuess({ playerId: "a", distanceMeters: km * 1000, isBestForTeam: true, ...o });
const oppBest = (km: number, o: Partial<StatsGuess> = {}) =>
  makeGuess({ playerId: null, isDuo: false, distanceMeters: km * 1000, isBestForTeam: true, ...o });

let seq = 0;
function round(duoKm: number | null, oppKm: number | null, o: Partial<StatsRound> = {}): StatsRound {
  seq += 1;
  const guesses = [
    ...(duoKm === null ? [] : [duoBest(duoKm)]),
    ...(oppKm === null ? [] : [oppBest(oppKm)]),
  ];
  return makeRound(`r${seq}`, "g1", { startedAtMs: t0 + seq * 60_000, guesses, ...o });
}

describe("duoCloser", () => {
  it("compares the two teams' best guesses by distance", () => {
    expect(duoCloser(round(10, 50))).toBe(true);
    expect(duoCloser(round(80, 50))).toBe(false);
  });

  it("is null without both best guesses, or when both were as far", () => {
    expect(duoCloser(round(10, null))).toBeNull();
    expect(duoCloser(round(null, 10))).toBeNull();
    expect(duoCloser(round(10, 10))).toBeNull();
    expect(duoCloser(round(10, 50, { guesses: [duoBest(10, { lat: null, lng: null }), oppBest(50)] }))).toBeNull();
  });

  it("reads only each team's best guess, so a Split's hedge never counts", () => {
    const r = round(0, 0, {
      guesses: [duoBest(30), makeGuess({ playerId: "b", distanceMeters: 900_000 }), oppBest(40)],
    });
    expect(duoCloser(r)).toBe(true);
  });
});

describe("versusNumbers", () => {
  it("gives both teams' scores, median km and the Duo's closer share", () => {
    const n = versusNumbers([
      round(10, 50, { duoBestScore: 4500, opponentBestScore: 4000 }),
      round(80, 50, { duoBestScore: 3000, opponentBestScore: 3500 }),
      round(20, null, { duoBestScore: 4200, opponentBestScore: 0 }),
    ]);
    expect(n).toMatchObject({
      rounds: 3,
      avgDuoScore: 3900,
      avgOpponentScore: 2500,
      duoMedianKm: 20,
      opponentsMedianKm: 50,
      compared: 2,
      closerShare: 0.5,
    });
  });
});

describe("countryVersusRows", () => {
  it("groups by the Round's country, most-played first", () => {
    const rows = countryVersusRows([
      round(10, 50, { countryCode: "BG" }),
      round(10, 50, { countryCode: "RO" }),
      round(90, 50, { countryCode: "RO" }),
      round(10, 50, { countryCode: null }),
    ]);
    expect(rows.map((r) => [r.countryCode, r.rounds, r.closerShare])).toEqual([
      ["RO", 2, 0.5],
      ["BG", 1, 1],
    ]);
  });
});

describe("versusSeries", () => {
  it("gives one point per full window, in play order", () => {
    const later = round(10, 50, { startedAtMs: t0 + 10_000_000 });
    const earlier = round(90, 50, { startedAtMs: t0 });
    const points = versusSeries([later, earlier, round(10, 50, { startedAtMs: t0 + 20_000_000 })], 2);
    expect(points.map((p) => [p.roundIndex, p.closerShare])).toEqual([
      [2, 0.5],
      [3, 1],
    ]);
  });
});
