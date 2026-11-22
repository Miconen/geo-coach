import { describe, expect, it } from "vitest";
import { hedgeSummary, teamHedgeRound, type HedgeKind, type StatsGuess } from "../index.js";
import { makeGuess, makeRound } from "./stats-fixtures.js";

// Spain: Madrid and a Madrid suburb share a Region; Toledo is another Region.
const madrid = { lat: 40.42, lng: -3.7, countryCode: "ES", regionCode: "ES-MD" };
const suburb = { lat: 40.3, lng: -3.8, countryCode: "ES", regionCode: "ES-MD" };
const toledo = { lat: 39.86, lng: -4.02, countryCode: "ES", regionCode: "ES-CM" };
const lisbon = { lat: 38.72, lng: -9.14, countryCode: "PT", regionCode: "PT-11" };

type Place = typeof madrid;

function team(isDuo: boolean, best: Place, other: Place | null): StatsGuess[] {
  const playerId = isDuo ? "p1" : null;
  return [
    makeGuess({ ...best, isDuo, playerId, isBestForTeam: true }),
    other
      ? makeGuess({ ...other, isDuo, playerId: isDuo ? "p2" : null })
      : makeGuess({ isDuo, playerId: isDuo ? "p2" : null, lat: null, lng: null }),
  ];
}

let n = 0;
function round(
  duo: [Place, Place | null],
  opponents: [Place, Place | null],
  overrides: { duoBest?: number; oppBest?: number; hpDelta?: number; call?: "called" | "not-called" | null } = {},
) {
  n += 1;
  return makeRound(`r${n}`, "g1", {
    countryCode: "ES",
    regionCode: "ES-MD",
    duoBestScore: overrides.duoBest ?? 4000,
    opponentBestScore: overrides.oppBest ?? 4000,
    hpDelta: overrides.hpDelta ?? 0,
    call: overrides.call ?? null,
    guesses: [...team(true, ...duo), ...team(false, ...opponents)],
  });
}

const kindOf = (s: ReturnType<typeof hedgeSummary>["duo"], kind: HedgeKind) =>
  s.kinds.find((k) => k.kind === kind)!;

describe("hedgeSummary", () => {
  const rounds = [
    // Duo commits twice, Opponents Split both times.
    round([madrid, suburb], [madrid, lisbon], { duoBest: 4800, oppBest: 4500, hpDelta: 300 }),
    round([madrid, suburb], [lisbon, madrid], { duoBest: 4600, oppBest: 4700, hpDelta: -100 }),
    // Duo Spreads; Opponents commit. Toledo is best but Madrid's Region is right.
    round([toledo, madrid], [suburb, madrid], { duoBest: 4000, oppBest: 4900, hpDelta: -900, call: "called" }),
    // Duo Splits twice (one labelled not called, one never labelled); Opponents Spread.
    round([lisbon, toledo], [madrid, toledo], { duoBest: 3000, oppBest: 4000, hpDelta: -1000, call: "not-called" }),
    round([lisbon, toledo], [madrid, toledo], { duoBest: 3500, oppBest: 3000, hpDelta: 500 }),
    // One placed Duo guess: unclassified for the Duo, a Spread for the Opponents.
    round([madrid, null], [madrid, toledo]),
  ];
  const s = hedgeSummary({ rounds });

  it("counts the Duo's kinds and shares over its classified Rounds", () => {
    expect(s.duo.kinds.map((k) => [k.kind, k.rounds])).toEqual([
      ["committed", 2],
      ["spread", 1],
      ["split", 2],
    ]);
    expect(s.duo.classified).toBe(5);
    expect(s.duo.unclassified).toBe(1);
    expect(kindOf(s.duo, "committed").share).toBeCloseTo(0.4);
  });

  it("averages the score gap and Damage from the Duo's side", () => {
    const committed = kindOf(s.duo, "committed");
    expect(committed.avgScoreGap).toBe(100); // (+300 − 100) / 2
    expect(committed.avgDamage).toBe(100); // (+300 − 100) / 2
    expect(kindOf(s.duo, "split").avgScoreGap).toBe(-250);
  });

  it("counts a right country or Region when either guess covers it", () => {
    const split = kindOf(s.duo, "split");
    expect(split.rightCountry).toBe(1); // Toledo is in Spain, though Lisbon may be best
    expect(split.rightRegion).toBe(0);
    expect(kindOf(s.duo, "spread").rightRegion).toBe(1); // Madrid, not the best guess
    expect(kindOf(s.duo, "committed").rightRegion).toBe(1);
  });

  it("gives the Opponents' baseline from their own side, classified by the same rules", () => {
    expect(s.opponents.kinds.map((k) => [k.kind, k.rounds])).toEqual([
      ["committed", 1],
      ["spread", 3],
      ["split", 2],
    ]);
    expect(s.opponents.classified).toBe(6);
    expect(s.opponents.unclassified).toBe(0);
    const committed = kindOf(s.opponents, "committed");
    expect(committed.share).toBeCloseTo(1 / 6);
    expect(committed.avgScoreGap).toBe(900); // 4900 − 4000, their side
    expect(committed.avgDamage).toBe(900); // the Duo took 900
    const split = kindOf(s.opponents, "split");
    expect(split.avgScoreGap).toBe(-100); // (−300 + 100) / 2
    expect(split.rightCountry).toBe(1);
  });

  it("breaks the Duo's Splits and Spreads down by Call, unlabelled kept apart from not called", () => {
    expect(s.calls.split).toEqual({ called: 0, notCalled: 1, unlabelled: 1 });
    expect(s.calls.spread).toEqual({ called: 1, notCalled: 0, unlabelled: 0 });
  });

  it("counts every unlabelled Split as unlabelled, never as not called", () => {
    const unlabelled = hedgeSummary({
      rounds: [round([lisbon, toledo], [madrid, suburb]), round([lisbon, madrid], [madrid, suburb])],
    });
    expect(unlabelled.calls.split).toEqual({ called: 0, notCalled: 0, unlabelled: 2 });
  });

  it("keeps all three kinds, empty ones with null averages, when there are no Rounds", () => {
    const empty = hedgeSummary({ rounds: [] });
    expect(empty.duo.kinds.map((k) => k.kind)).toEqual(["committed", "spread", "split"]);
    expect(empty.duo.kinds.every((k) => k.rounds === 0 && k.share === null && k.avgScoreGap === null)).toBe(true);
  });

  it("measures the distance between guesses and its share of the country's size", () => {
    const hedge = teamHedgeRound(rounds[2]!, "duo");
    expect(hedge.kind).toBe("spread");
    expect(hedge.distanceMeters! / 1000).toBeCloseTo(66, -1);
    expect(hedge.spread).toBeGreaterThan(0);
    expect(kindOf(s.duo, "spread").medianSpread).toBeCloseTo(hedge.spread!);
  });
});
