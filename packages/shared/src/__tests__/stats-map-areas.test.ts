import { describe, expect, it } from "vitest";
import {
  RANKING_PRIOR_ROUNDS,
  areaStats,
  mapRoundClass,
  opponentBestGuess,
  roundMeasure,
  shrunkMeasureBy,
  slowerDuoGuess,
} from "../index.js";
import { bestGuess, makeGuess, makeRound } from "./stats-fixtures.js";

const oppGuess = (countryCode: string | null, score = 3000) =>
  makeGuess({ playerId: null, isDuo: false, countryCode, score, isBestForTeam: true });

describe("mapRoundClass", () => {
  it("is won for a Round the Duo didn't lose, whatever its best guess", () => {
    const round = makeRound("r", "g", { hpDelta: 300, guesses: [bestGuess("RO", 200)] });
    expect(mapRoundClass(round)).toBe("won");
  });

  it("is the mistake class for a lost Round", () => {
    const round = makeRound("r", "g", { hpDelta: -300, guesses: [bestGuess("RO", 200)] });
    expect(mapRoundClass(round)).toBe("wrong-country");
  });
});

describe("roundMeasure", () => {
  const round = makeRound("r", "g", {
    duoBestScore: 3000,
    opponentBestScore: 4200,
    hpDelta: -1800,
    guesses: [bestGuess("RO", 200)],
  });

  it("gives the score gap, Damage taken and wrong country per Round", () => {
    expect(roundMeasure(round, "gap")).toBe(-1200);
    expect(roundMeasure(round, "damage")).toBe(1800);
    expect(roundMeasure(round, "wrong-country")).toBe(1);
    expect(roundMeasure(makeRound("w", "g", { guesses: [bestGuess("BG", 5)] }), "wrong-country")).toBe(0);
  });

  it("has no wrong-country value when the Duo placed no guess", () => {
    expect(roundMeasure(makeRound("n", "g"), "wrong-country")).toBeNull();
  });
});

describe("areaStats", () => {
  it("is null for no Rounds", () => {
    expect(areaStats([])).toBeNull();
  });

  it("sums up the Rounds for a hover card or an area", () => {
    const rounds = [
      makeRound("a", "g", {
        duoBestScore: 4500,
        opponentBestScore: 4000,
        hpDelta: 500,
        guesses: [bestGuess("BG", 10), oppGuess("RO")],
      }),
      makeRound("b", "g", {
        duoBestScore: 2500,
        opponentBestScore: 4000,
        hpDelta: -3000,
        damageMultiplier: 2,
        guesses: [bestGuess("RO", 300), oppGuess("BG")],
      }),
    ];
    expect(areaStats(rounds)).toEqual({
      rounds: 2,
      avgScore: 3500,
      gap: -500,
      damagePerRound: 1500,
      wrongCountryRate: 0.5,
      opponentWrongCountryRate: 0.5,
    });
  });

  it("leaves a rate out when no Round has a guess for it", () => {
    const s = areaStats([makeRound("a", "g", { guesses: [bestGuess("BG", 10)] })])!;
    expect(s.wrongCountryRate).toBe(0);
    expect(s.opponentWrongCountryRate).toBeNull();
  });
});

describe("opponentBestGuess", () => {
  it("is the Opponents' best guess, never the Duo's", () => {
    const best = oppGuess("RO", 4000);
    const round = makeRound("r", "g", {
      guesses: [bestGuess("BG"), makeGuess({ isDuo: false, playerId: null, score: 100 }), best],
    });
    expect(opponentBestGuess(round)).toBe(best);
  });
});

describe("shrunkMeasureBy", () => {
  it("pulls a key with few Rounds toward the Duo's mean with the default ranking method", () => {
    const rounds = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeRound(`bg${i}`, "g", { countryCode: "BG", duoBestScore: 4100, opponentBestScore: 4000 }),
      ),
      makeRound("ro", "g", { countryCode: "RO", duoBestScore: 3000, opponentBestScore: 4000 }),
    ];
    const byCountry = shrunkMeasureBy(rounds, "gap", (r) => r.countryCode);
    // Duo mean (9·100 − 1000) / 10 = −10; RO: (−1000 + 5·−10) / 6.
    expect(RANKING_PRIOR_ROUNDS).toBe(5);
    expect(byCountry.get("RO")).toBeCloseTo((-1000 + 5 * -10) / 6);
    expect(byCountry.get("BG")).toBeCloseTo((900 + 5 * -10) / 14);
  });

  it("skips Rounds without a key or a value", () => {
    const rounds = [makeRound("a", "g", { countryCode: null }), makeRound("b", "g", { countryCode: "BG" })];
    expect([...shrunkMeasureBy(rounds, "wrong-country", (r) => r.countryCode).keys()]).toEqual([]);
    expect([...shrunkMeasureBy(rounds, "gap", (r) => r.countryCode).keys()]).toEqual(["BG"]);
  });
});

describe("slowerDuoGuess", () => {
  const p1 = (seconds: number | null) => makeGuess({ playerId: "p1", secondsToGuess: seconds });
  const p2 = (seconds: number | null) => makeGuess({ playerId: "p2", secondsToGuess: seconds });

  it("is the Duo's later guess", () => {
    const late = p2(31);
    expect(slowerDuoGuess(makeRound("r", "g", { guesses: [p1(12), late] }))).toBe(late);
  });

  it("is null when the two guesses are under 0.5 s apart: the timer submitted both", () => {
    expect(slowerDuoGuess(makeRound("r", "g", { guesses: [p1(40.1), p2(40.4)] }))).toBeNull();
  });

  it("is null without two timed Duo guesses, and ignores the Opponents", () => {
    const opp = makeGuess({ isDuo: false, playerId: null, secondsToGuess: 60 });
    expect(slowerDuoGuess(makeRound("r", "g", { guesses: [p1(12), opp] }))).toBeNull();
    expect(slowerDuoGuess(makeRound("r", "g", { guesses: [p1(12), p2(null)] }))).toBeNull();
  });
});
