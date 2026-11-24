import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadSessionPayload } from "$lib/server/entities/index.js";
import { isUuid } from "$lib/uuid.js";

// The Session page's live refresh (#56 2a(i)). ?run= is a pin (X2): malformed, missing or foreign is dropped with
// 200; a valid pin off page one comes back as runs.pinnedRun.
export const GET: RequestHandler = duoRoute(async ({ params, url }, { db, player, duoId }) => {
  if (!isUuid(params.sessionId)) return json({ error: "Invalid sessionId" }, { status: 400 });
  const run = url.searchParams.get("run");
  const payload = await loadSessionPayload(db, duoId, player.id, params.sessionId, run !== null && isUuid(run) ? run : null);
  if (!payload) return json({ error: "Session not found" }, { status: 404 });
  return json(payload);
});
