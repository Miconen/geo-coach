import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { assertAuthAvailable } from "$lib/server/auth/guards.js";
import { loadNaturalEarthTopology } from "$lib/server/geocoder/index.js";
import { countryRegionsGeoJson } from "$lib/server/geocoder/regions-geojson.js";

/** One country's Regions as GeoJSON features `{ code, name }`, for the /stats Map view. */
export const GET: RequestHandler = async ({ locals, params }) => {
  assertAuthAvailable(locals);
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[A-Za-z]{2}$/.test(params.country)) {
    return json({ error: "Expected a two-letter country code" }, { status: 400 });
  }
  const regions = countryRegionsGeoJson(await loadNaturalEarthTopology(), params.country);
  // The boundary data only changes with a deploy.
  return json(regions, { headers: { "cache-control": "private, max-age=86400" } });
};
