import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { buildStatsPayload } from "$lib/server/stats/payload.js";

// Stats' live refresh (#56 2b): the same payload as the page load, for refreshes only (the load stays the Back baseline).
export const GET: RequestHandler = duoRoute(async (_event, { db, duoId, player }) =>
  json(await buildStatsPayload(db, duoId, player.id)),
);
