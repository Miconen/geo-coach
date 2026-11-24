import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadSessionPayload } from "$lib/server/entities/index.js";
import { sessionTitle } from "$lib/entity-titles.js";
import { isUuid } from "$lib/uuid.js";

// ?run= is a pin (X2): a malformed, missing or foreign one shows "That run no longer exists", never a 404.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const runParam = url.searchParams.get("run");
  const runId = runParam !== null && isUuid(runParam) ? runParam : null;
  const payload = await loadSessionPayload(db, params.duoId, player.id, params.sessionId, runId);
  if (!payload) error(404, "Session not found");
  const pinFound =
    runId !== null && (payload.runs.rows.some((r) => r.runId === runId) || payload.runs.pinnedRun?.runId === runId);
  return {
    payload,
    selectedRunId: pinFound ? runId : null,
    pinMissing: runParam !== null && !pinFound,
    crumbs: [{ label: sessionTitle(payload.session) }],
  };
};
