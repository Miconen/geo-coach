import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildGamesList } from "$lib/server/entities/games-list.js";
import { loadWorkbench } from "$lib/server/workbench/cache.js";

// Games list (#81): compact Game rows grouped by Session on the shared map (reload-only: game events do not
// refresh indexes). The cited-speech derivation is the Game page's cache entry too (#72).
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const wb = await loadWorkbench(db, params.duoId, player.id, { speech: "cited" });
  return { list: buildGamesList(wb, params.duoId) };
};
