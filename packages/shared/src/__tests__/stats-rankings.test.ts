import { describe, expect, it } from "vitest";
import {
  DEFAULT_RANKING_METHOD,
  EMPTY_STATS_FILTER,
  applyFilter,
  countryRows,
  farGuessRegions,
  gapChartRows,
  isGreyedOut,
  sortCountryRows,
  type CountryRow,
  type RankingMethod,
  type StatsRound,
} from "../index.js";
import { bestGuess, makeGame, makeGuess, makePayload, makeRound } from "./stats-fixtures.js";

const t0 = Date.parse("2026-11-01T18:00:00Z");
const DAY = 86_400_000;

let seq = 0;
/** A Round in `countryCode` where the Duo scored `duo` against the Opponents' `opp`. */
function round(countryCode: string, duo: number, opp: number, overrides: Partial<StatsRound> = {}) {
  seq += 1;
  return makeRound(`r${seq}`, "g1", {
    countryCode,
    duoBestScore: duo,
    opponentBestScore: opp,
    hpDelta: duo - opp,
    startedAtMs: t0 + seq * 60_000,
    guesses: [bestGuess(countryCode, 10, { score: duo })],
    ...overrides,
  });
}

function rowsOf(rounds: StatsRound[], method?: RankingMethod) {
  return countryRows(
    { games: [makeGame("g1")], rounds },
    { learnings: [], slowThresholdSeconds: null, method },
  );
}

const row = (rows: CountryRow[], code: string) => rows.find((r) => r.countryCode === code)!;

describe("the default ranking method", () => {
  it("pulls a 1-Round country with a huge gap close to the Duo's mean, and barely moves a 50-Round one", () => {
    const duoMean = 100;
    const lucky = DEFAULT_RANKING_METHOD([-4000], duoMean);
    const steady = DEFAULT_RANKING_METHOD(Array(50).fill(-1000), duoMean);
    expect(Math.abs(lucky - duoMean)).toBeLessThan(0.2 * Math.abs(-4000 - duoMean));
    expect(Math.abs(steady - -1000)).toBeLessThan(0.1 * Math.abs(-1000 - duoMean));
  });

  it("does the same to the rows' gap", () => {
    const rounds = [
      round("KE", 0, 4000),
      ...Array.from({ length: 50 }, () => round("BR", 3000, 4000)),
      ...Array.from({ length: 100 }, () => round("FR", 4500, 4000)),
    ];
    const rows = rowsOf(rounds);
    const duoMeanGap = (-4000 + 50 * -1000 + 100 * 500) / 151;
    expect(row(rows, "KE").rawGap).toBe(-4000);
    expect(Math.abs(row(rows, "KE").gap - duoMeanGap)).toBeLessThan(800);
    expect(row(rows, "BR").rawGap).toBe(-1000);
    expect(Math.abs(row(rows, "BR").gap - -1000)).toBeLessThan(100);
  });
});

describe("countryRows", () => {
  it("counts mistake classes, slow guesses, Splits caught and best-guess shares", () => {
    const rounds = [
      round("BG", 4000, 4500, { guesses: [bestGuess("RO", 300, { playerId: "p1" })] }),
      round("BG", 4000, 4500, { guesses: [bestGuess("BG", 250, { playerId: "p2" })] }),
      round("BG", 4900, 4500, {
        guesses: [
          bestGuess("BG", 10, { playerId: "p2", secondsToGuess: 60 }),
          makeGuess({ playerId: "p1", countryCode: "RO" }),
        ],
      }),
      round("BG", 1000, 4500, {
        guesses: [
          bestGuess("RS", 400, { playerId: "p1" }),
          makeGuess({ playerId: "p2", countryCode: "MK" }),
        ],
      }),
    ];
    const r = countryRows(
      { games: [makeGame("g1")], rounds },
      { learnings: [], slowThresholdSeconds: 30 },
    )[0]!;
    expect(r).toMatchObject({
      countryCode: "BG",
      rounds: 4,
      wrongCountry: 2,
      far: 1,
      slow: 1,
      splits: 2,
      splitsCaught: 1,
      medianKm: 275,
    });
    expect(r.bestGuessShare).toEqual({ p1: 0.5, p2: 0.5 });
    expect(r.rawNetDamage).toBe((-500 - 500 + 400 - 3500) / 4);
  });

  it("counts the country's Learnings and compares the average score before and after the first", () => {
    const rounds = [
      round("BG", 3000, 4000, { startedAtMs: t0 }),
      round("BG", 3400, 4000, { startedAtMs: t0 + DAY }),
      round("BG", 4500, 4000, { startedAtMs: t0 + 3 * DAY }),
    ];
    const learnings = [
      { id: "l1", countryCodes: ["BG", "RO"], createdAtMs: t0 + 2 * DAY },
      { id: "l2", countryCodes: ["BG"], createdAtMs: t0 + 5 * DAY },
      { id: "l3", countryCodes: ["RO"], createdAtMs: t0 },
    ];
    const r = countryRows(
      { games: [makeGame("g1")], rounds },
      { learnings, slowThresholdSeconds: null },
    )[0]!;
    expect(r.learnings).toBe(2);
    expect(r.firstLearningAtMs).toBe(t0 + 2 * DAY);
    expect(r.beforeLearning).toEqual({ rounds: 2, avgScore: 3200 });
    expect(r.afterLearning).toEqual({ rounds: 1, avgScore: 4500 });
  });

  it("follows the page filter: with a country filter, only that country's row remains", () => {
    const payload = makePayload({
      games: [makeGame("g1")],
      rounds: [round("BG", 4000, 4000), round("RO", 4000, 4000), round("BG", 3000, 4000)],
    });
    const rows = countryRows(applyFilter(payload, { ...EMPTY_STATS_FILTER, countryCodes: ["BG"] }), {
      learnings: [],
      slowThresholdSeconds: null,
    });
    expect(rows.map((r) => r.countryCode)).toEqual(["BG"]);
    expect(rows[0]!.rounds).toBe(2);
  });
});

describe("ranking", () => {
  // Five countries with enough Rounds and two below the default threshold of 5.
  const rounds = [
    ...Array.from({ length: 6 }, () => round("BR", 3500, 4000)),
    ...Array.from({ length: 8 }, () => round("FR", 4600, 4000)),
    ...Array.from({ length: 5 }, () => round("BG", 3900, 4000)),
    ...Array.from({ length: 7 }, () => round("US", 4200, 4000)),
    ...Array.from({ length: 9 }, () => round("RU", 3000, 4000)),
    round("KE", 0, 4000),
    ...Array.from({ length: 2 }, () => round("AD", 4700, 4000)),
  ];
  const rows = rowsOf(rounds);

  const values: Record<string, (r: CountryRow) => number | string | null> = {
    country: (r) => r.countryCode,
    rounds: (r) => r.rounds,
    gap: (r) => r.gap,
    avgScore: (r) => r.avgScore,
    netDamage: (r) => r.netDamage,
    wrongCountry: (r) => r.wrongCountry,
    far: (r) => r.far,
    slow: (r) => r.slow,
    splits: (r) => r.splits,
    learnings: (r) => r.learnings,
    medianKm: (r) => r.medianKm,
    share: (r) => r.bestGuessShare["p1"] ?? null,
  };

  it("sorts rows below the grey-out threshold after all others, for every column and direction", () => {
    for (const [name, value] of Object.entries(values)) {
      for (const direction of ["asc", "desc"] as const) {
        const sorted = sortCountryRows(rows, value, direction, 5);
        const firstGrey = sorted.findIndex((r) => isGreyedOut(r, 5));
        expect(firstGrey, `${name} ${direction}`).toBe(5);
        expect(sorted.slice(firstGrey).every((r) => isGreyedOut(r, 5)), `${name} ${direction}`).toBe(true);
      }
    }
  });

  it("sorts by gap, worst first, by default", () => {
    const sorted = sortCountryRows(rows, (r) => r.gap, "asc", 5);
    expect(sorted.map((r) => r.countryCode).slice(0, 5)).toEqual(["RU", "BR", "BG", "US", "FR"]);
  });

  it("moves the threshold with the page setting", () => {
    const sorted = sortCountryRows(rows, (r) => r.gap, "asc", 1);
    expect(sorted[0]!.countryCode).toBe("KE");
    expect(sorted.filter((r) => isGreyedOut(r, 1))).toEqual([]);
  });

  it("changes order when the ranking method is swapped, with no other change", () => {
    const rawMean: RankingMethod = (vs) => vs.reduce((a, b) => a + b, 0) / vs.length;
    const order = (method?: RankingMethod) =>
      sortCountryRows(rowsOf(rounds, method), (r) => r.gap, "asc", 1).map((r) => r.countryCode);
    expect(order()).not.toEqual(order(rawMean));
    expect(order(rawMean)[0]).toBe("KE");
  });

  it("charts the best and worst countries above the threshold, best first", () => {
    const chart = gapChartRows(rows, 5, 2);
    expect(chart.map((r) => r.countryCode)).toEqual(["FR", "US", "BR", "RU"]);
    expect(gapChartRows(rows, 5, 8).map((r) => r.countryCode)).toEqual(["FR", "US", "BG", "BR", "RU"]);
  });
});

describe("farGuessRegions", () => {
  it("groups far guesses by actual → guessed Region and ignores other classes", () => {
    const far = (actual: string, guessed: string, hpDelta: number) =>
      round("BG", 3000, 4000, {
        regionCode: actual,
        hpDelta,
        guesses: [bestGuess("BG", 250, { regionCode: guessed })],
      });
    const rounds = [
      far("BG-02", "BG-16", -1000),
      far("BG-02", "BG-16", -500),
      far("BG-16", "BG-02", 300),
      round("BG", 4000, 4000, {
        regionCode: "BG-02",
        guesses: [bestGuess("BG", 10, { regionCode: "BG-02" })],
      }),
      round("BG", 1000, 4000, { regionCode: "BG-02", guesses: [bestGuess("RO", 300)] }),
    ];
    expect(farGuessRegions(rounds)).toEqual([
      { actual: "BG-02", guessed: "BG-16", count: 2, damage: 1500 },
      { actual: "BG-16", guessed: "BG-02", count: 1, damage: 0 },
    ]);
  });
});
