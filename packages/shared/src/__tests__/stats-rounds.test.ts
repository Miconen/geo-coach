import { describe, expect, it } from "vitest";
import {
  bestDuoGuess,
  bestGuessShareOfCountrySize,
  damageDealt,
  damageTaken,
  isSlow,
  isSplit,
  mistakeClass,
  slowThreshold,
} from "../index.js";
import { bestGuess, makeGuess, makeRound } from "./stats-fixtures.js";

describe("mistakeClass", () => {
  it("judges a miss against the country's size, so small and large countries compare", () => {
    const andorra = makeRound("r1", "g1", { countryCode: "AD", guesses: [bestGuess("AD", 20)] });
    const russia = makeRound("r2", "g1", { countryCode: "RU", guesses: [bestGuess("RU", 1500)] });
    expect(mistakeClass(andorra)).toBe("close");
    expect(mistakeClass(russia)).toBe("close");
  });

  it("is far when the best guess is right-country but beyond half the country's size", () => {
    // Bulgaria is about 330 km across (√area).
    const round = makeRound("r", "g", { countryCode: "BG", guesses: [bestGuess("BG", 250)] });
    expect(mistakeClass(round)).toBe("far");
  });

  it("is wrong-country for a best guess in another country or in the water", () => {
    const other = makeRound("r1", "g", { countryCode: "BG", guesses: [bestGuess("RO", 40)] });
    const water = makeRound("r2", "g", { countryCode: "BG", guesses: [bestGuess(null, 40)] });
    expect(mistakeClass(other)).toBe("wrong-country");
    expect(mistakeClass(water)).toBe("wrong-country");
  });

  it("judges the best guess only, so a Split's hedge is not a mistake", () => {
    const round = makeRound("r", "g", {
      countryCode: "BG",
      guesses: [bestGuess("BG", 30), makeGuess({ countryCode: "RO", distanceMeters: 300_000 })],
    });
    expect(mistakeClass(round)).toBe("close");
  });

  it("leaves a Round unclassified without a placed best guess or without a country", () => {
    const unplaced = makeRound("r1", "g", {
      countryCode: "BG",
      guesses: [bestGuess(null, 0, { lat: null, lng: null, distanceMeters: null })],
    });
    const noGuess = makeRound("r2", "g", { countryCode: "BG", guesses: [] });
    const noCountry = makeRound("r3", "g", { countryCode: null, guesses: [bestGuess("BG", 10)] });
    expect(mistakeClass(unplaced)).toBeNull();
    expect(mistakeClass(noGuess)).toBeNull();
    expect(mistakeClass(noCountry)).toBeNull();
  });

  it("does not use points: a low-scoring right-country guess in a big country can be close", () => {
    const round = makeRound("r", "g", {
      countryCode: "BR",
      guesses: [bestGuess("BR", 900, { score: 1800 })],
    });
    expect(mistakeClass(round)).toBe("close");
  });

  describe("overseas Regions count as their own country", () => {
    it("is wrong-country for an answer in French Guiana and a best guess in Paris", () => {
      // GeoGuessr reports the Round as FR; its Region places it in French Guiana.
      const round = makeRound("r", "g", {
        countryCode: "FR",
        regionCode: "FR-GUF",
        guesses: [bestGuess("FR", 7000, { regionCode: "FR-IDF" })],
      });
      expect(mistakeClass(round)).toBe("wrong-country");
    });

    it("is wrong-country the other way round, for a guess in an overseas Region", () => {
      const round = makeRound("r", "g", {
        countryCode: "FR",
        regionCode: "FR-IDF",
        guesses: [bestGuess("GF", 7000, { regionCode: "FR-GUF" })],
      });
      expect(mistakeClass(round)).toBe("wrong-country");
    });

    it("judges a guess within the overseas Region against the Region's own size", () => {
      const inGuiana = (km: number) =>
        makeRound("r", "g", {
          countryCode: "FR",
          regionCode: "FR-GUF",
          guesses: [bestGuess("GF", km, { regionCode: "FR-GUF" })],
        });
      // French Guiana is about 290 km across.
      expect(mistakeClass(inGuiana(100))).toBe("close");
      expect(mistakeClass(inGuiana(250))).toBe("far");
    });

    it("works for overseas Regions the geocoder places in the sovereign country", () => {
      const azores = makeRound("r", "g", {
        countryCode: "PT",
        regionCode: "PT-20",
        guesses: [bestGuess("PT", 1500, { regionCode: "PT-11" })],
      });
      expect(mistakeClass(azores)).toBe("wrong-country");
    });
  });
});

describe("bestGuessShareOfCountrySize", () => {
  it("is the best guess's distance over the country's size", () => {
    const round = makeRound("r", "g", { countryCode: "RU", guesses: [bestGuess("RU", 2054.5)] });
    expect(bestGuessShareOfCountrySize(round)).toBeCloseTo(0.5, 2);
  });
});

describe("isSplit", () => {
  it("is true when the Duo's placed guesses land in two or more countries", () => {
    const split = makeRound("r", "g", {
      guesses: [bestGuess("ES"), makeGuess({ countryCode: "PT" })],
    });
    expect(isSplit(split)).toBe(true);
  });

  it("is false for one country, and ignores Opponents and unplaced guesses", () => {
    const sameCountry = makeRound("r1", "g", {
      guesses: [
        bestGuess("ES", 10, { regionCode: "ES-AN" }),
        makeGuess({ countryCode: "ES", regionCode: "ES-GA" }),
        makeGuess({ isDuo: false, countryCode: "PT" }),
        makeGuess({ countryCode: null, lat: null, lng: null }),
      ],
    });
    expect(isSplit(sameCountry)).toBe(false);
  });
});

describe("Damage", () => {
  it("splits hpDelta into dealt and taken, overkill counted", () => {
    expect(damageDealt(makeRound("r", "g", { hpDelta: 7200 }))).toBe(7200);
    expect(damageTaken(makeRound("r", "g", { hpDelta: 7200 }))).toBe(0);
    expect(damageDealt(makeRound("r", "g", { hpDelta: -350 }))).toBe(0);
    expect(damageTaken(makeRound("r", "g", { hpDelta: -350 }))).toBe(350);
  });
});

describe("slow guesses", () => {
  const roundTaking = (id: string, seconds: number | null) =>
    makeRound(id, "g", { guesses: [bestGuess("BG", 10, { secondsToGuess: seconds })] });

  it("sets the threshold at the 75th percentile of the best guess's time to guess", () => {
    const rounds = [10, 20, 30, 40, 50].map((s, i) => roundTaking(`r${i}`, s));
    expect(slowThreshold(rounds)).toBe(40);
  });

  it("calls a Round slow when its best guess took longer than the threshold", () => {
    expect(isSlow(roundTaking("a", 41), 40)).toBe(true);
    expect(isSlow(roundTaking("b", 40), 40)).toBe(false);
    expect(isSlow(roundTaking("c", null), 40)).toBe(false);
    expect(isSlow(roundTaking("d", 90), null)).toBe(false);
  });

  it("finds the best guess by the Duo's own marker", () => {
    const round = makeRound("r", "g", {
      guesses: [makeGuess({ score: 100 }), bestGuess("BG", 5, { score: 4900 })],
    });
    expect(bestDuoGuess(round)?.score).toBe(4900);
  });
});
