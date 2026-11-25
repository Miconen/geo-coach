import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadKnowledgePayload } from "$lib/server/entities/index.js";
import { parseCountryParam } from "$lib/country-param.js";
import { isUuid } from "$lib/uuid.js";

// URL-free (X3): ?country= and ?claim= are client state and never rerun this load; read untracked, they only pick
// which cards ship with full Claims for first paint.
export const load: PageServerLoad = async ({ locals, params, url, untrack }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const shown = untrack(() => {
    const claimId = url.searchParams.get("claim");
    return { country: parseCountryParam(url.searchParams.get("country")), claimId: claimId && isUuid(claimId) ? claimId : null };
  });
  return { payload: await loadKnowledgePayload(db, params.duoId, player.id, shown) };
};
