import { describe, expect, it } from "vitest";
import type { StatsGuess, StatsRound } from "@geo-coach/shared";
import {
  answersIn,
  duoGuessesIn,
  focusBounds,
  gameCamera,
  roundBounds,
  uniqueRounds,
  type PlacedRound,
} from "../geo.js";

function guess(lat: number, lng: number, overrides: Partial<StatsGuess> = {}): StatsGuess {
  return {
    playerId: "p1",
    isDuo: true,
    lat,
    lng,
    countryCode: null,
    regionCode: null,
    distanceMeters: 0,
    score: 4000,
    guessedFirst: false,
    isBestForTeam: false,
    timedOut: false,
    secondsToGuess: 20,
    ...overrides,
  };
}

function round(id: string, lat: number, lng: number, guesses: StatsGuess[] = []): PlacedRound {
  const r: StatsRound = {
    id,
    gameId: "g",
    roundNumber: 1,
    startedAtMs: 0,
    countryCode: "BG",
    regionCode: null,
    lat,
    lng,
    panoId: null,
    panoView: null,
    damageMultiplier: 1,
    hpDelta: 0,
    duoBestScore: 4000,
    opponentBestScore: 4000,
    guesses,
    call: null,
  };
  return r as PlacedRound;
}

// A box over Bulgaria.
const box = {
  type: "Polygon" as const,
  coordinates: [[[22, 41], [29, 41], [29, 44.5], [22, 44.5], [22, 41]]],
};

describe("answersIn and duoGuessesIn", () => {
  const sofia = round("sofia", 42.7, 23.3, [guess(44.4, 26.1), guess(42.1, 24.7)]);
  const paris = round("paris", 48.9, 2.35, [guess(42.5, 27.5), guess(42.6, 27.4, { isDuo: false, playerId: null })]);

  it("lists the Rounds whose answer is inside the area", () => {
    expect(answersIn([sofia, paris], box).map((h) => h.round.id)).toEqual(["sofia"]);
  });

  it("lists the Duo's guesses inside the area, never the Opponents'", () => {
    const hits = duoGuessesIn([sofia, paris], box);
    expect(hits.map((h) => [h.round.id, h.guess!.lat])).toEqual([
      ["sofia", 44.4],
      ["sofia", 42.1],
      ["paris", 42.5],
    ]);
    expect(uniqueRounds(hits).map((r) => r.id)).toEqual(["sofia", "paris"]);
  });
});

describe("focusBounds", () => {
  it("frames the answers and nearby best guesses, not a guess on another continent", () => {
    const near = round("a", 42.7, 23.3, [guess(44.4, 26.1, { isBestForTeam: true })]);
    const far = round("b", 43.2, 27.9, [guess(-33.9, 151.2, { isBestForTeam: true })]);
    expect(focusBounds([near, far])).toEqual([
      [23.3, 42.7],
      [27.9, 44.4],
    ]);
  });

  it("is null for no Rounds", () => {
    expect(focusBounds([])).toBeNull();
  });
});

describe("roundBounds", () => {
  it("frames the answer and every placed guess", () => {
    const r = round("a", 42.7, 23.3, [guess(44.4, 26.1), guess(40, 20, { isDuo: false }), guess(0, 0, { lat: null, lng: null })]);
    expect(roundBounds(r)).toEqual([
      [20, 40],
      [26.1, 44.4],
    ]);
  });
});

describe("gameCamera", () => {
  it("turns to the middle of nearby answers and zooms in", () => {
    const cam = gameCamera([round("a", 42, 23), round("b", 44, 25)])!;
    expect(cam.center[0]).toBeCloseTo(24, 0);
    expect(cam.center[1]).toBeCloseTo(43, 0);
    expect(cam.zoom).toBe(4);
  });

  it("zooms out for answers spread over the world, and centres across the antimeridian", () => {
    const cam = gameCamera([round("a", 0, 170), round("b", 0, -170)])!;
    expect(Math.abs(cam.center[0])).toBeCloseTo(180, 0);
    expect(gameCamera([round("a", 50, 0), round("b", -30, 120)])!.zoom).toBe(1.2);
  });
});
