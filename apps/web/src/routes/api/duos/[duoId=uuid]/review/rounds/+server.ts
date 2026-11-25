import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadWorkbench } from "$lib/server/workbench/cache.js";
import { reviewRounds } from "$lib/server/workbench/review-view.js";
import { isUuid } from "$lib/uuid.js";

// Review's Round cards: full Rounds and their speech for ?ids= (comma-separated, at most 200), fetched on demand.
export const GET: RequestHandler = duoRoute(async ({ url }, { db, player, duoId }) => {
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > 200 || !ids.every((id) => isUuid(id))) {
    return json({ error: "Invalid ids" }, { status: 400 });
  }
  return json(reviewRounds(await loadWorkbench(db, duoId, player.id), ids));
});
