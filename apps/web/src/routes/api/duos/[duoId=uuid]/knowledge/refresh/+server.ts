import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadKnowledgePayload } from "$lib/server/entities/index.js";

// /knowledge's live refresh (#56 3a): the same payload as the page load.
export const GET: RequestHandler = duoRoute(async (_event, { db, player, duoId }) =>
  json(await loadKnowledgePayload(db, duoId, player.id)),
);
