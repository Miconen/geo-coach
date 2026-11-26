import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadCluesPayload } from "$lib/server/entities/clues.js";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  await assertDuoAccess(locals, params.duoId, url, db);
  return { payload: await loadCluesPayload(db, params.duoId) };
};
