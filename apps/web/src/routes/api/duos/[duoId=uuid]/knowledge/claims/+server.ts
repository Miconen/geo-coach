import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadClaimDetails } from "$lib/server/entities/index.js";
import { isUuid } from "$lib/uuid.js";

// /knowledge's Claim cards: full Claims and their lookups for ?ids= (comma-separated, at most 200), fetched on
// demand; ids that are not this Duo's are skipped.
export const GET: RequestHandler = duoRoute(async ({ url }, { db, player, duoId }) => {
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > 200 || !ids.every((id) => isUuid(id))) {
    return json({ error: "Invalid ids" }, { status: 400 });
  }
  return json(await loadClaimDetails(db, duoId, player.id, ids));
});
