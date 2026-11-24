import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

// Sessions index, newest first (reload-only: session events do not refresh indexes).
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const wb = await buildWorkbenchData(db, params.duoId, player.id);
  return {
    sessions: wb.sessions.map((s) => ({
      session: s,
      games: s.gameIds.flatMap((id) => (wb.gamesById[id] ? [wb.gamesById[id]!] : [])),
    })),
  };
};
