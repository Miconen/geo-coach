import { describe, expect, it } from "vitest";
import { loadNaturalEarthTopology } from "../index.js";
import { countryRegionsGeoJson } from "../regions-geojson.js";

describe("countryRegionsGeoJson", () => {
  it("returns one feature per Region code, with its name", async () => {
    const fc = countryRegionsGeoJson(await loadNaturalEarthTopology(), "bg");
    const codes = fc.features.map((f) => f.properties.code);
    expect(codes).toHaveLength(28); // Bulgaria's 28 provinces
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c.startsWith("BG-"))).toBe(true);
    const sofia = fc.features.find((f) => f.properties.code === "BG-22")!;
    expect(sofia.properties.name).toBeTruthy();
    expect(sofia.geometry.type).toBe("MultiPolygon");
  });

  it("merges the parts that share a Region code", async () => {
    // France's departments are grouped into its 13 metropolitan regions (and overseas ones).
    const fc = countryRegionsGeoJson(await loadNaturalEarthTopology(), "FR");
    const metro = fc.features.filter((f) => !["FR-GUF", "FR-MTQ", "FR-GUA", "FR-LRE", "FR-MAY"].includes(f.properties.code));
    expect(metro).toHaveLength(13);
  });

  it("is empty for a country without Regions in the data", async () => {
    expect(countryRegionsGeoJson(await loadNaturalEarthTopology(), "ZZ").features).toEqual([]);
  });
});
