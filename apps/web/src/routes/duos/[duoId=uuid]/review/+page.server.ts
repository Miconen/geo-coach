import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { findRunInDuo } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { isUuid } from "$lib/uuid.js";

// Reads only ?run= (X3): ?learning= and ?country= are client state and never rerun this load.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  // The 0b resolver (X2): a malformed, missing or cross-Duo ?run= is a 404 here until the Session page ships.
  const runId = url.searchParams.get("run");
  if (runId !== null) {
    if (!isUuid(runId) || !(await findRunInDuo(db, params.duoId, runId))) error(404, "Run not found");
  }
  return {
    workbench: await buildWorkbenchData(db, params.duoId, player.id, { runId }),
    selectedRunId: runId,
  };
};
