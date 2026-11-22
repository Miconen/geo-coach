import { describe, expect, it } from "vitest";
import {
  PLAIN_COUNTRY,
  confusionPairs,
  mistakeClass,
  undirectedConfusionPairs,
  type StatsRound,
} from "../index.js";
import { bestGuess, makeGuess, makeRound } from "./stats-fixtures.js";

function miss(id: string, actual: string, guessed: string | null, hpDelta = -500): StatsRound {
  return makeRound(id, "g", { countryCode: actual, hpDelta, guesses: [bestGuess(guessed, 300)] });
}

describe("confusionPairs", () => {
  it("keeps A → B and B → A apart, with counts and Damage taken", () => {
    const pairs = confusionPairs([
      miss("r1", "FR", "BE", -1000),
      miss("r2", "FR", "BE", -500),
      miss("r3", "BE", "FR", -300),
    ]);
    expect(pairs).toEqual([
      { actual: "FR", guessed: "BE", count: 2, damage: 1500 },
      { actual: "BE", guessed: "FR", count: 1, damage: 300 },
    ]);
  });

  it("counts a best guess in the water, with null as the guessed country", () => {
    expect(confusionPairs([miss("r", "NO", null)])).toEqual([
      { actual: "NO", guessed: null, count: 1, damage: 500 },
    ]);
  });

  it("judges the best guess only, so a Split's hedge is no confusion", () => {
    const split = makeRound("r", "g", {
      countryCode: "BG",
      guesses: [bestGuess("BG", 20), makeGuess({ countryCode: "RO" })],
    });
    expect(confusionPairs([split])).toEqual([]);
  });

  it("counts no Damage for a wrong-country Round the Duo still won", () => {
    expect(confusionPairs([miss("r", "FR", "BE", 200)])).toEqual([
      { actual: "FR", guessed: "BE", count: 1, damage: 0 },
    ]);
  });

  it("matches the wrong-country mistake class, overseas Regions included", () => {
    const rounds = [
      miss("r1", "BG", "RO"),
      miss("r2", "BG", "BG"),
      miss("r3", "BG", null),
      // A guess in mainland France on a Round in French Guiana is a wrong country.
      makeRound("r4", "g", {
        countryCode: "FR",
        regionCode: "FR-GUF",
        guesses: [bestGuess("FR", 7000, { regionCode: "FR-IDF" })],
      }),
      // The geocoder's GF is French Guiana: not a confusion on a Round there.
      makeRound("r5", "g", {
        countryCode: "FR",
        regionCode: "FR-GUF",
        guesses: [bestGuess("GF", 10, { regionCode: "FR-GUF" })],
      }),
      makeRound("r6", "g", { countryCode: "BG", guesses: [] }),
    ];
    const pairs = confusionPairs(rounds);
    const wrong = rounds.filter((r) => mistakeClass(r) === "wrong-country");
    expect(pairs.reduce((n, p) => n + p.count, 0)).toBe(wrong.length);
    expect(pairs).toContainEqual({ actual: "FR-GUF", guessed: "FR", count: 1, damage: 0 });
  });
});

/**
 * The Workbench's pair rule before it moved to the shared function, kept here as
 * the reference: order-free, land guesses only, plain country codes.
 */
function workbenchPairsBefore(rounds: readonly StatsRound[]): Map<string, number> {
  const acc = new Map<string, number>();
  for (const r of rounds) {
    if (!r.countryCode) continue;
    const best = r.guesses.find((g) => g.isDuo && g.isBestForTeam);
    if (best?.countryCode && best.countryCode !== r.countryCode) {
      const key = [r.countryCode.toUpperCase(), best.countryCode.toUpperCase()].sort().join(":");
      acc.set(key, (acc.get(key) ?? 0) + 1);
    }
  }
  return acc;
}

describe("undirectedConfusionPairs", () => {
  it("adds up both directions and drops the water", () => {
    const pairs = undirectedConfusionPairs(
      confusionPairs([miss("r1", "FR", "BE"), miss("r2", "BE", "FR"), miss("r3", "FR", null)]),
    );
    expect(pairs).toEqual([{ countries: ["BE", "FR"], count: 2, damage: 1000 }]);
  });

  it("gives the Workbench the same counts as its old order-free rule", () => {
    const rounds = [
      miss("r1", "FR", "BE"),
      miss("r2", "BE", "FR"),
      miss("r3", "BG", "RO"),
      miss("r4", "BG", "RO"),
      miss("r5", "RO", "BG"),
      miss("r6", "NO", null),
      miss("r7", "SE", "SE"),
      makeRound("r8", "g", {
        countryCode: "FR",
        regionCode: "FR-GUF",
        guesses: [bestGuess("GF", 10, { regionCode: "FR-GUF" })],
      }),
      makeRound("r9", "g", {
        countryCode: "FR",
        regionCode: "FR-GUF",
        guesses: [bestGuess("FR", 7000, { regionCode: "FR-IDF" })],
      }),
      makeRound("r10", "g", { countryCode: null, guesses: [bestGuess("BG")] }),
      makeRound("r11", "g", { countryCode: "BG", guesses: [makeGuess({ countryCode: "RO" })] }),
    ];
    const shared = undirectedConfusionPairs(confusionPairs(rounds, PLAIN_COUNTRY));
    const before = workbenchPairsBefore(rounds);
    expect(new Map(shared.map((p) => [p.countries.join(":"), p.count]))).toEqual(before);
  });
});
