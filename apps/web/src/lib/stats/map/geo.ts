import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { Polygon, Position } from "geojson";
import {
  bestDuoGuess,
  greatCircleMeters,
  isPlaced,
  type StatsGuess,
  type StatsRound,
} from "@geo-coach/shared";

// Geometry for the Map view: which Rounds and guesses a drawn area holds, and where
// the camera goes when focusing a country, opening a Round or showing a Game.

/** A Round with a known location. */
export type PlacedRound = StatsRound & { lat: number; lng: number };
export type PlacedGuess = StatsGuess & { lat: number; lng: number };

export function isPlacedRound(round: StatsRound): round is PlacedRound {
  return round.lat !== null && round.lng !== null;
}

/** [[west, south], [east, north]], as Mapbox's fitBounds takes it. */
export type Bounds = [[number, number], [number, number]];

export interface AreaHit {
  round: PlacedRound;
  /** The guess inside the area, when listing guesses. */
  guess: PlacedGuess | null;
}

/** Rounds whose answer is inside the area. */
export function answersIn(rounds: readonly PlacedRound[], area: Polygon): AreaHit[] {
  return rounds
    .filter((r) => booleanPointInPolygon([r.lng, r.lat], area))
    .map((round) => ({ round, guess: null }));
}

/** The Duo's guesses inside the area, each with its Round. */
export function duoGuessesIn(rounds: readonly PlacedRound[], area: Polygon): AreaHit[] {
  return rounds.flatMap((round) =>
    round.guesses
      .filter((g): g is PlacedGuess => g.isDuo && isPlaced(g))
      .filter((g) => booleanPointInPolygon([g.lng, g.lat], area))
      .map((guess) => ({ round, guess })),
  );
}

/** Each Round once, in the order first seen. */
export function uniqueRounds(hits: readonly AreaHit[]): PlacedRound[] {
  return [...new Map(hits.map((h) => [h.round.id, h.round])).values()];
}

export function boundsOf(points: readonly Position[]): Bounds | null {
  if (points.length === 0) return null;
  const lngs = points.map((p) => p[0]!);
  const lats = points.map((p) => p[1]!);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/** A best guess further than this from its answer doesn't widen a focused country's frame. */
export const FOCUS_NEARBY_GUESS_KM = 1500;

/**
 * The frame for a focused country: its answers plus the best guesses near them, so a
 * guess on another continent doesn't zoom out to the world.
 */
export function focusBounds(rounds: readonly PlacedRound[]): Bounds | null {
  return boundsOf(
    rounds.flatMap((r) => {
      const points: Position[] = [[r.lng, r.lat]];
      const best = bestDuoGuess(r);
      if (best && isPlaced(best) && greatCircleMeters(r, best as PlacedGuess) / 1000 < FOCUS_NEARBY_GUESS_KM) {
        points.push([best.lng!, best.lat!]);
      }
      return points;
    }),
  );
}

/** The frame for an open Round: its answer and every guess. */
export function roundBounds(round: PlacedRound): Bounds {
  const guesses = round.guesses.filter(isPlaced).map((g) => [g.lng!, g.lat!]);
  return boundsOf([[round.lng, round.lat], ...guesses])!;
}

/** Where to turn the globe to show a whole Game: the middle of its answers, zoomed out to their spread. */
export function gameCamera(rounds: readonly PlacedRound[]): { center: [number, number]; zoom: number } | null {
  if (rounds.length === 0) return null;
  const rad = Math.PI / 180;
  let [x, y, z] = [0, 0, 0];
  for (const { lat, lng } of rounds) {
    x += Math.cos(lat * rad) * Math.cos(lng * rad);
    y += Math.cos(lat * rad) * Math.sin(lng * rad);
    z += Math.sin(lat * rad);
  }
  const center = { lng: Math.atan2(y, x) / rad, lat: Math.atan2(z, Math.hypot(x, y)) / rad };
  // Angular spread from the centre, in degrees of arc (111 km each).
  const spreadDeg = Math.max(...rounds.map((r) => greatCircleMeters(center, r) / 111_195));
  const zoom = spreadDeg > 60 ? 1.2 : spreadDeg > 30 ? 2 : spreadDeg > 12 ? 3 : 4;
  return { center: [center.lng, center.lat], zoom };
}
