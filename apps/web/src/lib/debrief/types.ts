// The debrief view (#79): the Session page's map-first debrief, and the Game and Round pages scoped to one Game or
// Round (#82). The server builds it (src/lib/server/debrief) and the view derives everything else in the browser.
import type { GameMode, PanoView, TeamHp } from "@geo-coach/shared";
import type { WorkbenchLearning } from "$lib/server/workbench/view-model.js";

export interface DebriefPlayer {
  id: string;
  name: string;
  /** The Player's colour, resolved for the viewer (#74). */
  color: string;
  initial: string;
}

export interface DebriefGuess {
  /** The Duo's Player, or null for Opponents. Opponents carry no name. */
  playerId: string | null;
  isDuo: boolean;
  lat: number | null;
  lng: number | null;
  countryCode: string | null;
  distanceMeters: number | null;
  score: number;
  /** Seconds from the Round's start to the guess. */
  secondsToGuess: number | null;
  timedOut: boolean;
  /** Started the Countdown: the Round's first guess, across both teams. */
  guessedFirst: boolean;
  isBestForTeam: boolean;
  /** The Duo's slower guess (slowerDuoGuess). */
  slower: boolean;
}

/** One Utterance of a Round's transcript. */
export interface DebriefLine {
  id: string;
  playerId: string;
  text: string;
  /** Seconds from the Round's start. */
  atS: number;
  /** Said after guessing ended: a reaction to the reveal, dimmed and hidden under Recall. */
  afterEnd: boolean;
}

/** A country a Player named while guessing was on (#86), with the Utterances that named it, oldest first. */
export interface SaidCountry {
  code: string;
  lines: DebriefLine[];
}

export interface DebriefRound {
  id: string;
  gameId: string;
  /** "Game N": the Game's number within its Session (or its day, when no one recorded). */
  gameNumber: number;
  roundNumber: number;
  /** The Game's Round count. */
  roundCount: number;
  countryCode: string | null;
  countryName: string | null;
  regionName: string | null;
  lat: number | null;
  lng: number | null;
  panoId: string | null;
  panoView: PanoView | null;
  won: boolean;
  /** The Round's Damage from the Duo's side: + dealt, − taken. */
  hpDelta: number;
  damageMultiplier: number;
  duoBestScore: number;
  opponentBestScore: number;
  hpBefore: TeamHp;
  hpAfter: TeamHp;
  mode: GameMode | null;
  mapName: string | null;
  /** The Duo first (best first), then Opponents. */
  guesses: DebriefGuess[];
  /** The Duo's best guess: its country and km. */
  bestCountry: string | null;
  bestKm: number | null;
  /** The Duo's best guess landed in another country. */
  wrongCountry: boolean;
  /** Neither Duo guess landed in the answer country. */
  missedAnswer: boolean;
  /** Current Learnings citing this Round. */
  learningIds: string[];
  /** The Round's speech, oldest first. Empty when no one recorded, or when speech isn't loaded. */
  transcript: DebriefLine[];
  /** Seconds from the Round's start to the end of guessing. */
  endS: number;
  /** Seconds from the Round's start to the Countdown's start (the first guess); null without a timer start. */
  countdownS: number | null;
  /**
   * Said aloud, not guessed (#80): the Utterances, before guessing ended, that named the answer country when neither
   * Duo guess landed there. Empty otherwise.
   */
  saidAloud: DebriefLine[];
  /** Every country a Player named while guessing was on (#86), in order of first mention, guessed or not. */
  saidWhileGuessing: SaidCountry[];
}

export interface DebriefGame {
  id: string;
  number: number;
  won: boolean | null;
  ratingDelta: number | null;
  startedAt: string;
  /** Its Rounds (stored number > 0), in play order. */
  roundIds: string[];
  learningCount: number;
}

export interface Debrief {
  players: Record<string, DebriefPlayer>;
  /** In play order. */
  games: DebriefGame[];
  /** Every Round of `games`, in play order. */
  rounds: DebriefRound[];
  /** Current Learnings the view shows, by id. */
  learnings: Record<string, WorkbenchLearning>;
  /** Learnings of the Session that cite none of its Rounds. */
  sessionLearningIds: string[];
  /** Whether the Games were recorded (a Session exists): otherwise the transcript panel says so. */
  recorded: boolean;
}

/** What the view shows: a whole Session, one Game, or one Round (#82). */
export type DebriefScope = { kind: "session" } | { kind: "game"; gameId: string } | { kind: "round"; roundId: string };
