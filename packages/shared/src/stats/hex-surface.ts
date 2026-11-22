import { greatCircleMeters } from "./hedge.js";
import { roundMeasure, type AreaMeasure } from "./map-areas.js";
import type { StatsRound } from "./payload.js";

/**
 * The parts of h3-js the hex surface uses. The caller passes the module in, so the
 * shared package (and every page that imports it) doesn't bundle H3; the map view
 * loads it lazily.
 */
export interface HexGrid {
  latLngToCell(lat: number, lng: number, res: number): string;
  cellToLatLng(cell: string): [number, number] | number[];
  gridDisk(cell: string, k: number): string[];
  cellToBoundary(cell: string, formatAsGeoJson: boolean): ([number, number] | number[])[];
  getHexagonEdgeLengthAvg(res: number, unit: string): number;
}

/** How far a Round's value spreads: wide on the globe, tighter when zoomed in or focused. */
export const AREA_RADIUS_KM = { world: 400, focused: 250 } as const;

/** The H3 resolution matching each radius (average hexagon edge ~158 km and ~60 km). */
export const AREA_RESOLUTION = { world: 2, focused: 3 } as const;

/** Hexagons with less total weight than this (under about one nearby Round) aren't drawn. */
export const MIN_HEX_WEIGHT = 0.35;

/** A weight falls to this share of 1 at the edge of the radius, not to 0. */
const RADIUS_SLACK = 1.15;

export interface HexCell {
  cell: string;
  /** The distance-weighted mean of the measure over the Rounds that reach the hexagon. */
  value: number;
  /** The total distance weight behind `value`: how much data backs it. */
  weight: number;
  /** Rounds whose answer is inside the hexagon. */
  rounds: number;
  /** The closed boundary, GeoJSON order ([lng, lat]). */
  ring: [number, number][];
}

/**
 * A smoothed surface of a measure over the Rounds' answers. Each Round spreads its
 * value to the H3 hexagons whose centre is within `radiusKm` of its answer, weighted
 * by distance; a hexagon shows the weighted mean, so it tells roughly how the Duo does
 * in that part of a country rather than in one exact Region. Hexagons crossing the
 * antimeridian are skipped (they'd wrap round the globe).
 */
export function hexSurface(
  grid: HexGrid,
  rounds: readonly StatsRound[],
  measure: AreaMeasure,
  options: { resolution: number; radiusKm: number },
): HexCell[] {
  const { resolution, radiusKm } = options;
  const edgeKm = grid.getHexagonEdgeLengthAvg(resolution, "km");
  // Neighbouring centres are ~√3 edges apart; 1.5 keeps a margin so the disk covers the radius.
  const k = Math.max(1, Math.ceil(radiusKm / (edgeKm * 1.5)));
  const acc = new Map<string, { weight: number; sum: number; rounds: number }>();

  for (const round of rounds) {
    if (round.lat === null || round.lng === null) continue;
    const value = roundMeasure(round, measure);
    if (value === null) continue;
    const answer = { lat: round.lat, lng: round.lng };
    const origin = grid.latLngToCell(round.lat, round.lng, resolution);
    for (const cell of grid.gridDisk(origin, k)) {
      const [lat, lng] = grid.cellToLatLng(cell) as [number, number];
      const km = greatCircleMeters(answer, { lat, lng }) / 1000;
      if (km > radiusKm) continue;
      const w = 1 - km / (radiusKm * RADIUS_SLACK);
      const a = acc.get(cell) ?? { weight: 0, sum: 0, rounds: 0 };
      a.weight += w;
      a.sum += w * value;
      if (cell === origin) a.rounds += 1;
      acc.set(cell, a);
    }
  }

  const cells: HexCell[] = [];
  for (const [cell, a] of acc) {
    if (a.weight < MIN_HEX_WEIGHT) continue;
    const ring = grid.cellToBoundary(cell, true) as [number, number][];
    const lngs = ring.map(([lng]) => lng);
    if (Math.max(...lngs) - Math.min(...lngs) > 180) continue;
    const [first] = ring;
    const last = ring.at(-1);
    const isClosed = first && last && first[0] === last[0] && first[1] === last[1];
    cells.push({
      cell,
      value: a.sum / a.weight,
      weight: a.weight,
      rounds: a.rounds,
      ring: isClosed || !first ? ring : [...ring, first],
    });
  }
  return cells;
}

/** A hexagon's opacity: faint at MIN_HEX_WEIGHT, strong from 3 Rounds' worth of weight. */
export function hexOpacity(weight: number): number {
  const [w0, o0, w1, o1] = [MIN_HEX_WEIGHT, 0.3, 3, 0.85];
  const t = Math.min(1, Math.max(0, (weight - w0) / (w1 - w0)));
  return o0 + t * (o1 - o0);
}
