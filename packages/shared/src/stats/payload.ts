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
  /** The colour to draw the Player in, resolved for the viewer (#74), as in the workbench. */
  avatarColor: string;
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
  /** The Duo's place within its GeoGuessr bucket before and after the Game. */
  positionBefore: number | null;
  positionAfter: number | null;
  /** Every Session whose Recordings overlap the Game's relationship bounds (0..N; #56 1a-derivation). */
  sessionIds: string[];
  /** The one Session the Game's rating delta counts toward (ADR 0008), or null when none overlaps. */
  ratingSessionId: string | null;
}

export interface StatsRound {
  id: string;
  gameId: string;
  roundNumber: number;
  startedAtMs: number;
  /** GeoGuessr's own country for the location. */
  countryCode: string | null;
  /** The location's Region (GLOSSARY), from the geocoder. */
  regionCode: string | null;
  lat: number | null;
  lng: number | null;
  /** GeoGuessr's Street View pano id for the location, as stored: hex-encoded (see `decodePanoId`). */
  panoId: string | null;
  /** Where GeoGuessr pointed the camera at the start of the Round; null when the duel doesn't say. */
  panoView: PanoView | null;
  damageMultiplier: number;
  /** The Round's Damage (GLOSSARY) from the Duo's side: positive when dealt, negative when taken. */
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

/** A Street View camera as GeoGuessr gives it: degrees, and its own zoom level (0 = widest). */
export interface PanoView {
  heading: number;
  pitch: number;
  zoom: number;
}

export type StatsCall = "called" | "not-called";

/** One guess, trimmed: Opponents carry no identity beyond `isDuo: false`. */
export interface StatsGuess {
  /** The Duo's Player who guessed, or null for Opponents and unmatched Players. */
  playerId: string | null;
  isDuo: boolean;
  lat: number | null;
  lng: number | null;
  /** Where the guess landed, from the geocoder; null for water or a missing pin. */
  countryCode: string | null;
  regionCode: string | null;
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
