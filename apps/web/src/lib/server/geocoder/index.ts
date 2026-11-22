import Flatbush from "flatbush";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { feature } from "topojson-client";
import type { Geocoder, GeocodedPoint } from "@geo-coach/shared";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

/** A guess outside every country snaps to the nearest one within this distance. */
export const WATER_SNAP_KM = 50;

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_KM;

interface CountryProps {
  c: string;
}

interface RegionProps {
  c: string | null;
  k: string | null;
}

export type NaturalEarthTopology = Topology<{
  countries: GeometryCollection<CountryProps>;
  regions: GeometryCollection<RegionProps>;
}>;

interface Part<P> {
  props: P;
  polygon: Polygon;
}

interface Layer<P> {
  parts: Part<P>[];
  index: Flatbush;
}

function buildLayer<P>(features: Feature<Polygon | MultiPolygon | null, P>[]): Layer<P> {
  const parts: Part<P>[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const coordinates of polygons) {
      parts.push({ props: f.properties, polygon: { type: "Polygon", coordinates } });
    }
  }
  const index = new Flatbush(Math.max(1, parts.length));
  for (const part of parts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of part.polygon.coordinates[0] ?? []) {
      if (x! < minX) minX = x!;
      if (y! < minY) minY = y!;
      if (x! > maxX) maxX = x!;
      if (y! > maxY) maxY = y!;
    }
    index.add(minX, minY, maxX, maxY);
  }
  if (parts.length === 0) index.add(0, 0, 0, 0);
  index.finish();
  return { parts, index };
}

function containing<P>(layer: Layer<P>, lng: number, lat: number): Part<P>[] {
  return layer.index
    .search(lng, lat, lng, lat)
    .map((i) => layer.parts[i]!)
    .filter((part) => part && booleanPointInPolygon([lng, lat], part.polygon));
}

/** Distance in km from a point to a segment, on a local equirectangular projection. */
function segmentDistanceKm(lat: number, lng: number, a: Position, b: Position): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const project = (p: Position): [number, number] => {
    let dLng = p[0]! - lng;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    return [dLng * cosLat * KM_PER_DEGREE, (p[1]! - lat) * KM_PER_DEGREE];
  };
  const [ax, ay] = project(a);
  const [bx, by] = project(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function polygonDistanceKm(polygon: Polygon, lat: number, lng: number): number {
  let best = Infinity;
  for (const ring of polygon.coordinates) {
    for (let i = 1; i < ring.length; i++) {
      const d = segmentDistanceKm(lat, lng, ring[i - 1]!, ring[i]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/** The closest part within `maxKm` (by real point-to-polygon distance) that passes `accept`. */
function nearest<P>(
  layer: Layer<P>,
  lng: number,
  lat: number,
  maxKm: number,
  accept: (props: P) => boolean,
): Part<P> | null {
  // Flatbush measures box distance in degrees; a degree of longitude shrinks
  // towards the poles, so widen the search to cover maxKm in every direction.
  const cosLat = Math.max(0.01, Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180));
  const maxDegrees = maxKm / (KM_PER_DEGREE * cosLat);
  const candidates = layer.index.neighbors(lng, lat, Infinity, maxDegrees, (i) =>
    accept(layer.parts[i]!.props),
  );
  let best: Part<P> | null = null;
  let bestKm = maxKm;
  for (const i of candidates) {
    const part = layer.parts[i]!;
    const km = polygonDistanceKm(part.polygon, lat, lng);
    if (km <= bestKm) {
      best = part;
      bestKm = km;
    }
  }
  return best;
}

/**
 * An offline reverse geocoder over Natural Earth 10m boundaries (ADR 0004).
 * Countries come from admin-0 map units; Regions from admin-1, grouped per
 * GLOSSARY "Region". A point in no country snaps to the nearest country within
 * {@link WATER_SNAP_KM}; otherwise it is water (null).
 */
export function createNaturalEarthGeocoder(
  topology: NaturalEarthTopology,
  { waterSnapKm = WATER_SNAP_KM }: { waterSnapKm?: number } = {},
): Geocoder {
  const countries = buildLayer<CountryProps>(
    feature(topology, topology.objects.countries).features as Feature<Polygon | MultiPolygon, CountryProps>[],
  );
  const regions = buildLayer<RegionProps>(
    feature(topology, topology.objects.regions).features as Feature<Polygon | MultiPolygon, RegionProps>[],
  );

  return (lat: number, lng: number): GeocodedPoint | null => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const country =
      containing(countries, lng, lat)[0] ?? nearest(countries, lng, lat, waterSnapKm, () => true);
    if (!country) return null;
    const countryCode = country.props.c;

    // Admin-0 and admin-1 borders differ slightly after simplification, so a
    // Region must belong to the country found; otherwise take the nearest one
    // that does.
    const region =
      containing(regions, lng, lat).find((r) => r.props.k === countryCode) ??
      nearest(regions, lng, lat, waterSnapKm, (p) => p.k === countryCode);

    return { countryCode, regionCode: region?.props.c ?? null };
  };
}

let topology: Promise<NaturalEarthTopology> | null = null;
let shared: Promise<Geocoder> | null = null;

/** The committed boundary data, parsed once per process. */
export function loadNaturalEarthTopology(): Promise<NaturalEarthTopology> {
  topology ??= import("./natural-earth.topo.json").then(
    (mod) => (mod.default ?? mod) as unknown as NaturalEarthTopology,
  );
  return topology;
}

/** The process-wide Natural Earth geocoder; its boundary data loads on first use. */
export function naturalEarthGeocoder(): Promise<Geocoder> {
  shared ??= loadNaturalEarthTopology().then((t) => createNaturalEarthGeocoder(t));
  return shared;
}
