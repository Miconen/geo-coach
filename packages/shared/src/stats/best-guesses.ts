// "Best guesses": a shortlist per Player of guesses worth looking at again. A
// truly great guess is close, fast, obscure and hard; statistics can't judge
// that without seeing the location, so this ranks candidates, not verdicts.

import type { GameMode } from "../geoguessr.js";
import { mistakeCountryCode } from "../overseas-regions.js";
import type { FilteredStats } from "./filter.js";
import { mean } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";
import { isPlaced } from "./rounds.js";

/** Rows shown per Player. */
export const BEST_GUESSES_PER_PLAYER = 10;

const MAX_SCORE = 5000;

/** How hard each Mode is, for the standout score: NMPZ > No move > Moving. */
export const MODE_DIFFICULTY: Record<GameMode, number> = { moving: 0, nm: 1, nmpz: 2 };

/**
 * The standout score's weights, each in points: what one unit of the signal is
 * worth next to one point of lead.
 *
 * UNDER REVIEW: a first attempt; every weight may be retuned.
 */
export const STANDOUT_WEIGHTS = {
  /** Per point over the next-best of the other three guesses ("nobody else got close"). */
  lead: 1,
  /** Per other guess in another country ("nobody even thought of it"). */
  otherCountry: 500,
  /** Per second sooner than the next guess, for a pressed guess. */
  secondSooner: 20,
  /** Per level of Mode difficulty (MODE_DIFFICULTY). */
  modeLevel: 300,
  /** Per point the other three averaged below a perfect 5,000. */
  othersLowPoint: 0.2,
} as const;

/** The signals the standout score adds up. */
export interface StandoutSignals {
  /** Points over the next-best of the other guesses. */
  lead: number;
  /** How many of the other guesses were in another country (or the water). */
  othersInOtherCountry: number;
  /** Seconds sooner than the next guess in time; 0 for a timed-out guess or one that wasn't first. */
  secondsSooner: number;
  mode: GameMode | null;
  /** The other guesses' average score. */
  othersAvgScore: number;
}

export function standoutScore(s: StandoutSignals): number {
  const w = STANDOUT_WEIGHTS;
  return (
    s.lead * w.lead +
    s.othersInOtherCountry * w.otherCountry +
    s.secondsSooner * w.secondSooner +
    (s.mode ? MODE_DIFFICULTY[s.mode] : 0) * w.modeLevel +
    (MAX_SCORE - s.othersAvgScore) * w.othersLowPoint
  );
}

export interface BestGuess extends StandoutSignals {
  roundId: string;
  gameId: string;
  /** The Round's country and Region. */
  countryCode: string | null;
  regionCode: string | null;
  score: number;
  distanceMeters: number;
  standout: number;
}

/** The signals for `guess` when it was the closest of all the Round's guesses; null otherwise. */
function candidate(round: StatsRound, guess: StatsGuess, mode: GameMode | null): BestGuess | null {
  if (!isPlaced(guess) || guess.distanceMeters === null) return null;
  const others = round.guesses.filter((g) => g !== guess && isPlaced(g));
  if (others.length === 0) return null;
  const closest = others.every((g) => g.distanceMeters !== null && g.distanceMeters > guess.distanceMeters!);
  if (!closest) return null;

  const actual = mistakeCountryCode(round.countryCode, round.regionCode);
  const otherTimes = others.flatMap((g) => (g.secondsToGuess === null ? [] : [g.secondsToGuess]));
  const nextTime = otherTimes.length ? Math.min(...otherTimes) : null;
  const signals: StandoutSignals = {
    lead: guess.score - Math.max(...others.map((g) => g.score)),
    othersInOtherCountry: others.filter(
      (g) => mistakeCountryCode(g.countryCode, g.regionCode) !== actual,
    ).length,
    secondsSooner:
      guess.timedOut || guess.secondsToGuess === null || nextTime === null
        ? 0
        : Math.max(0, nextTime - guess.secondsToGuess),
    mode,
    othersAvgScore: mean(others.map((g) => g.score))!,
  };
  return {
    roundId: round.id,
    gameId: round.gameId,
    countryCode: round.countryCode,
    regionCode: round.regionCode,
    score: guess.score,
    distanceMeters: guess.distanceMeters,
    ...signals,
    standout: standoutScore(signals),
  };
}

/**
 * The Player's top guesses by standout score, over the filtered Rounds. A guess
 * qualifies when it was the closest of all four (strictly: a tie doesn't count).
 */
export function bestGuesses(
  filtered: FilteredStats,
  playerId: string,
  limit = BEST_GUESSES_PER_PLAYER,
): BestGuess[] {
  const modeOf = new Map(filtered.games.map((g) => [g.id, g.mode]));
  return filtered.rounds
    .flatMap((r) => {
      const guess = r.guesses.find((g) => g.isDuo && g.playerId === playerId);
      const row = guess ? candidate(r, guess, modeOf.get(r.gameId) ?? null) : null;
      return row ? [row] : [];
    })
    .sort((a, b) => b.standout - a.standout || a.roundId.localeCompare(b.roundId))
    .slice(0, limit);
}
