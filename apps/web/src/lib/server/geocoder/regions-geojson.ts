import { merge } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import type { GeometryObject } from "topojson-specification";
import { regionName } from "@geo-coach/shared";
import type { NaturalEarthTopology } from "./index.js";

export interface RegionFeatureProps {
  code: string;
  name: string;
}

/**
 * One country's Regions as GeoJSON for the map view, from the geocoder's Natural
 * Earth admin-1 data (ADR 0004), merged per Region code (France's departments into
 * its regions, and so on). A Region belongs to the country its code starts with, or
 * to the country Natural Earth files it under (Puerto Rico's US-PR under PR).
 */
export function countryRegionsGeoJson(
  topology: NaturalEarthTopology,
  countryCode: string,
): FeatureCollection<MultiPolygon, RegionFeatureProps> {
  const country = countryCode.toUpperCase();
  const byCode = new Map<string, GeometryObject[]>();
  for (const g of topology.objects.regions.geometries) {
    const props = g.properties as { c?: string | null; k?: string | null } | undefined;
    const code = props?.c;
    if (!code || !(code.startsWith(`${country}-`) || props?.k === country)) continue;
    const list = byCode.get(code);
    if (list) list.push(g);
    else byCode.set(code, [g]);
  }
  const features: Feature<MultiPolygon, RegionFeatureProps>[] = [...byCode].map(([code, parts]) => ({
    type: "Feature",
    properties: { code, name: regionName(code) ?? code },
    geometry: merge(topology, parts as Parameters<typeof merge>[1]),
  }));
  return { type: "FeatureCollection", features };
}
