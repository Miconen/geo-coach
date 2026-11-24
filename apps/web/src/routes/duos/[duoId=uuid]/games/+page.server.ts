import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

// Games index: every Game, newest first, with its Rounds (reload-only: game events do not refresh indexes).
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const wb = await buildWorkbenchData(db, params.duoId, player.id);
  const games = Object.values(wb.gamesById)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((game) => ({ game, rounds: game.roundIds.flatMap((id) => (wb.roundsById[id] ? [wb.roundsById[id]!] : [])) }));
  return { games };
};
