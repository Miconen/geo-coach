import { json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { reviewQuerySchema } from "@geo-coach/shared";
import { sessions } from "$lib/server/db/schema.js";
import { duoRoute } from "$lib/server/auth/guards.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

// Review's refresh (#56 3b), replacing its /workbench use (/workbench stays until 4).
export const GET: RequestHandler = duoRoute(async ({ url }, { db, player, duoId }) => {
  const parsed = reviewQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: "Invalid query" }, { status: 400 });
  const sessionId = parsed.data.sessionId?.toLowerCase() ?? null;
  if (sessionId) {
    const session = await db.query.sessions.findFirst({
      where: and(eq(sessions.id, sessionId), eq(sessions.duoId, duoId)),
      columns: { id: true },
    });
    if (!session) return json({ error: "Session not found" }, { status: 404 });
  }
  return json(await buildWorkbenchData(db, duoId, player.id, { sessionId, runId: parsed.data.run ?? null }));
});
