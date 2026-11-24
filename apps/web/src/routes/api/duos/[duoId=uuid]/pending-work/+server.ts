import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PendingWork } from "@geo-coach/shared";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { sessions } from "$lib/server/db/schema.js";
import { deriveSessionWorkRanges } from "$lib/server/services/index.js";

/** Pending work ranges per Session and purpose, for the Duo chrome's badge (fetched lazily, never in a load). */
export const GET: RequestHandler = duoRoute(async (_event, { db, duoId }) => {
  const duoSessions = await db.query.sessions.findMany({ where: eq(sessions.duoId, duoId), columns: { id: true } });
  const ranges: PendingWork["ranges"] = [];
  for (const ses of duoSessions) {
    for (const purpose of ["extract", "tips"] as const) {
      const count = (await deriveSessionWorkRanges(db, duoId, ses.id, purpose)).length;
      if (count > 0) ranges.push({ sessionId: ses.id, purpose, count });
    }
  }
  return json({ ranges } satisfies PendingWork);
});
