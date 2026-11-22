// The Versus Opponents section of the statistics page (#43): the Duo's best
// guess against the Opponents' best guess, by country and over time. Each team's
// best guess is the one that scored, so a Split's hedge never counts.

import { groupBy, mean, median } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";
import { bestDuoGuess, inRoundOrder, isPlaced, opponentBestGuess } from "./rounds.js";
import { rollingWindows } from "./smoothing.js";

const kmOff = (g: StatsGuess | null): number | null =>
  g && isPlaced(g) && g.distanceMeters !== null ? g.distanceMeters / 1000 : null;

/**
 * True when the Duo's best guess was closer than the Opponents' best, false when
 * it was further; null when either team placed no guess, or both were exactly as
 * far (no one was closer).
 */
export function duoCloser(round: StatsRound): boolean | null {
  const duo = kmOff(bestDuoGuess(round));
  const opponents = kmOff(opponentBestGuess(round));
  if (duo === null || opponents === null || duo === opponents) return null;
  return duo < opponents;
}

/** The Duo's and the Opponents' best guesses side by side, over some Rounds. */
export interface VersusNumbers {
  rounds: number;
  avgDuoScore: number | null;
  avgOpponentScore: number | null;
  /** Median km off of each team's best guess. */
  duoMedianKm: number | null;
  opponentsMedianKm: number | null;
  /** Rounds where one best guess was closer than the other … */
  compared: number;
  /** … and the share of those where it was the Duo's. */
  closerShare: number | null;
}

export function versusNumbers(rounds: readonly StatsRound[]): VersusNumbers {
  const km = (pick: (r: StatsRound) => StatsGuess | null) =>
    median(rounds.flatMap((r) => {
      const v = kmOff(pick(r));
      return v === null ? [] : [v];
    }));
  const closer = rounds.map(duoCloser).filter((c): c is boolean => c !== null);
  return {
    rounds: rounds.length,
    avgDuoScore: mean(rounds.map((r) => r.duoBestScore)),
    avgOpponentScore: mean(rounds.map((r) => r.opponentBestScore)),
    duoMedianKm: km(bestDuoGuess),
    opponentsMedianKm: km(opponentBestGuess),
    compared: closer.length,
    closerShare: closer.length ? closer.filter(Boolean).length / closer.length : null,
  };
}

export interface CountryVersusRow extends VersusNumbers {
  countryCode: string;
}

/** One row per country (GeoGuessr's), most-played first. */
export function countryVersusRows(rounds: readonly StatsRound[]): CountryVersusRow[] {
  return [...groupBy(rounds.filter((r) => r.countryCode !== null), (r) => r.countryCode!)]
    .map(([countryCode, rs]) => ({ countryCode, ...versusNumbers(rs) }))
    .sort((a, b) => b.rounds - a.rounds || a.countryCode.localeCompare(b.countryCode));
}

/** One point of the Versus trend: the numbers over a window of Rounds, in play order. */
export interface VersusPoint extends VersusNumbers {
  /** The 1-based position, in Round order, of the window's last Round. */
  roundIndex: number;
}

export function versusSeries(rounds: readonly StatsRound[], window: number): VersusPoint[] {
  return rollingWindows(inRoundOrder(rounds), window).map(({ end, items }) => ({
    roundIndex: end,
    ...versusNumbers(items),
  }));
}
