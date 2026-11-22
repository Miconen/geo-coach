/**
 * Checks the offline geocoder against reality (ADR 0004): geocodes every stored
 * Round location and reports how often its country agrees with GeoGuessr's own
 * `countryCode`, plus each mismatch.
 *
 * Usage:
 *   pnpm --filter @geo-coach/web db:check-geocoder               # Rounds in DATABASE_URL
 *   pnpm --filter @geo-coach/web db:check-geocoder --duels f.jsonl  # raw duels, one per line
 */
import fs from "node:fs";
import { isNotNull } from "drizzle-orm";
import { naturalEarthGeocoder } from "../geocoder/index.js";
import { getDb } from "./index.js";
import { rounds } from "./schema.js";

const TARGET_AGREEMENT = 0.99;

interface Location {
  countryCode: string;
  lat: number;
  lng: number;
}

async function locationsFromDb(): Promise<Location[]> {
  const rows = await getDb()
    .select({ countryCode: rounds.countryCode, lat: rounds.lat, lng: rounds.lng })
    .from(rounds)
    .where(isNotNull(rounds.countryCode));
  return rows.flatMap((r) =>
    r.countryCode && r.lat !== null && r.lng !== null
      ? [{ countryCode: r.countryCode, lat: r.lat, lng: r.lng }]
      : [],
  );
}

function locationsFromDuels(file: string): Location[] {
  const out: Location[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const duel = JSON.parse(line) as {
      rounds?: Array<{ panorama?: { countryCode?: string; lat?: number; lng?: number } }>;
    };
    for (const r of duel.rounds ?? []) {
      const p = r.panorama;
      if (p?.countryCode && typeof p.lat === "number" && typeof p.lng === "number") {
        out.push({ countryCode: p.countryCode.toUpperCase(), lat: p.lat, lng: p.lng });
      }
    }
  }
  return out;
}

async function main() {
  const duelsIdx = process.argv.indexOf("--duels");
  const duelsFile = duelsIdx >= 0 ? process.argv[duelsIdx + 1] : undefined;
  const locations = duelsFile ? locationsFromDuels(duelsFile) : await locationsFromDb();
  if (locations.length === 0) {
    console.log("No Rounds with a country and coordinates found.");
    process.exit(1);
  }

  const geocode = await naturalEarthGeocoder();
  const mismatches: Array<Location & { geocoded: string }> = [];
  let withoutRegion = 0;
  for (const loc of locations) {
    const place = geocode(loc.lat, loc.lng);
    if (place?.countryCode !== loc.countryCode) {
      mismatches.push({ ...loc, geocoded: place?.countryCode ?? "water" });
    } else if (!place.regionCode) {
      withoutRegion += 1;
    }
  }

  const agreed = locations.length - mismatches.length;
  const ratio = agreed / locations.length;
  console.log(
    `Geocoder agrees with GeoGuessr on ${agreed}/${locations.length} Rounds ` +
      `(${(ratio * 100).toFixed(2)}%; target ${TARGET_AGREEMENT * 100}%).`,
  );
  console.log(`${withoutRegion} agreeing Round(s) have no Region.`);
  if (mismatches.length > 0) {
    console.log("\nMismatches (GeoGuessr → geocoder, lat,lng):");
    for (const m of mismatches.sort((a, b) => a.countryCode.localeCompare(b.countryCode))) {
      console.log(`  ${m.countryCode} → ${m.geocoded}  ${m.lat.toFixed(5)},${m.lng.toFixed(5)}`);
    }
  }
  process.exit(ratio >= TARGET_AGREEMENT ? 0 : 1);
}

main().catch((err) => {
  console.error("Geocoder check failed:", err);
  process.exit(1);
});
