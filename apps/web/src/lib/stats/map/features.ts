import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import {
  bestDuoGuess,
  hexOpacity,
  isPlaced,
  mapRoundClass,
  type HexCell,
  type StatsGuess,
  type StatsPlayer,
} from "@geo-coach/shared";
import type { PlacedGuess, PlacedRound } from "./geo.js";

// GeoJSON for the Map view's layers, built from the filtered Rounds.

export type ShowMode = "answers" | "guesses" | "both";
/** Whose guesses: the Duo's best, both of the Duo's, or those plus the Opponents'. */
export type GuessWho = "best" | "duo" | "all";

const collection = <T extends Feature>(features: T[]): FeatureCollection<T["geometry"], T["properties"]> =>
  ({ type: "FeatureCollection", features }) as FeatureCollection<T["geometry"], T["properties"]>;

export const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** A Round's class as a layer property: "none" when it has none. */
const classProp = (round: PlacedRound) => mapRoundClass(round) ?? "none";

/** World-view dots: one per Round at its answer, coloured by class. */
export function roundDots(rounds: readonly PlacedRound[]): FeatureCollection<Point> {
  return collection(
    rounds.map(
      (r): Feature<Point> => ({
        type: "Feature",
        properties: { roundId: r.id, cls: classProp(r) },
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      }),
    ),
  );
}

export function formatKm(meters: number | null): string {
  if (meters === null) return "–";
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("en-US")} km`;
}

/** The image id of a guess's avatar: the Player's initial, or "O" for the Opponents. */
export function avatarIcon(guess: StatsGuess, players: readonly StatsPlayer[]): string {
  if (!guess.isDuo) return "av-opp";
  const index = players.findIndex((p) => p.id === guess.playerId);
  return index === -1 ? "av-unknown" : `av-${index}`;
}

export function guessesOf(round: PlacedRound, who: GuessWho): PlacedGuess[] {
  const guesses =
    who === "best"
      ? [bestDuoGuess(round)].filter((g): g is StatsGuess => g !== null)
      : round.guesses.filter((g) => who === "all" || g.isDuo);
  return guesses.filter((g): g is PlacedGuess => isPlaced(g));
}

export interface RoundLayers {
  pins: FeatureCollection<Point>;
  marks: FeatureCollection<Point>;
  lines: FeatureCollection<LineString>;
  labels: FeatureCollection<Point>;
}

/**
 * Answer pins, guess avatars, and dashed lines with km labels joining them. "Both"
 * draws the lines; Answers or Guesses alone don't.
 */
export function roundLayers(
  rounds: readonly PlacedRound[],
  options: { show: ShowMode; who: GuessWho },
  players: readonly StatsPlayer[],
): RoundLayers {
  const { show, who } = options;
  const pins: Feature<Point>[] = [];
  const marks: Feature<Point>[] = [];
  const lines: Feature<LineString>[] = [];
  const labels: Feature<Point>[] = [];
  for (const r of rounds) {
    const answer: [number, number] = [r.lng, r.lat];
    if (show !== "guesses") {
      pins.push({
        type: "Feature",
        properties: { roundId: r.id, cls: classProp(r), num: `R${r.roundNumber}` },
        geometry: { type: "Point", coordinates: answer },
      });
    }
    if (show === "answers") continue;
    for (const g of guessesOf(r, who)) {
      const at: [number, number] = [g.lng, g.lat];
      marks.push({
        type: "Feature",
        properties: { roundId: r.id, icon: avatarIcon(g, players) },
        geometry: { type: "Point", coordinates: at },
      });
      if (show !== "both") continue;
      lines.push({
        type: "Feature",
        properties: { roundId: r.id, isDuo: g.isDuo },
        geometry: { type: "LineString", coordinates: [answer, at] },
      });
      labels.push({
        type: "Feature",
        properties: { roundId: r.id, text: formatKm(g.distanceMeters) },
        geometry: { type: "Point", coordinates: [(answer[0] + at[0]) / 2, (answer[1] + at[1]) / 2] },
      });
    }
  }
  return { pins: collection(pins), marks: collection(marks), lines: collection(lines), labels: collection(labels) };
}

/** The hex surface as fill polygons with their value and opacity. */
export function hexFeatures(cells: readonly HexCell[]): FeatureCollection<Polygon> {
  return collection(
    cells.map(
      (c): Feature<Polygon> => ({
        type: "Feature",
        properties: { value: c.value, opacity: hexOpacity(c.weight), rounds: c.rounds },
        geometry: { type: "Polygon", coordinates: [c.ring] },
      }),
    ),
  );
}
