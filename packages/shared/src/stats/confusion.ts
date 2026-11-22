import { mistakeCountryCode } from "../overseas-regions.js";
import type { HedgeGuess } from "./hedge.js";
import { damageTaken } from "./rounds.js";

/** What a confusion pair needs from a Round; a Stats or Workbench Round fits. */
export interface ConfusionRound {
  countryCode: string | null;
  regionCode: string | null;
  /** The Round's Damage from the Duo's side: negative when taken. */
  hpDelta: number;
  guesses: readonly (HedgeGuess & { isDuo: boolean; isBestForTeam: boolean })[];
}

/** The country a place counts as when pairs are formed; null for the water. */
export type CountryOf = (countryCode: string | null, regionCode: string | null) => string | null;

/**
 * Plain country codes, overseas Regions not split off: the Workbench's rule.
 * `/stats` uses the default, `mistakeCountryCode`, to match the mistake class.
 */
export const PLAIN_COUNTRY: CountryOf = (countryCode) => countryCode;

/** Directed: the Round's country → where the Duo's best guess landed instead. */
export interface ConfusionPair {
  actual: string;
  /** Null for a best guess in the water. */
  guessed: string | null;
  count: number;
  /** Damage taken on those Rounds, overkill counted. */
  damage: number;
}

/**
 * Directed confusion pairs from the Duo's best guess on wrong-country Rounds,
 * most frequent first. France → Belgium and Belgium → France stay apart. With the
 * default `countryOf`, a Round counts exactly when its mistake class is
 * `wrong-country`, and an overseas Region is its own country (`FR-GUF`).
 */
export function confusionPairs(
  rounds: readonly ConfusionRound[],
  countryOf: CountryOf = mistakeCountryCode,
): ConfusionPair[] {
  const acc = new Map<string, ConfusionPair>();
  for (const round of rounds) {
    const best = round.guesses.find((g) => g.isDuo && g.isBestForTeam);
    if (!best || best.lat === null || best.lng === null || !round.countryCode) continue;
    const actual = countryOf(round.countryCode, round.regionCode);
    const guessed = countryOf(best.countryCode, best.regionCode);
    if (actual === null || guessed === actual) continue;
    const key = `${actual}>${guessed ?? ""}`;
    const pair = acc.get(key) ?? { actual, guessed, count: 0, damage: 0 };
    pair.count += 1;
    pair.damage += damageTaken(round);
    acc.set(key, pair);
  }
  return [...acc.values()].sort((a, b) => b.count - a.count || b.damage - a.damage);
}

/** An order-free pair of land countries, codes in alphabetical order. */
export interface UndirectedConfusionPair {
  countries: [string, string];
  count: number;
  damage: number;
}

/** Adds up both directions of each pair, dropping the water: the Workbench's view. */
export function undirectedConfusionPairs(
  pairs: readonly ConfusionPair[],
): UndirectedConfusionPair[] {
  const acc = new Map<string, UndirectedConfusionPair>();
  for (const p of pairs) {
    if (p.guessed === null) continue;
    const countries = [p.actual, p.guessed].sort() as [string, string];
    const key = countries.join(":");
    const pair = acc.get(key) ?? { countries, count: 0, damage: 0 };
    pair.count += p.count;
    pair.damage += p.damage;
    acc.set(key, pair);
  }
  return [...acc.values()].sort((a, b) => b.count - a.count || b.damage - a.damage);
}
