import type { DerivedGuess } from "@geo-coach/shared";

type PlacedGuess = Pick<DerivedGuess, "countryCode" | "lat" | "lng">;

/** Where a guess landed: its country code, "water" when it hit no country, or "?" without a pin. */
export function guessedCountryLabel(guess: PlacedGuess): string {
  if (guess.countryCode) return guess.countryCode;
  return guess.lat !== null && guess.lng !== null ? "water" : "?";
}

/**
 * Whether the Duo's best guess missed the Round's country. A guess in the water
 * is a miss; a guess without a pin, or a Round without a country, is not judged.
 */
export function isWrongCountry(
  roundCountryCode: string | null,
  bestDuoGuess: PlacedGuess | null,
): boolean {
  if (!roundCountryCode || !bestDuoGuess) return false;
  if (bestDuoGuess.lat === null || bestDuoGuess.lng === null) return false;
  return bestDuoGuess.countryCode !== roundCountryCode;
}
