import { describe, expect, it } from "vitest";
import { EMPTY_STATS_FILTER, overview, type StatsFilter } from "../index.js";
import { bestGuess, makeGame, makePayload, makeRound } from "./stats-fixtures.js";

const HOUR = 3_600_000;
const t0 = Date.parse("2026-11-01T18:00:00Z");

// Ten Games with a Bulgarian and a Romanian Round each; Romania comes up slower.
const games = [..."WWWLLWLWWL"].map((c, i) =>
  makeGame(`g${i}`, {
    startedAtMs: t0 + i * HOUR,
    won: c === "W",
    ratingBefore: 1200 + i * 5,
    ratingAfter: 1205 + i * 5,
    opponentRatingBefore: 1250 + i * 5,
    positionAfter: 100 - i,
  }),
);
const rounds = games.flatMap((g, i) => [
  makeRound(`${g.id}-bg`, g.id, {
    countryCode: "BG",
    startedAtMs: g.startedAtMs,
    hpDelta: i % 3 === 0 ? -600 : 400,
    guesses: [bestGuess("BG", 50 + i * 20, { secondsToGuess: 10 + i })],
  }),
  makeRound(`${g.id}-ro`, g.id, {
    countryCode: "RO",
    roundNumber: 2,
    startedAtMs: g.startedAtMs + 60_000,
    hpDelta: g.won ? 300 : -900,
    guesses: [bestGuess(i % 2 ? "BG" : "RO", 200, { secondsToGuess: 40 + i })],
  }),
]);
const payload = makePayload({ games, rounds });

const run = (filter: Partial<StatsFilter>) => overview(payload, { ...EMPTY_STATS_FILTER, ...filter });

describe("overview", () => {
  it("ignores the country filter for the rating line, streaks and win rate", () => {
    const all = run({});
    const bulgaria = run({ countryCodes: ["BG"] });
    expect(bulgaria.countryFiltered).toBe(true);
    expect(bulgaria.rating).toEqual(all.rating);
    expect(bulgaria.streaks).toEqual(all.streaks);
    expect(bulgaria.games).toEqual(all.games);
    expect(bulgaria.games.winRate).toBe(0.6);
  });

  it("follows the country filter for Round numbers", () => {
    const bulgaria = run({ countryCodes: ["BG"] });
    expect(bulgaria.rounds.rounds).toBe(10);
    expect(bulgaria.rounds.roundWinRate).toBe(0.6);
    expect(run({}).rounds.rounds).toBe(20);
  });

  it("still follows Game-level filters for Game numbers", () => {
    const later = run({ opponentRatingMin: 1275 });
    expect(later.games.games).toBe(5);
    expect(later.rating.map((p) => p.gameId)).toEqual(["g5", "g6", "g7", "g8", "g9"]);
  });

  it("counts Games in the rated-above chart, and Rounds under a country filter", () => {
    const all = run({});
    expect(all.ratedAbove.unit).toBe("games");
    expect(all.ratedAbove.points).toHaveLength(10);
    expect(all.ratedAbove.bands).toEqual([expect.objectContaining({ band: 50, count: 10, wins: 6 })]);

    const bulgaria = run({ countryCodes: ["BG"] });
    expect(bulgaria.ratedAbove.unit).toBe("rounds");
    expect(bulgaria.ratedAbove.points.map((p) => p.id)).toEqual(rounds.filter((r) => r.countryCode === "BG").map((r) => r.id));
    expect(bulgaria.ratedAbove.bands).toEqual([expect.objectContaining({ count: 10, wins: 6 })]);
  });

  it("hides rated-above bands with fewer than 5 Games or Rounds", () => {
    const few = run({ opponentRatingMax: 1265 });
    expect(few.ratedAbove.points).toHaveLength(4);
    expect(few.ratedAbove.bands).toEqual([]);
  });

  it("keeps the slow threshold fixed when a filter narrows the Rounds", () => {
    const all = run({});
    const romania = run({ countryCodes: ["RO"] });
    const fewer = run({ opponentRatingMax: 1260 });
    expect(all.damage.slowThresholdSeconds).not.toBeNull();
    expect(romania.damage.slowThresholdSeconds).toBe(all.damage.slowThresholdSeconds);
    expect(fewer.damage.slowThresholdSeconds).toBe(all.damage.slowThresholdSeconds);
    // Over Romania alone, its slower Rounds would set a higher bar and fewer would be slow.
    const slowIds = (o: ReturnType<typeof run>) =>
      o.damage.points.filter((p) => p.slow).map((p) => p.roundId);
    expect(slowIds(romania)).toEqual(slowIds(all).filter((id) => id.endsWith("-ro")));
    expect(slowIds(romania).length).toBeGreaterThan(1);
  });

  it("plots each lost Round with its class, and totals Rounds and Damage per class", () => {
    const { damage } = run({});
    const lost = rounds.filter((r) => r.hpDelta < 0);
    expect(damage.points).toHaveLength(lost.length);
    const g0bg = damage.points.find((p) => p.roundId === "g0-bg")!;
    expect(g0bg).toMatchObject({
      countryCode: "BG",
      mistakeClass: "close",
      km: 50,
      damage: 600,
      points: 4000,
      secondsToGuess: 10,
    });
    expect(g0bg.share).toBeCloseTo(50 / 336, 3);

    const totals = Object.fromEntries(damage.classes.map((c) => [c.mistakeClass, c]));
    const sum = (cls: string) =>
      damage.points.filter((p) => p.mistakeClass === cls).reduce((a, p) => a + p.damage, 0);
    for (const cls of ["wrong-country", "far", "close"] as const) {
      expect(totals[cls]).toEqual({
        mistakeClass: cls,
        rounds: damage.points.filter((p) => p.mistakeClass === cls).length,
        damage: sum(cls),
      });
    }
    expect(totals["wrong-country"]!.rounds).toBeGreaterThan(0);
  });
});
