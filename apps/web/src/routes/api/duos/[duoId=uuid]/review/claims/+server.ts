import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { reviewCountryClaims } from "$lib/server/workbench/review-view.js";
import { parseCountryParam } from "$lib/country-param.js";

// Review's Country dossier: the selected Country's Claims (?country=, ISO code), fetched on demand.
export const GET: RequestHandler = duoRoute(async ({ url }, { db, player, duoId }) => {
  const country = parseCountryParam(url.searchParams.get("country"));
  if (!country) return json({ error: "Invalid country" }, { status: 400 });
  return json(reviewCountryClaims(await buildWorkbenchData(db, duoId, player.id, { speech: "cited" }), country));
});
