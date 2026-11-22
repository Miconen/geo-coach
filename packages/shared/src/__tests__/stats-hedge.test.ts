import { describe, expect, it } from "vitest";
import { hedgeKind, isCallableHedge, roundHedge, type HedgeGuess } from "../index.js";

function guess(
  lat: number | null,
  lng: number | null,
  countryCode: string | null,
  regionCode: string | null,
): HedgeGuess {
  return { lat, lng, countryCode, regionCode };
}

const madrid = guess(40.42, -3.7, "ES", "ES-MD");
const toledo = guess(39.86, -4.02, "ES", "ES-CM");
const madridSuburb = guess(40.3, -3.8, "ES", "ES-MD");
const lisbon = guess(38.72, -9.14, "PT", "PT-11");
const unplaced = guess(null, null, null, null);
const water = guess(39.5, -12.0, null, null);

describe("hedgeKind (GLOSSARY: Committed, Spread, Split)", () => {
  it("two guesses in one Region are Committed", () => {
    expect(hedgeKind([madrid, madridSuburb])).toBe("committed");
  });

  it("one country, two Regions is a Spread", () => {
    expect(hedgeKind([madrid, toledo])).toBe("spread");
  });

  it("two countries is a Split", () => {
    expect(hedgeKind([madrid, lisbon])).toBe("split");
  });

  it("one placed guess is unclassified", () => {
    expect(hedgeKind([madrid, unplaced])).toBeNull();
    expect(hedgeKind([madrid])).toBeNull();
    expect(hedgeKind([])).toBeNull();
  });

  it("a guess in water, or a missing Region within one country, is unclassified", () => {
    expect(hedgeKind([madrid, water])).toBeNull();
    expect(hedgeKind([madrid, guess(40.0, -3.0, "ES", null)])).toBeNull();
  });

  it("a missing Region does not stop a Split", () => {
    expect(hedgeKind([guess(46.8, 8.2, "CH", null), lisbon])).toBe("split");
  });

  it("classifies the Opponents' guesses with the same function", () => {
    // Opponents' guesses carry no identity, only where they landed.
    const opponents = [
      { ...lisbon, isDuo: false, playerId: null },
      { ...madrid, isDuo: false, playerId: null },
    ];
    expect(hedgeKind(opponents)).toBe("split");
    const spreadOpponents = [madrid, toledo].map((g) => ({ ...g, isDuo: false }));
    expect(hedgeKind(spreadOpponents)).toBe("spread");
  });
});

describe("roundHedge", () => {
  const round = { countryCode: "ES" };

  it("measures the distance between the two guesses", () => {
    const hedge = roundHedge(round, [madrid, lisbon]);
    expect(hedge.kind).toBe("split");
    expect(hedge.distanceMeters! / 1000).toBeCloseTo(502, -1);
    expect(hedge.spread).toBeNull();
  });

  it("has no distance with fewer than two placed guesses", () => {
    expect(roundHedge(round, [madrid, unplaced])).toEqual({
      kind: null,
      distanceMeters: null,
      spread: null,
    });
  });

  it("normalises by country size when a size lookup is given", () => {
    const sizes: Record<string, number> = { ES: 711_000, PT: 304_000 };
    const lookup = (cc: string) => sizes[cc] ?? null;
    const spread = roundHedge(round, [madrid, toledo], lookup);
    expect(spread.spread).toBeCloseTo(spread.distanceMeters! / 711_000);
    // A Split is normalised by the Round's country.
    const split = roundHedge({ countryCode: "PT" }, [madrid, lisbon], lookup);
    expect(split.spread).toBeCloseTo(split.distanceMeters! / 304_000);
    expect(roundHedge({ countryCode: "XX" }, [madrid, lisbon], lookup).spread).toBeNull();
  });
});

describe("isCallableHedge", () => {
  it("is true only for Splits and Spreads", () => {
    expect(isCallableHedge("split")).toBe(true);
    expect(isCallableHedge("spread")).toBe(true);
    expect(isCallableHedge("committed")).toBe(false);
    expect(isCallableHedge(null)).toBe(false);
  });
});
