import { mistakeCountryCode } from "../overseas-regions.js";
import type { FilteredStats } from "./filter.js";
import { groupBy, mean, median } from "./math.js";
import type { StatsLearning, StatsRound } from "./payload.js";
import { DEFAULT_RANKING_METHOD, type RankingMethod } from "./ranking-method.js";
import {
  bestDuoGuess,
  damageTaken,
  isPlaced,
  isSlow,
  isSplit,
  mistakeClass,
  scoreGap,
} from "./rounds.js";

/** Rounds of one country before or after its first Learning. */
export interface LearningSide {
  rounds: number;
  avgScore: number | null;
}

/**
 * One country in the Rankings table, over the filtered Rounds. Adjusted numbers
 * go through the ranking method (pulled toward the Duo's mean); `raw*` are plain
 * averages.
 */
export interface CountryRow {
  /** GeoGuessr's country for the Rounds, as the page filter uses it. */
  countryCode: string;
  rounds: number;
  /** The rank: score gap against the Opponents per Round (Duo best − Opponents' best), adjusted. */
  gap: number;
  rawGap: number;
  /** The Duo's best score per Round, adjusted. Favours small countries. */
  avgScore: number;
  rawAvgScore: number;
  /** Damage dealt minus Damage taken per Round, adjusted. */
  netDamage: number;
  rawNetDamage: number;
  /** Median distance of the Duo's best guess, in km; null when none is known. */
  medianKm: number | null;
  /** Rounds per mistake class of the Duo's best guess (close is the rest). */
  wrongCountry: number;
  far: number;
  /** Rounds whose best guess was slow, by the Duo's fixed threshold. */
  slow: number;
  splits: number;
  /** Splits where one of the Duo's guesses was in the right country. */
  splitsCaught: number;
  /** The Duo's Learnings that name the country (not narrowed by the filter). */
  learnings: number;
  firstLearningAtMs: number | null;
  /** Rounds before and after the first Learning; both empty without one. */
  beforeLearning: LearningSide;
  afterLearning: LearningSide;
  /** Per Player id: the share of the country's Rounds where their guess was the Duo's best. */
  bestGuessShare: Record<string, number>;
}

export interface CountryRowOptions {
  learnings: readonly StatsLearning[];
  /** From `slowThreshold` over all the Duo's Rounds, so the filter never moves it. */
  slowThresholdSeconds: number | null;
  /** How numbers are pulled toward the Duo's mean; DEFAULT_RANKING_METHOD unless swapped. */
  method?: RankingMethod;
}

function splitCaught(round: StatsRound): boolean {
  const actual = mistakeCountryCode(round.countryCode, round.regionCode);
  return round.guesses.some(
    (g) => g.isDuo && isPlaced(g) && mistakeCountryCode(g.countryCode, g.regionCode) === actual,
  );
}

function learningSide(rounds: readonly StatsRound[]): LearningSide {
  return { rounds: rounds.length, avgScore: mean(rounds.map((r) => r.duoBestScore)) };
}

/**
 * One row per country in the filtered Rounds, worst gap first. Each adjusted
 * number is pulled toward the Duo's mean over the same filtered Rounds.
 */
export function countryRows(filtered: FilteredStats, options: CountryRowOptions): CountryRow[] {
  const method = options.method ?? DEFAULT_RANKING_METHOD;
  const rounds = filtered.rounds.filter((r) => r.countryCode !== null);
  const duoGap = mean(rounds.map(scoreGap)) ?? 0;
  const duoScore = mean(rounds.map((r) => r.duoBestScore)) ?? 0;
  const duoNetDamage = mean(rounds.map((r) => r.hpDelta)) ?? 0;

  const rows = [...groupBy(rounds, (r) => r.countryCode!)].map(([countryCode, rs]): CountryRow => {
    const gaps = rs.map(scoreGap);
    const scores = rs.map((r) => r.duoBestScore);
    const net = rs.map((r) => r.hpDelta);
    const classes = rs.map(mistakeClass);
    const splits = rs.filter(isSplit);
    const learnings = options.learnings.filter((l) => l.countryCodes.includes(countryCode));
    const firstLearningAtMs = learnings.length
      ? Math.min(...learnings.map((l) => l.createdAtMs))
      : null;
    const bestGuessShare: Record<string, number> = {};
    for (const [playerId, best] of groupBy(rs, (r) => bestDuoGuess(r)?.playerId ?? null)) {
      if (playerId) bestGuessShare[playerId] = best.length / rs.length;
    }
    const km = rs.flatMap((r) => {
      const meters = bestDuoGuess(r)?.distanceMeters;
      return meters === null || meters === undefined ? [] : [meters / 1000];
    });
    return {
      countryCode,
      rounds: rs.length,
      gap: method(gaps, duoGap),
      rawGap: mean(gaps)!,
      avgScore: method(scores, duoScore),
      rawAvgScore: mean(scores)!,
      netDamage: method(net, duoNetDamage),
      rawNetDamage: mean(net)!,
      medianKm: median(km),
      wrongCountry: classes.filter((c) => c === "wrong-country").length,
      far: classes.filter((c) => c === "far").length,
      slow: rs.filter((r) => isSlow(r, options.slowThresholdSeconds)).length,
      splits: splits.length,
      splitsCaught: splits.filter(splitCaught).length,
      learnings: learnings.length,
      firstLearningAtMs,
      beforeLearning: learningSide(
        firstLearningAtMs === null ? [] : rs.filter((r) => r.startedAtMs < firstLearningAtMs),
      ),
      afterLearning: learningSide(
        firstLearningAtMs === null ? [] : rs.filter((r) => r.startedAtMs >= firstLearningAtMs),
      ),
      bestGuessShare,
    };
  });
  return rows.sort((a, b) => a.gap - b.gap || a.countryCode.localeCompare(b.countryCode));
}

/** True when a row has too few Rounds to trust: shown greyed and sorted last. */
export function isGreyedOut(row: CountryRow, greyOutRounds: number): boolean {
  return row.rounds < greyOutRounds;
}

/** A sortable column's value; null sorts last in either direction. */
export type CountryRowValue = (row: CountryRow) => number | string | null;

/**
 * Sorts by one column. Rows below the grey-out threshold always come after the
 * rest, whatever the column or direction; ties fall back to the gap, worst first.
 */
export function sortCountryRows(
  rows: readonly CountryRow[],
  value: CountryRowValue,
  direction: "asc" | "desc",
  greyOutRounds: number,
): CountryRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const compareValues = (a: number | string | null, b: number | string | null): number => {
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const order = typeof a === "string" || typeof b === "string"
      ? String(a).localeCompare(String(b))
      : a - b;
    return order * sign;
  };
  return [...rows].sort(
    (a, b) =>
      Number(isGreyedOut(a, greyOutRounds)) - Number(isGreyedOut(b, greyOutRounds)) ||
      compareValues(value(a), value(b)) ||
      a.gap - b.gap ||
      a.countryCode.localeCompare(b.countryCode),
  );
}

/**
 * The "which countries cost us, and which carry us?" bars: the best and worst
 * `n` countries at or above the threshold by adjusted gap, best first.
 */
export function gapChartRows(
  rows: readonly CountryRow[],
  greyOutRounds: number,
  n = 8,
): CountryRow[] {
  const ranked = rows
    .filter((r) => !isGreyedOut(r, greyOutRounds))
    .sort((a, b) => b.gap - a.gap);
  if (ranked.length <= 2 * n) return ranked;
  return [...ranked.slice(0, n), ...ranked.slice(-n)];
}

/** Far guesses in one country: the Round's Region → the Region the best guess landed in. */
export interface FarGuessRegion {
  actual: string | null;
  guessed: string | null;
  count: number;
  /** Damage taken on those Rounds, overkill counted. */
  damage: number;
}

/** Groups the Rounds whose mistake class is `far` by actual → guessed Region, most frequent first. */
export function farGuessRegions(rounds: readonly StatsRound[]): FarGuessRegion[] {
  const acc = new Map<string, FarGuessRegion>();
  for (const r of rounds) {
    if (mistakeClass(r) !== "far") continue;
    const guessed = bestDuoGuess(r)?.regionCode ?? null;
    const key = `${r.regionCode ?? ""}>${guessed ?? ""}`;
    const entry = acc.get(key) ?? { actual: r.regionCode, guessed, count: 0, damage: 0 };
    entry.count += 1;
    entry.damage += damageTaken(r);
    acc.set(key, entry);
  }
  return [...acc.values()].sort((a, b) => b.count - a.count || b.damage - a.damage);
}
