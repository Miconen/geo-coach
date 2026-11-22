/**
 * How one team placed its guesses in a Round (GLOSSARY: Committed, Spread, Split).
 * The same rules apply to the Duo and to the Opponents.
 */
export type HedgeKind = "committed" | "spread" | "split";

/**
 * What the hedge rules need from a guess. Any guess shape with these fields fits,
 * such as a derived guess (country and Region from the geocoder, ADR 0004).
 */
export interface HedgeGuess {
  lat: number | null;
  lng: number | null;
  /** Where the guess landed; null for water or a missing pin. */
  countryCode: string | null;
  regionCode: string | null;
}

export interface HedgeRound {
  /** The Round's true country, used to normalise a Split's spread. */
  countryCode: string | null;
}

/** A country's size in metres (√area), or null when unknown. Supplied by the caller. */
export type CountrySizeLookup = (countryCode: string) => number | null;

export interface Hedge {
  /** Null when unclassified: fewer than two placed guesses, or a country or Region missing. */
  kind: HedgeKind | null;
  /** Great-circle distance between the placed guesses (the widest pair); null with fewer than two. */
  distanceMeters: number | null;
  /**
   * `distanceMeters` ÷ the country's size: the guesses' shared country, or the
   * Round's country for a Split. Null without a size lookup or a known size.
   * Shown in tooltips only; it never decides the kind.
   */
  spread: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in metres. */
export function greatCircleMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type PlacedGuess = HedgeGuess & { lat: number; lng: number };

function placedGuesses(guesses: readonly HedgeGuess[]): PlacedGuess[] {
  return guesses.filter((g): g is PlacedGuess => g.lat !== null && g.lng !== null);
}

/**
 * The hedge kind of one team's guesses in a Round. Pass only that team's guesses
 * (the Duo's, or the Opponents'). Unplaced guesses are ignored.
 */
export function hedgeKind(teamGuesses: readonly HedgeGuess[]): HedgeKind | null {
  const placed = placedGuesses(teamGuesses);
  if (placed.length < 2) return null;
  if (placed.some((g) => g.countryCode === null)) return null;
  if (new Set(placed.map((g) => g.countryCode)).size > 1) return "split";
  if (placed.some((g) => g.regionCode === null)) return null;
  return new Set(placed.map((g) => g.regionCode)).size === 1 ? "committed" : "spread";
}

/** The widest distance between any two placed guesses, or null with fewer than two. */
export function guessDistanceMeters(teamGuesses: readonly HedgeGuess[]): number | null {
  const placed = placedGuesses(teamGuesses);
  if (placed.length < 2) return null;
  let widest = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      widest = Math.max(widest, greatCircleMeters(placed[i]!, placed[j]!));
    }
  }
  return widest;
}

/**
 * Classifies one team's guesses in a Round and measures how far apart they are.
 * `countrySize` is the seam for normalising by country size; without it,
 * `spread` stays null.
 */
export function roundHedge(
  round: HedgeRound,
  teamGuesses: readonly HedgeGuess[],
  countrySize?: CountrySizeLookup,
): Hedge {
  const kind = hedgeKind(teamGuesses);
  const distanceMeters = guessDistanceMeters(teamGuesses);
  let spread: number | null = null;
  if (kind !== null && distanceMeters !== null && countrySize) {
    const country = kind === "split" ? round.countryCode : placedGuesses(teamGuesses)[0]!.countryCode;
    const size = country ? countrySize(country) : null;
    if (size !== null && size > 0) spread = distanceMeters / size;
  }
  return { kind, distanceMeters, spread };
}

/** Whether a Round's hedge kind is one a Call can be read for (a Split or Spread). */
export function isCallableHedge(kind: HedgeKind | null): kind is "split" | "spread" {
  return kind === "split" || kind === "spread";
}
