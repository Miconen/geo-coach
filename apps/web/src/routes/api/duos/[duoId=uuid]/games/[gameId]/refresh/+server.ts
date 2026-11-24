import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadGamePayload } from "$lib/server/entities/index.js";
import { isUuid } from "$lib/uuid.js";

// The Game page's live refresh (#56 2a(i)): 400 for a malformed id before any query; 404 when not this Duo's.
export const GET: RequestHandler = duoRoute(async ({ params }, { db, player, duoId }) => {
  if (!isUuid(params.gameId)) return json({ error: "Invalid gameId" }, { status: 400 });
  const payload = await loadGamePayload(db, duoId, player.id, params.gameId);
  if (!payload) return json({ error: "Game not found" }, { status: 404 });
  return json(payload);
});
