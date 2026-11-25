import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

// Sessions index, newest first (reload-only: session events do not refresh indexes).
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const wb = await buildWorkbenchData(db, params.duoId, player.id, { speech: "cited" });
  return {
    sessions: wb.sessions.map((s) => ({
      session: { id: s.id, startedAt: s.startedAt, micCount: s.micCount, ended: s.ended, extractWorkCount: s.extractWorkCount },
      games: s.gameIds.flatMap((id) => {
        const g = wb.gamesById[id];
        return g ? [{ id: g.id, opponentTeamName: g.opponentTeamName, startedAt: g.startedAt }] : [];
      }),
    })),
  };
};
