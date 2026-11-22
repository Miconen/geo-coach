import type { GameMode } from "../geoguessr.js";

/**
 * The compact data the statistics page loads once per Duo (ADR 0003). Times are
 * epoch milliseconds; every panel is computed from these rows in the browser.
 */
export interface StatsPayload {
  duoId: string;
  players: StatsPlayer[];
  sessions: StatsSession[];
  games: StatsGame[];
  rounds: StatsRound[];
  learnings: StatsLearning[];
}

export interface StatsPlayer {
  id: string;
  displayName: string;
}

export interface StatsSession {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface StatsGame {
  id: string;
  startedAtMs: number;
  won: boolean | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  mapName: string | null;
  mode: GameMode | null;
  opponentRatingBefore: number | null;
  /** The Session the Game was played in, if any Recording covered it. */
  sessionId: string | null;
}

export interface StatsRound {
  id: string;
  gameId: string;
  roundNumber: number;
  startedAtMs: number;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  damageMultiplier: number;
  hpDelta: number;
  duoBestScore: number;
  opponentBestScore: number;
  guesses: StatsGuess[];
  /**
   * Whether the Duo agreed this Split or Spread aloud (GLOSSARY: Call), from the
   * current `calls` Processing run. Null when never labelled, or when the Round
   * is not a Split or Spread: show it as "unlabelled", never as "not called".
   */
  call: StatsCall | null;
}

export type StatsCall = "called" | "not-called";

/** One guess, trimmed: Opponents carry no identity beyond `isDuo: false`. */
export interface StatsGuess {
  /** The Duo's Player who guessed, or null for Opponents and unmatched Players. */
  playerId: string | null;
  isDuo: boolean;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  score: number;
  guessedFirst: boolean;
  isBestForTeam: boolean;
  /** GLOSSARY: Timed-out guess. The timer submitted it; the Player never pressed guess. */
  timedOut: boolean;
  /** Seconds from the Round's start to the guess. */
  secondsToGuess: number | null;
}

export interface StatsLearning {
  id: string;
  countryCodes: string[];
  createdAtMs: number;
}
