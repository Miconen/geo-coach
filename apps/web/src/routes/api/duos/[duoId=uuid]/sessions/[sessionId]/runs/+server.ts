import { json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { sessions } from "$lib/server/db/schema.js";
import { loadSessionRunsPage, parseRunsQuery } from "$lib/server/entities/index.js";
import { isUuid } from "$lib/uuid.js";

// One page of a Session's run history (#56 2a(i)). Path id, cursor, purpose and noop are validated (400) before
// any resource query; ?run= is a pin, dropped when malformed.
export const GET: RequestHandler = duoRoute(async ({ params, url }, { db, duoId }) => {
  if (!isUuid(params.sessionId)) return json({ error: "Invalid sessionId" }, { status: 400 });
  const q = parseRunsQuery(url.searchParams);
  if ("error" in q) return json({ error: q.error }, { status: 400 });
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, params.sessionId), eq(sessions.duoId, duoId)));
  if (!session) return json({ error: "Session not found" }, { status: 404 });
  return json(await loadSessionRunsPage(db, duoId, params.sessionId, q));
});
