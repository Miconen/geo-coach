/**
 * Regenerates the geocoder's boundary data from Natural Earth 10m (public domain):
 *
 *   - `natural-earth.topo.json` next to this file: simplified TopoJSON with a
 *     `countries` layer (admin-0 map units, `{ c }`) and a `regions` layer
 *     (admin-1 grouped into Regions, `{ c, k }`). Server-only.
 *   - `packages/shared/src/regions.ts`: the Region lookup table (code → name, country).
 *
 * Usage: pnpm --filter @geo-coach/web geocoder:build-data [--cache <dir>]
 *
 * Then run `geocoder:build-sizes` to regenerate the country-size table from the new data.
 *
 * The Natural Earth zips are downloaded into the cache dir (default: the OS temp
 * dir) on first run. See ADR 0004 and GLOSSARY "Region" for the grouping rules.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error mapshaper ships no type declarations
import mapshaper from "mapshaper";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPOJSON_OUT = path.join(__dirname, "natural-earth.topo.json");
const REGIONS_OUT = path.resolve(__dirname, "../../../../../../packages/shared/src/regions.ts");

const NATURAL_EARTH_VERSION = "5.1.1";
const SOURCES = {
  countries: "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_map_units.zip",
  regions: "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
} as const;

/** Simplification tolerance in metres, and TopoJSON quantization. */
const SIMPLIFY_INTERVAL_M = 250;
const QUANTIZATION = 1e6;

// ---------------------------------------------------------------------------
// Region grouping rules (GLOSSARY: Region)

/** Countries grouped by Natural Earth's `region` / `region_cod` fields. */
const GROUP_BY_REGION_COD = new Set(["FRA", "ITA", "PHL"]);

/** Spain's 19 autonomous communities: Natural Earth region name → ISO 3166-2 code and display name. */
const SPAIN_COMMUNITIES: Record<string, { code: string; name: string }> = {
  "Andalucía": { code: "ES-AN", name: "Andalucía" },
  "Aragón": { code: "ES-AR", name: "Aragón" },
  "Asturias": { code: "ES-AS", name: "Asturias" },
  "Islas Baleares": { code: "ES-IB", name: "Illes Balears" },
  "Canary Is.": { code: "ES-CN", name: "Canarias" },
  "Cantabria": { code: "ES-CB", name: "Cantabria" },
  "Castilla y León": { code: "ES-CL", name: "Castilla y León" },
  "Castilla-La Mancha": { code: "ES-CM", name: "Castilla-La Mancha" },
  "Cataluña": { code: "ES-CT", name: "Cataluña" },
  "Valenciana": { code: "ES-VC", name: "Comunitat Valenciana" },
  "Extremadura": { code: "ES-EX", name: "Extremadura" },
  "Galicia": { code: "ES-GA", name: "Galicia" },
  "La Rioja": { code: "ES-RI", name: "La Rioja" },
  "Madrid": { code: "ES-MD", name: "Comunidad de Madrid" },
  "Murcia": { code: "ES-MC", name: "Región de Murcia" },
  "Foral de Navarra": { code: "ES-NC", name: "Navarra" },
  "País Vasco": { code: "ES-PV", name: "País Vasco" },
  "Ceuta": { code: "ES-CE", name: "Ceuta" },
  "Melilla": { code: "ES-ML", name: "Melilla" },
};

/** The UK's 4 nations, from Natural Earth's `geonunit`. */
const UK_NATIONS: Record<string, { code: string; name: string }> = {
  "England": { code: "GB-ENG", name: "England" },
  "Scotland": { code: "GB-SCT", name: "Scotland" },
  "Wales": { code: "GB-WLS", name: "Wales" },
  "Northern Ireland": { code: "GB-NIR", name: "Northern Ireland" },
};

/**
 * Display names for codes Natural Earth gives to several admin-1 units at once
 * (it keeps a code across a split), where no single unit's name fits the whole.
 */
const MERGED_REGION_NAMES: Record<string, string> = {
  "BA-BIH": "Federation of Bosnia and Herzegovina",
  "IE-D": "Dublin",
  "IE-TA": "Tipperary",
  "IR-07": "Tehran",
  "MG-A": "Toamasina",
  "MG-D": "Antsiranana",
  "MG-F": "Fianarantsoa",
  "MG-M": "Mahajanga",
  "MG-T": "Antananarivo",
  "MG-U": "Toliara",
  "SD-DS": "Southern Darfur",
};

/** Admin-0 units whose `ISO_A2_EH` is a placeholder but that belong to a coded country. */
const COUNTRY_BY_ADM0_A3: Record<string, string> = {
  GBR: "GB",
  BEL: "BE",
};

function isRealIsoCountry(code: string | undefined): code is string {
  return typeof code === "string" && /^[A-Z]{2}$/.test(code);
}

/** Native admin-1 codes; placeholders such as `-99` or `HK-X01~` give null. */
function nativeRegionCode(iso31662: string | undefined): string | null {
  const code = (iso31662 ?? "").trim();
  return /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------------

type Props = Record<string, unknown>;

function str(props: Props, key: string): string {
  const v = props[key];
  return typeof v === "string" ? v.trim() : "";
}

async function download(url: string, cacheDir: string): Promise<Buffer> {
  const file = path.join(cacheDir, path.basename(url));
  if (!fs.existsSync(file)) {
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file);
}

async function readZipAsGeoJson(zip: Buffer): Promise<FeatureCollection<Geometry, Props>> {
  const out = await mapshaper.applyCommands("-i in.zip -o out.json format=geojson", {
    "in.zip": zip,
  });
  // The zip yields an extra, empty layer besides the shapefile's own.
  const collections = Object.values(out as Record<string, unknown>)
    .map((json) => JSON.parse(String(json)) as Partial<FeatureCollection<Geometry, Props>>)
    .filter((fc): fc is FeatureCollection<Geometry, Props> => Array.isArray(fc.features));
  const [largest] = collections.sort((a, b) => b.features.length - a.features.length);
  if (!largest) throw new Error("mapshaper produced no features");
  return largest;
}

interface RegionEntry {
  code: string;
  name: string;
  country: string;
  area: number;
}

function regionFor(
  props: Props,
  countryByGuA3: Map<string, string>,
): { code: string | null; country: string | null; name: string } {
  const adm0 = str(props, "adm0_a3");
  const country =
    countryByGuA3.get(str(props, "gu_a3")) ??
    (isRealIsoCountry(str(props, "iso_a2")) ? str(props, "iso_a2") : null);
  const name = str(props, "name");

  if (GROUP_BY_REGION_COD.has(adm0)) {
    const code = nativeRegionCode(str(props, "region_cod"));
    return { code, country, name: str(props, "region") || name };
  }
  if (adm0 === "ESP") {
    const community = SPAIN_COMMUNITIES[str(props, "region")];
    // Natural Earth gives Ceuta and Melilla the same region code; their names differ.
    const byName = SPAIN_COMMUNITIES[name];
    const entry = byName && (name === "Ceuta" || name === "Melilla") ? byName : community;
    if (!entry) throw new Error(`Unmapped Spanish region: ${str(props, "region")} (${name})`);
    return { code: entry.code, country, name: entry.name };
  }
  if (adm0 === "GBR") {
    const nation = UK_NATIONS[str(props, "geonunit")];
    if (!nation) throw new Error(`Unmapped UK geonunit: ${str(props, "geonunit")}`);
    return { code: nation.code, country, name: nation.name };
  }
  return { code: nativeRegionCode(str(props, "iso_3166_2")), country, name };
}

function generateRegionsModule(entries: RegionEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.code.localeCompare(b.code));
  const rows = sorted
    .map((r) => `  [${JSON.stringify(r.code)}, ${JSON.stringify(r.name)}, ${JSON.stringify(r.country)}],`)
    .join("\n");
  return `// Generated by apps/web/src/lib/server/geocoder/build-data.ts from Natural Earth ${NATURAL_EARTH_VERSION}. Do not edit.

/** A Region (GLOSSARY): a first-level subdivision as geo-coach groups it. */
export interface RegionInfo {
  /** ISO 3166-2 style, e.g. \`BR-SP\`, \`FR-IDF\`, \`GB-SCT\`. */
  code: string;
  name: string;
  /** ISO 3166-1 alpha-2 of the country the Region belongs to. */
  countryCode: string;
}

// [code, name, countryCode]
const REGION_ROWS: readonly (readonly [string, string, string])[] = [
${rows}
];

let byCode: Map<string, RegionInfo> | null = null;
let byCountry: Map<string, RegionInfo[]> | null = null;

function index(): { byCode: Map<string, RegionInfo>; byCountry: Map<string, RegionInfo[]> } {
  if (!byCode || !byCountry) {
    byCode = new Map();
    byCountry = new Map();
    for (const [code, name, countryCode] of REGION_ROWS) {
      const info: RegionInfo = { code, name, countryCode };
      byCode.set(code, info);
      const list = byCountry.get(countryCode) ?? [];
      list.push(info);
      byCountry.set(countryCode, list);
    }
  }
  return { byCode, byCountry };
}

export function getRegion(code: string): RegionInfo | null {
  return index().byCode.get(code.toUpperCase()) ?? null;
}

/** The Region's display name, or null for an unknown code. */
export function regionName(code: string | null | undefined): string | null {
  return code ? (getRegion(code)?.name ?? null) : null;
}

/** All Regions of a country (ISO 3166-1 alpha-2), sorted by code. */
export function regionsOf(countryCode: string): readonly RegionInfo[] {
  return index().byCountry.get(countryCode.toUpperCase()) ?? [];
}
`;
}

async function main() {
  const cacheIdx = process.argv.indexOf("--cache");
  const cacheDir =
    cacheIdx >= 0 && process.argv[cacheIdx + 1]
      ? path.resolve(process.argv[cacheIdx + 1]!)
      : path.join(os.tmpdir(), "geo-coach-natural-earth");

  const admin0 = await readZipAsGeoJson(await download(SOURCES.countries, cacheDir));
  const admin1 = await readZipAsGeoJson(await download(SOURCES.regions, cacheDir));

  // Countries: ISO_A2_EH (not ISO_A2, which is -99 for France, Norway, the UK's
  // nations, …). Units without a real code are dropped, so points there fall
  // back to the nearest coded country.
  const countryByGuA3 = new Map<string, string>();
  const countries: Feature<Geometry, Props>[] = [];
  for (const f of admin0.features) {
    const props = f.properties ?? {};
    const eh = str(props, "ISO_A2_EH");
    const code = isRealIsoCountry(eh) ? eh : COUNTRY_BY_ADM0_A3[str(props, "ADM0_A3")];
    if (!code) continue;
    countryByGuA3.set(str(props, "GU_A3"), code);
    countries.push({ ...f, properties: { c: code } });
  }

  const regionEntries = new Map<string, RegionEntry>();
  const regions: Feature<Geometry, Props>[] = [];
  for (const f of admin1.features) {
    const props = f.properties ?? {};
    const { code, country, name } = regionFor(props, countryByGuA3);
    const regionCode = code && country ? code : null;
    if (regionCode && country) {
      const area = Number(props.area_sqkm) || 0;
      const existing = regionEntries.get(regionCode);
      if (!existing || (existing.country === country && area > existing.area)) {
        regionEntries.set(regionCode, { code: regionCode, name, country, area });
      }
    }
    regions.push({
      ...f,
      properties: {
        c: regionCode,
        k: country,
        // Units without a code stay separate (they still mark "inside, but no Region").
        key: regionCode ?? `~${str(props, "adm1_code")}`,
      },
    });
  }
  for (const [code, name] of Object.entries(MERGED_REGION_NAMES)) {
    const entry = regionEntries.get(code);
    if (entry) entry.name = name;
  }

  const out = await mapshaper.applyCommands(
    [
      "-i countries.json regions.json combine-files",
      "-dissolve2 c target=countries",
      "-dissolve2 key copy-fields=c,k target=regions",
      "-drop fields=key target=regions",
      `-simplify interval=${SIMPLIFY_INTERVAL_M} keep-shapes target=*`,
      "-clean target=*",
      `-o natural-earth.topo.json format=topojson quantization=${QUANTIZATION} target=*`,
    ].join(" "),
    {
      "countries.json": { type: "FeatureCollection", features: countries },
      "regions.json": { type: "FeatureCollection", features: regions },
    },
  );
  fs.writeFileSync(TOPOJSON_OUT, String(out["natural-earth.topo.json"]));
  fs.writeFileSync(REGIONS_OUT, generateRegionsModule([...regionEntries.values()]));

  const size = fs.statSync(TOPOJSON_OUT).size;
  console.log(
    `Wrote ${path.relative(process.cwd(), TOPOJSON_OUT)} (${(size / 1024 / 1024).toFixed(2)} MB), ` +
      `${countries.length} country units, ${regionEntries.size} Regions.`,
  );
}

main().catch((err) => {
  console.error("Building geocoder data failed:", err);
  process.exit(1);
});
