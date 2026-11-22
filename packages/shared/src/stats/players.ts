// The Players section of the statistics page: each Duo Player's numbers side by
// side, over the filtered Rounds. Opponents' guesses never count here.

import type { FilteredStats } from "./filter.js";
import { duoFirstGuesser } from "./first-guesser.js";
import { mean, median } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";
import { isGreyedOut, type CountryRow } from "./rankings.js";
import { bestDuoGuess, isPlaced, isSplit } from "./rounds.js";

/** A carry chip names a country where the Player had the Duo's best guess at least this share of the time. */
export const CARRY_SHARE = 0.6;

/** Rounds in each window of the Players trend. */
export const ROLLING_WINDOW_ROUNDS = 50;

/** Just the Player's id; a `StatsPlayer` fits. */
export interface PlayerRef {
  id: string;
}

/** The Player's placed guess on the Round, or null when they placed none. */
export function playerGuess(round: StatsRound, playerId: string): StatsGuess | null {
  return round.guesses.find((g) => g.isDuo && g.playerId === playerId && isPlaced(g)) ?? null;
}

/** True when the Player's placed guess was the Duo's best on the Round. */
export function isPlayerBest(round: StatsRound, playerId: string): boolean {
  const best = bestDuoGuess(round);
  return best !== null && best.playerId === playerId && isPlaced(best);
}

const kmOf = (g: StatsGuess): number[] => (g.distanceMeters === null ? [] : [g.distanceMeters / 1000]);

/** Median km off of the Player's placed guesses on the Rounds that aren't Splits. */
function medianKmNotSplit(rounds: readonly StatsRound[], playerId: string): number | null {
  return median(
    rounds.flatMap((r) => {
      const g = playerGuess(r, playerId);
      return g && !isSplit(r) ? kmOf(g) : [];
    }),
  );
}

export interface GuessGroup {
  guesses: number;
  avgScore: number | null;
  medianKm: number | null;
}

function guessGroup(guesses: readonly StatsGuess[]): GuessGroup {
  return {
    guesses: guesses.length,
    avgScore: mean(guesses.map((g) => g.score)),
    medianKm: median(guesses.flatMap(kmOf)),
  };
}

export interface PlayerSummary {
  playerId: string;
  /** The filtered Rounds, the denominator of `bestShare`. */
  rounds: number;
  /** Rounds where the Player's guess was the Duo's best. */
  bestRounds: number;
  bestShare: number | null;
  /** Median km off over Rounds that aren't Splits (on a Split the other guess is a hedge). */
  medianKm: number | null;
  /** Median seconds to guess over pressed guesses only: a timed-out guess's time is just the timer. */
  medianSeconds: number | null;
  /** Rounds where the Player placed a guess. */
  placed: number;
  /** Placed guesses that timed out (GLOSSARY: Timed-out guess), and their share of the placed. */
  timedOut: number;
  timedOutShare: number | null;
  /** Rounds where the Player placed no guess: never their best, never in their medians. */
  noGuess: number;
  /** "Does waiting pay?": pressed against timed-out guesses, on Rounds that aren't Splits. */
  waiting: { pressed: GuessGroup; timedOut: GuessGroup };
}

/** One summary per Player, in the order given, over the filtered Rounds. */
export function playerSummaries(
  filtered: FilteredStats,
  players: readonly PlayerRef[],
): PlayerSummary[] {
  const { rounds } = filtered;
  return players.map(({ id }) => {
    const placed = rounds.flatMap((r) => {
      const g = playerGuess(r, id);
      return g ? [{ round: r, guess: g }] : [];
    });
    const bestRounds = rounds.filter((r) => isPlayerBest(r, id)).length;
    const timedOut = placed.filter((p) => p.guess.timedOut).length;
    const notSplit = placed.filter((p) => !isSplit(p.round)).map((p) => p.guess);
    return {
      playerId: id,
      rounds: rounds.length,
      bestRounds,
      bestShare: rounds.length ? bestRounds / rounds.length : null,
      medianKm: median(notSplit.flatMap(kmOf)),
      medianSeconds: median(
        placed.flatMap(({ guess: g }) =>
          !g.timedOut && g.secondsToGuess !== null ? [g.secondsToGuess] : [],
        ),
      ),
      placed: placed.length,
      timedOut,
      timedOutShare: placed.length ? timedOut / placed.length : null,
      noGuess: rounds.length - placed.length,
      waiting: {
        pressed: guessGroup(notSplit.filter((g) => !g.timedOut)),
        timedOut: guessGroup(notSplit.filter((g) => g.timedOut)),
      },
    };
  });
}

export interface PlayerFirstStats {
  playerId: string;
  /** Rounds where this Player pressed guess first within the Duo. */
  first: number;
  /** `first` as a share of all the filtered Rounds. */
  share: number | null;
  /** The Player's best-guess share on the Rounds where they were first … */
  bestShareWhenFirst: number | null;
  /** … and on the Rounds where the other Player was first. */
  bestShareWhenOtherFirst: number | null;
}

export interface FirstGuesserStats {
  rounds: number;
  /** Rounds where both Duo guesses timed out: neither was first. */
  bothTimedOut: number;
  bothTimedOutShare: number | null;
  /** Rounds where no Duo Player pressed guess otherwise (a Player didn't guess). */
  noPressedGuess: number;
  players: PlayerFirstStats[];
}

/** "Who guesses first?" within the Duo (GLOSSARY: Timed-out guess); Opponents never count. */
export function firstGuesserStats(
  rounds: readonly StatsRound[],
  players: readonly PlayerRef[],
): FirstGuesserStats {
  const firsts = rounds.map((r) => ({ round: r, first: duoFirstGuesser(r.guesses) }));
  const share = (n: number) => (rounds.length ? n / rounds.length : null);
  const bestShare = (rs: readonly StatsRound[], id: string) =>
    rs.length ? rs.filter((r) => isPlayerBest(r, id)).length / rs.length : null;
  const bothTimedOut = firsts.filter((f) => f.first.kind === "bothTimedOut").length;
  return {
    rounds: rounds.length,
    bothTimedOut,
    bothTimedOutShare: share(bothTimedOut),
    noPressedGuess: firsts.filter((f) => f.first.kind === "noPressedGuess").length,
    players: players.map(({ id }) => {
      const mine = firsts.filter((f) => f.first.kind === "player" && f.first.playerId === id);
      const theirs = firsts.filter((f) => f.first.kind === "player" && f.first.playerId !== id);
      return {
        playerId: id,
        first: mine.length,
        share: share(mine.length),
        bestShareWhenFirst: bestShare(mine.map((f) => f.round), id),
        bestShareWhenOtherFirst: bestShare(theirs.map((f) => f.round), id),
      };
    }),
  };
}

export interface CarryChip {
  countryCode: string;
  /** The Player's best-guess share in the country. */
  share: number;
  rounds: number;
}

/**
 * The countries where the Player had the Duo's best guess at least CARRY_SHARE of
 * the time, highest share first. Countries below the grey-out threshold shared
 * with Rankings are left out, even at 100%.
 */
export function carryChips(
  rows: readonly CountryRow[],
  playerId: string,
  greyOutRounds: number,
): CarryChip[] {
  return rows
    .filter((row) => !isGreyedOut(row, greyOutRounds))
    .map((row) => ({
      countryCode: row.countryCode,
      share: row.bestGuessShare[playerId] ?? 0,
      rounds: row.rounds,
    }))
    .filter((chip) => chip.share >= CARRY_SHARE)
    .sort((a, b) => b.share - a.share || b.rounds - a.rounds || a.countryCode.localeCompare(b.countryCode));
}

export interface RollingPoint {
  /** The 1-based position, in Round order, of the window's last Round. */
  roundIndex: number;
  /** The Player's best-guess share over the window. */
  bestShare: number;
  /** The Player's median km off over the window's Rounds that aren't Splits. */
  medianKm: number | null;
}

/** Rounds in play order: by start time, then Round number. */
function inRoundOrder(rounds: readonly StatsRound[]): StatsRound[] {
  return [...rounds].sort((a, b) => a.startedAtMs - b.startedAtMs || a.roundNumber - b.roundNumber);
}

/**
 * The Player's trend: one point per full window of `window` Rounds, in Round
 * order. Empty with fewer Rounds than the window, never a partial window.
 */
export function rollingSeries(
  rounds: readonly StatsRound[],
  playerId: string,
  window: number,
): RollingPoint[] {
  const ordered = inRoundOrder(rounds);
  const points: RollingPoint[] = [];
  for (let end = window; end <= ordered.length; end += 1) {
    const slice = ordered.slice(end - window, end);
    points.push({
      roundIndex: end,
      bestShare: slice.filter((r) => isPlayerBest(r, playerId)).length / window,
      medianKm: medianKmNotSplit(slice, playerId),
    });
  }
  return points;
}
