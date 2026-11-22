import type { StatsGame, StatsGuess, StatsPayload, StatsRound } from "../index.js";

/** Builders for statistics tests: sensible defaults, override what the test is about. */

export function makeGame(id: string, overrides: Partial<StatsGame> = {}): StatsGame {
  return {
    id,
    startedAtMs: Date.parse("2026-11-01T18:00:00Z"),
    won: true,
    ratingBefore: 1200,
    ratingAfter: 1210,
    mapName: "A Pro World",
    mode: "nm",
    opponentRatingBefore: 1200,
    positionBefore: null,
    positionAfter: null,
    sessionId: null,
    ...overrides,
  };
}

export function makeGuess(overrides: Partial<StatsGuess> = {}): StatsGuess {
  return {
    playerId: "p1",
    isDuo: true,
    lat: 0,
    lng: 0,
    countryCode: null,
    regionCode: null,
    distanceMeters: 0,
    score: 4000,
    guessedFirst: false,
    isBestForTeam: false,
    secondsToGuess: 20,
    timedOut: false,
    ...overrides,
  };
}

/** The Duo's best guess: placed, in `countryCode`, `km` off. */
export function bestGuess(
  countryCode: string | null,
  km = 0,
  overrides: Partial<StatsGuess> = {},
): StatsGuess {
  return makeGuess({ countryCode, distanceMeters: km * 1000, isBestForTeam: true, ...overrides });
}

export function makeRound(
  id: string,
  gameId: string,
  overrides: Partial<StatsRound> = {},
): StatsRound {
  return {
    id,
    gameId,
    roundNumber: 1,
    startedAtMs: Date.parse("2026-11-01T18:00:00Z"),
    countryCode: "BG",
    regionCode: null,
    lat: 0,
    lng: 0,
    damageMultiplier: 1,
    hpDelta: 0,
    duoBestScore: 4000,
    opponentBestScore: 4000,
    guesses: [],
    call: null,
    ...overrides,
  };
}

export function makePayload(overrides: Partial<StatsPayload> = {}): StatsPayload {
  return {
    duoId: "duo",
    players: [],
    sessions: [],
    games: [],
    rounds: [],
    learnings: [],
    ...overrides,
  };
}
