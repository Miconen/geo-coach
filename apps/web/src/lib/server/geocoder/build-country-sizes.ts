/**
 * Regenerates `packages/shared/src/country-sizes.ts`, the country-size table the
 * statistics page uses in the browser (√area in km per country and per overseas
 * Region), from the committed `natural-earth.topo.json` (ADR 0004). Run it after
 * `geocoder:build-data`.
 *
 * Usage: pnpm --filter @geo-coach/web geocoder:build-sizes
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OVERSEAS_REGIONS } from "@geo-coach/shared";
import { countrySizesFromTopology, generateCountrySizesModule } from "./country-sizes.js";
import { loadNaturalEarthTopology } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../../../../packages/shared/src/country-sizes.ts");

const sizes = countrySizesFromTopology(
  await loadNaturalEarthTopology(),
  OVERSEAS_REGIONS.map((o) => o.regionCode),
);
fs.writeFileSync(OUT, generateCountrySizesModule(sizes));
console.log(
  `Wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(sizes.countries).length} countries, ` +
    `${Object.keys(sizes.overseasRegions).length} overseas Regions.`,
);
