import { mistakeCountryCode } from "../overseas-regions.js";
import { groupBy, mean } from "./math.js";
import type { StatsRound } from "./payload.js";
import { DEFAULT_RANKING_METHOD } from "./ranking-method.js";
import {
  damageTaken,
  isPlaced,
  mistakeClass,
  opponentBestGuess,
  scoreGap,
  type MistakeClass,
} from "./rounds.js";

// What the map view colours places by: per-Round measures, the summary a hover card
// or a drawn area shows, and per-country (or per-Region) fills.

/**
 * How a Round dot or answer pin is coloured: "won" for a Round the Duo didn't lose,
 * else the lost Round's mistake class.
 */
export type MapRoundClass = MistakeClass | "won";

export function mapRoundClass(round: StatsRound): MapRoundClass | null {
  return round.hpDelta >= 0 ? "won" : mistakeClass(round);
}

/**
 * What the Areas, Countries and Regions overlays colour by:
 * - `gap`: the Duo's best score minus the Opponents' best, per Round;
 * - `damage`: Damage taken per Round (0 for a Round the Duo didn't lose);
 * - `wrong-country`: the share of Rounds whose best guess was in the wrong country.
 */
export type AreaMeasure = "gap" | "damage" | "wrong-country";

export const AREA_MEASURES: readonly AreaMeasure[] = ["gap", "damage", "wrong-country"];

/** One Round's value for a measure; null when it has none (no best guess for wrong-country). */
export function roundMeasure(round: StatsRound, measure: AreaMeasure): number | null {
  if (measure === "gap") return scoreGap(round);
  if (measure === "damage") return damageTaken(round);
  const cls = mistakeClass(round);
  return cls === null ? null : cls === "wrong-country" ? 1 : 0;
}

/** The summary of a set of Rounds shown in a hover card, the focus bar or an area drawer. */
export interface AreaStats {
  rounds: number;
  avgScore: number;
  /** Mean score gap vs the Opponents per Round. */
  gap: number;
  damagePerRound: number;
  /** Over Rounds where the Duo placed a best guess. */
  wrongCountryRate: number | null;
  /** Over Rounds where the Opponents placed a best guess. */
  opponentWrongCountryRate: number | null;
}

function opponentWrongCountry(round: StatsRound): number | null {
  const guess = opponentBestGuess(round);
  if (!guess || !isPlaced(guess) || !round.countryCode) return null;
  const actual = mistakeCountryCode(round.countryCode, round.regionCode);
  return mistakeCountryCode(guess.countryCode, guess.regionCode) === actual ? 0 : 1;
}

function meanOf(rounds: readonly StatsRound[], value: (r: StatsRound) => number | null) {
  return mean(rounds.flatMap((r) => value(r) ?? []));
}

export function areaStats(rounds: readonly StatsRound[]): AreaStats | null {
  if (rounds.length === 0) return null;
  return {
    rounds: rounds.length,
    avgScore: meanOf(rounds, (r) => r.duoBestScore)!,
    gap: meanOf(rounds, scoreGap)!,
    damagePerRound: meanOf(rounds, damageTaken)!,
    wrongCountryRate: meanOf(rounds, (r) => roundMeasure(r, "wrong-country")),
    opponentWrongCountryRate: meanOf(rounds, opponentWrongCountry),
  };
}

/**
 * A measure per key (a country or Region code), pulled toward the Duo's mean over
 * all `rounds` with the default ranking method, so a place with few Rounds isn't
 * coloured on luck. Rounds without a key or a value are skipped.
 */
export function shrunkMeasureBy(
  rounds: readonly StatsRound[],
  measure: AreaMeasure,
  key: (round: StatsRound) => string | null,
): Map<string, number> {
  const valued = rounds.flatMap((r) => {
    const value = roundMeasure(r, measure);
    const k = key(r);
    return value === null || k === null ? [] : [{ k, value }];
  });
  const duoMean = mean(valued.map((v) => v.value)) ?? 0;
  const out = new Map<string, number>();
  for (const [k, group] of groupBy(valued, (v) => v.k)) {
    out.set(k, DEFAULT_RANKING_METHOD(group.map((v) => v.value), duoMean));
  }
  return out;
}
