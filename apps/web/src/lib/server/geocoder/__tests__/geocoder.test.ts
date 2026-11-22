import { beforeAll, describe, expect, it } from "vitest";
import { getRegion, type Geocoder } from "@geo-coach/shared";
import {
  createNaturalEarthGeocoder,
  loadNaturalEarthTopology,
  naturalEarthGeocoder,
} from "../index.js";

describe("Natural Earth geocoder", () => {
  let geocode: Geocoder;
  beforeAll(async () => {
    geocode = await naturalEarthGeocoder();
  });

  it.each([
    ["a US state", 39.7392, -104.9903, "US", "US-CO"],
    ["a Brazilian state", -23.5505, -46.6333, "BR", "BR-SP"],
    ["a French region, not its department", 45.764, 4.8357, "FR", "FR-ARA"],
    ["a UK nation", 55.9533, -3.1883, "GB", "GB-SCT"],
    ["a Spanish autonomous community", 41.6523, -4.7245, "ES", "ES-CL"],
    ["an Italian region", 41.9028, 12.4964, "IT", "IT-62"],
    ["Puerto Rico", 18.4655, -66.1057, "PR", "US-PR"],
    ["Hong Kong", 22.3193, 114.1694, "HK", null],
    ["Réunion", -20.8823, 55.4504, "RE", "FR-LRE"],
  ])("places %s", (_label, lat, lng, countryCode, regionCode) => {
    expect(geocode(lat, lng)).toEqual({ countryCode, regionCode });
  });

  it("names every Region it returns, under the same country", () => {
    const place = geocode(45.764, 4.8357)!;
    expect(getRegion(place.regionCode!)).toEqual({
      code: "FR-ARA",
      name: "Auvergne-Rhône-Alpes",
      countryCode: "FR",
    });
  });

  it("snaps a point 5 km offshore to the nearest country", async () => {
    // 5 km west of Cabo da Roca, Portugal: outside every polygon without the snap
    const noSnap = createNaturalEarthGeocoder(await loadNaturalEarthTopology(), { waterSnapKm: 0 });
    expect(noSnap(38.7804, -9.5584)).toBeNull();
    expect(geocode(38.7804, -9.5584)).toEqual({ countryCode: "PT", regionCode: "PT-11" });
  });

  it("returns null in the middle of the ocean", () => {
    expect(geocode(0, -30)).toBeNull();
    expect(geocode(-40, -120)).toBeNull();
  });
});
