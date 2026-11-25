import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

// Games index: every Game, newest first, with its Rounds as the strip shows them (reload-only: game events do not
// refresh indexes).
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const wb = await buildWorkbenchData(db, params.duoId, player.id, { speech: "cited" });
  const games = Object.values(wb.gamesById)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map(({ roundIds, sessionIds, ...game }) => ({
      game,
      rounds: roundIds.flatMap((id) => {
        const r = wb.roundsById[id];
        if (!r) return [];
        const { id: rid, gameId, roundNumber, countryCode, duoBestScore, opponentBestScore, hpDelta } = r;
        return [{ id: rid, gameId, roundNumber, countryCode, duoBestScore, opponentBestScore, hpDelta }];
      }),
    }));
  return { games };
};
