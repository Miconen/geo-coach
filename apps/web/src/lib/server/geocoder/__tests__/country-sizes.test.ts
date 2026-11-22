import { describe, expect, it } from "vitest";
import {
  COUNTRY_SIZE_KM,
  OVERSEAS_REGIONS,
  OVERSEAS_REGION_SIZE_KM,
  countrySizeKm,
} from "@geo-coach/shared";
import { areaKm2, countrySizesFromTopology } from "../country-sizes.js";
import { loadNaturalEarthTopology } from "../index.js";

describe("country sizes", () => {
  it("measures area on the sphere", () => {
    // One degree square at the equator is about 111.2 km on each side.
    const square = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    expect(Math.sqrt(areaKm2(square))).toBeCloseTo(111.2, 0);
  });

  it("ships the table generated from the geocoder's boundary data", async () => {
    const sizes = countrySizesFromTopology(
      await loadNaturalEarthTopology(),
      OVERSEAS_REGIONS.map((o) => o.regionCode),
    );
    // Regenerate with `pnpm --filter @geo-coach/web geocoder:build-sizes` if this fails.
    expect(sizes.countries).toEqual(COUNTRY_SIZE_KM);
    expect(sizes.overseasRegions).toEqual(OVERSEAS_REGION_SIZE_KM);
  });

  it("gives every overseas Region its own size, apart from its country", () => {
    for (const o of OVERSEAS_REGIONS) expect(countrySizeKm(o.regionCode)).toBeGreaterThan(0);
    expect(countrySizeKm("FR-GUF")).toBeLessThan(countrySizeKm("FR")!);
    // France's size is the mainland's (about 550,000 km²), not with its overseas Regions.
    expect(countrySizeKm("FR")).toBeGreaterThan(700);
    expect(countrySizeKm("FR")).toBeLessThan(780);
  });
});
