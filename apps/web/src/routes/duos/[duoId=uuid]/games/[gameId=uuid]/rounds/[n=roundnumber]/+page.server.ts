import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { findRoundIdByNumber, loadRoundPayload } from "$lib/server/entities/index.js";
import { gameTitle } from "$lib/entity-titles.js";
import { links } from "$lib/links.js";

// Rounds by their stored number (X7); the matcher admits only 1..2147483647, so /rounds/0 is the framework 404.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const roundId = await findRoundIdByNumber(db, params.duoId, params.gameId, Number(params.n));
  if (!roundId) error(404, "Round not found");
  const payload = await loadRoundPayload(db, params.duoId, player.id, roundId);
  if (!payload) error(404, "Round not found");
  return {
    payload,
    crumbs: [
      { label: gameTitle(payload.game), href: links.game(params.duoId, payload.game.id) },
      { label: `Round ${payload.round.roundNumber}` },
    ],
  };
};
