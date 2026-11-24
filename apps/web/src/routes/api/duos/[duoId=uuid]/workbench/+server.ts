import { json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { sessions } from "$lib/server/db/schema.js";
import { assertPlayerInDuo, DomainError } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { assertUuid } from "$lib/uuid.js";

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    await assertPlayerInDuo(db, locals.player.id, params.duoId);
    // ?sessionId= selects the run history's Session: malformed 400, outside the Duo 404. ?run= is a pin, never
    // an error: a malformed, missing or foreign one is dropped with 200 and the pane shows "no longer exists".
    const sessionParam = url.searchParams.get("sessionId");
    let sessionId: string | null = null;
    if (sessionParam !== null) {
      sessionId = assertUuid(sessionParam, "sessionId");
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, sessionId), eq(sessions.duoId, params.duoId)),
        columns: { id: true },
      });
      if (!session) return json({ error: "Session not found" }, { status: 404 });
    }
    return json(
      await buildWorkbenchData(db, params.duoId, locals.player.id, {
        sessionId,
        runId: url.searchParams.get("run"),
      }),
    );
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
};
