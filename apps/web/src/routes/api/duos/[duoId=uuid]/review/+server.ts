import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { reviewQuerySchema } from "@geo-coach/shared";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadWorkbench } from "$lib/server/workbench/cache.js";
import { reviewView } from "$lib/server/workbench/review-view.js";

// Review's refresh (#56 3b; /workbench retired in 4): the same payload as Review's page load.
export const GET: RequestHandler = duoRoute(async ({ url }, { db, player, duoId }) => {
  if (!reviewQuerySchema.safeParse(Object.fromEntries(url.searchParams)).success) {
    return json({ error: "Invalid query" }, { status: 400 });
  }
  return json(reviewView(await loadWorkbench(db, duoId, player.id, { speech: "cited" })));
});
