import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadKnowledgePayload } from "$lib/server/entities/index.js";

// URL-free (X3): ?country= and ?claim= are client state and never rerun this load.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  return { payload: await loadKnowledgePayload(db, params.duoId, player.id) };
};
