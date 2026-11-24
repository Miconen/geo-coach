import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { findRunInDuo } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { links } from "$lib/links.js";
import { isUuid } from "$lib/uuid.js";

// Reads only ?run= (X3): ?learning= and ?country= are client state and never rerun this load.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  // X2 from 2a(ii): a valid ?run= opens its Session page; a malformed, missing or cross-Duo one says so here.
  const runId = url.searchParams.get("run");
  if (runId !== null) {
    const run = isUuid(runId) ? await findRunInDuo(db, params.duoId, runId) : null;
    if (run) redirect(302, links.session(params.duoId, run.sessionId, { run: run.id }));
  }
  return {
    workbench: await buildWorkbenchData(db, params.duoId, player.id),
    runMissing: runId !== null,
  };
};
