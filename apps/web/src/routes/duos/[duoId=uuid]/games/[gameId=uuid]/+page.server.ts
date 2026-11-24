import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadGamePayload } from "$lib/server/entities/index.js";
import { gameTitle } from "$lib/entity-titles.js";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const payload = await loadGamePayload(db, params.duoId, player.id, params.gameId);
  if (!payload) error(404, "Game not found");
  return { payload, crumbs: [{ label: gameTitle(payload.game) }] };
};
