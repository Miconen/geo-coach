/**
 * Regions far from their country's mainland, with their own landscape and clues:
 * for the mistake class they count as their own country (see `mistakeCountryCode`),
 * so a guess in Paris on a Round in French Guiana is a wrong country, not a far
 * miss. Each has its own size in `OVERSEAS_REGION_SIZE_KM`.
 */
export interface OverseasRegion {
  /** The Region (GLOSSARY), as the geocoder codes it. */
  regionCode: string;
  /** The sovereign country, as GeoGuessr may report it for a Round there. */
  countryCode: string;
  /**
   * The code the geocoder gives the territory as a country when Natural Earth
   * keeps it as its own map unit (French Guiana is `GF`), or null when the
   * geocoder reports the sovereign country (the Azores are `PT`).
   */
  unitCode: string | null;
  name: string;
}

export const OVERSEAS_REGIONS: readonly OverseasRegion[] = [
  { regionCode: "FR-GUF", countryCode: "FR", unitCode: "GF", name: "French Guiana" },
  { regionCode: "FR-GUA", countryCode: "FR", unitCode: "GP", name: "Guadeloupe" },
  { regionCode: "FR-MTQ", countryCode: "FR", unitCode: "MQ", name: "Martinique" },
  { regionCode: "FR-LRE", countryCode: "FR", unitCode: "RE", name: "Réunion" },
  { regionCode: "FR-MAY", countryCode: "FR", unitCode: "YT", name: "Mayotte" },
  { regionCode: "PT-20", countryCode: "PT", unitCode: null, name: "Azores" },
  { regionCode: "PT-30", countryCode: "PT", unitCode: null, name: "Madeira" },
  { regionCode: "ES-CN", countryCode: "ES", unitCode: null, name: "Canary Islands" },
  { regionCode: "US-HI", countryCode: "US", unitCode: null, name: "Hawaii" },
];

const byRegionCode = new Map(OVERSEAS_REGIONS.map((o) => [o.regionCode, o]));
const byUnitCode = new Map(
  OVERSEAS_REGIONS.filter((o) => o.unitCode !== null).map((o) => [o.unitCode!, o]),
);

/** The overseas Region a place is in, judged by its Region or by a map-unit country code. */
export function overseasRegionOf(
  countryCode: string | null,
  regionCode: string | null,
): OverseasRegion | null {
  return (
    (regionCode ? byRegionCode.get(regionCode) : undefined) ??
    (countryCode ? byUnitCode.get(countryCode) : undefined) ??
    null
  );
}

/**
 * True when the geocoder's country is the given country or one of its overseas
 * Regions kept as a separate map unit (the geocoder's `GF` is part of GeoGuessr's `FR`).
 */
export function isPartOfCountry(geocodedCountryCode: string, countryCode: string): boolean {
  return (
    geocodedCountryCode === countryCode ||
    byUnitCode.get(geocodedCountryCode)?.countryCode === countryCode
  );
}

/**
 * The country a place counts as for the mistake class: an overseas Region's code
 * (`FR-GUF`) for a place in one, else its country code. Null for water or no place.
 */
export function mistakeCountryCode(
  countryCode: string | null,
  regionCode: string | null,
): string | null {
  return overseasRegionOf(countryCode, regionCode)?.regionCode ?? countryCode;
}
