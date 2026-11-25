import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { buildStatsPayload } from "$lib/server/stats/payload.js";

// URL-free: filters live in the URL and are applied in the browser (ADR 0003), so they never rerun this load.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  return { stats: await buildStatsPayload(db, params.duoId, player.id) };
};
