import { countrySizeKm } from "../country-sizes.js";
import { mistakeCountryCode } from "../overseas-regions.js";
import { hedgeKind } from "./hedge.js";
import { quantile } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";

/** The Duo's guess that counted (its best score), or null when the Duo didn't guess. */
export function bestDuoGuess(round: StatsRound): StatsGuess | null {
  return round.guesses.find((g) => g.isDuo && g.isBestForTeam) ?? null;
}

/** A guess with a pin on the map (a missing pin has no coordinates). */
export function isPlaced(guess: StatsGuess): boolean {
  return guess.lat !== null && guess.lng !== null;
}

/** Damage (GLOSSARY) the Duo dealt in the Round, overkill counted; 0 when it took Damage. */
export function damageDealt(round: StatsRound): number {
  return Math.max(0, round.hpDelta);
}

/** Damage (GLOSSARY) the Duo took in the Round, overkill counted; 0 when it dealt Damage. */
export function damageTaken(round: StatsRound): number {
  return Math.max(0, -round.hpDelta);
}

/** The Duo's best score minus the Opponents' best, before the multiplier. */
export function scoreGap(round: StatsRound): number {
  return round.duoBestScore - round.opponentBestScore;
}

/**
 * A right-country best guess is `close` within this share of the country's size
 * (√area). Meant to be retuned.
 */
export const CLOSE_SHARE_OF_COUNTRY_SIZE = 0.5;

/**
 * A right-country best guess this near is always `close`: in a country as small
 * as Andorra (about 21 km across), half its size would call any miss far.
 */
export const CLOSE_MIN_KM = 25;

/**
 * Why a Round went the way it did, judged on the Duo's best guess only (the
 * other guess may be a Split's hedge):
 * - `wrong-country`: the best guess is in another country, or in the water;
 * - `close`: right country, within the close cutoff of the country's size;
 * - `far`: right country, but further off.
 */
export type MistakeClass = "wrong-country" | "far" | "close";

export const MISTAKE_CLASSES: readonly MistakeClass[] = ["wrong-country", "far", "close"];

/** The size (√area, km) the Round's best guess is judged against, overseas Regions apart. */
function roundCountrySizeKm(round: StatsRound): number | null {
  return countrySizeKm(mistakeCountryCode(round.countryCode, round.regionCode));
}

/** The best guess's distance as a share of the Round's country size, or null if unknown. */
export function bestGuessShareOfCountrySize(round: StatsRound): number | null {
  const guess = bestDuoGuess(round);
  const sizeKm = roundCountrySizeKm(round);
  if (!guess || !isPlaced(guess) || guess.distanceMeters === null || !sizeKm) return null;
  return guess.distanceMeters / 1000 / sizeKm;
}

/**
 * The Round's mistake class, or null when the Duo placed no best guess or the
 * Round has no country. Distance relative to the country's size decides `close`,
 * never points, which favour small countries. An overseas Region counts as its
 * own country (see OVERSEAS_REGIONS).
 */
export function mistakeClass(round: StatsRound): MistakeClass | null {
  const guess = bestDuoGuess(round);
  if (!guess || !isPlaced(guess) || !round.countryCode) return null;
  const actual = mistakeCountryCode(round.countryCode, round.regionCode);
  const guessed = mistakeCountryCode(guess.countryCode, guess.regionCode);
  if (guessed === null || guessed !== actual) return "wrong-country";
  const sizeKm = roundCountrySizeKm(round);
  if (guess.distanceMeters === null || !sizeKm) return null;
  const km = guess.distanceMeters / 1000;
  return km <= Math.max(CLOSE_MIN_KM, sizeKm * CLOSE_SHARE_OF_COUNTRY_SIZE) ? "close" : "far";
}

/**
 * A Split (GLOSSARY): the Duo's placed guesses land in two or more countries.
 * The same rule as `hedgeKind(...) === "split"`, for the Duo's guesses.
 */
export function isSplit(round: StatsRound): boolean {
  return hedgeKind(round.guesses.filter((g) => g.isDuo)) === "split";
}

/** The percentile of the Duo's time to guess above which a best guess is slow. */
export const SLOW_PERCENTILE = 0.75;

/**
 * The Duo's slow threshold in seconds: the 75th percentile of its best guesses'
 * time to guess. Pass all the Duo's Rounds, not the filtered ones, so a filter
 * never moves it.
 */
export function slowThreshold(allRounds: readonly StatsRound[]): number | null {
  const seconds = allRounds.flatMap((r) => {
    const s = bestDuoGuess(r)?.secondsToGuess;
    return s === null || s === undefined ? [] : [s];
  });
  return quantile(seconds, SLOW_PERCENTILE);
}

/** True when the Round's best guess took longer than the threshold from `slowThreshold`. */
export function isSlow(round: StatsRound, thresholdSeconds: number | null): boolean {
  const seconds = bestDuoGuess(round)?.secondsToGuess;
  return (
    thresholdSeconds !== null &&
    seconds !== null &&
    seconds !== undefined &&
    seconds > thresholdSeconds
  );
}
