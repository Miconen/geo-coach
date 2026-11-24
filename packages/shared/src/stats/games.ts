import type { StatsGame } from "./payload.js";

const byStart = (games: readonly StatsGame[]) =>
  [...games].sort((a, b) => a.startedAtMs - b.startedAtMs);

/** Runs this long or longer are shown as bands on the rating chart. */
export const MIN_STREAK_RUN = 3;

export interface StreakRun {
  won: boolean;
  length: number;
  firstGameId: string;
  lastGameId: string;
}

export interface Streaks {
  /** The run up to the latest Game: wins positive, losses negative, 0 with no decided Games. */
  current: number;
  /** The longest run of wins. */
  best: number;
  /** The longest run of losses, as a positive count. */
  worst: number;
  /** Runs of 3+ wins and of 3+ losses, oldest first. */
  winRuns: StreakRun[];
  lossRuns: StreakRun[];
}

/**
 * Win and loss streaks over the given Games, in start order. A run breaks only on
 * the other result: gaps in time and undecided Games don't break it. GeoGuessr's
 * own stored streak is deliberately not read, so this follows the filter.
 */
export function streaks(games: readonly StatsGame[]): Streaks {
  const decided = byStart(games).filter((g) => g.won !== null);
  const runs: StreakRun[] = [];
  for (const game of decided) {
    const last = runs.at(-1);
    if (last && last.won === game.won) {
      last.length += 1;
      last.lastGameId = game.id;
    } else {
      runs.push({ won: game.won!, length: 1, firstGameId: game.id, lastGameId: game.id });
    }
  }
  const longest = (won: boolean) =>
    runs.filter((r) => r.won === won).reduce((max, r) => Math.max(max, r.length), 0);
  const current = runs.at(-1);
  return {
    current: current ? (current.won ? current.length : -current.length) : 0,
    best: longest(true),
    worst: longest(false),
    winRuns: runs.filter((r) => r.won && r.length >= MIN_STREAK_RUN),
    lossRuns: runs.filter((r) => !r.won && r.length >= MIN_STREAK_RUN),
  };
}

export interface RatingPoint {
  gameId: string;
  /** 1-based position of the Game among the given Games, in start order. */
  gameNumber: number;
  startedAtMs: number;
  /** The Duo's rating after the Game, or null when GeoGuessr gave none. */
  rating: number | null;
  ratingBefore: number | null;
  /** The Duo's place in its GeoGuessr bucket after the Game. */
  position: number | null;
  won: boolean | null;
  opponentRatingBefore: number | null;
  sessionIds: string[];
}

/** One point per Game, in start order, for the rating line. */
export function ratingSeries(games: readonly StatsGame[]): RatingPoint[] {
  return byStart(games).map((g, i) => ({
    gameId: g.id,
    gameNumber: i + 1,
    startedAtMs: g.startedAtMs,
    rating: g.ratingAfter,
    ratingBefore: g.ratingBefore,
    position: g.positionAfter,
    won: g.won,
    opponentRatingBefore: g.opponentRatingBefore,
    sessionIds: g.sessionIds,
  }));
}

export interface GameHeadline {
  games: number;
  /** Games with a result. */
  decided: number;
  wins: number;
  winRate: number | null;
  /** The rating before the first rated Game. */
  ratingFrom: number | null;
  /** The rating after the latest rated Game. */
  rating: number | null;
  ratingChange: number | null;
  /** The latest known place in the Duo's GeoGuessr bucket. */
  position: number | null;
}

/** The Game-level headline numbers: win rate, rating and its change, position. */
export function gameHeadline(games: readonly StatsGame[]): GameHeadline {
  const ordered = byStart(games);
  const decided = ordered.filter((g) => g.won !== null);
  const wins = decided.filter((g) => g.won).length;
  const ratingFrom = ordered.find((g) => g.ratingBefore !== null)?.ratingBefore ?? null;
  const rating = ordered.findLast((g) => g.ratingAfter !== null)?.ratingAfter ?? null;
  return {
    games: ordered.length,
    decided: decided.length,
    wins,
    winRate: decided.length > 0 ? wins / decided.length : null,
    ratingFrom,
    rating,
    ratingChange: ratingFrom !== null && rating !== null ? rating - ratingFrom : null,
    position: ordered.findLast((g) => g.positionAfter !== null)?.positionAfter ?? null,
  };
}
