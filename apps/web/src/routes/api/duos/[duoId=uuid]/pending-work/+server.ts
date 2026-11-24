import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PendingWork } from "@geo-coach/shared";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { sessions } from "$lib/server/db/schema.js";
import { deriveSessionWorkRanges } from "$lib/server/services/index.js";
import { isProcessorOnline } from "$lib/server/mcp/processing-jobs.js";

const CONCURRENCY = 4;

/**
 * Pending work ranges per Session and purpose, for the Duo chrome's badge (fetched lazily, never in a load).
 * ?probe=1 answers after the guard only: the stream's authorization probe needs the status, not the ranges.
 */
export const GET: RequestHandler = duoRoute(async ({ url }, { db, duoId }) => {
  if (url.searchParams.has("probe")) return json({ ok: true });
  const duoSessions = await db.query.sessions.findMany({ where: eq(sessions.duoId, duoId), columns: { id: true } });
  const jobs = duoSessions.flatMap((ses) => (["extract", "tips"] as const).map((purpose) => ({ sessionId: ses.id, purpose })));
  const counts = new Array<number>(jobs.length);
  let next = 0;
  // A few derivations at a time: each is several small queries, and Sessions are independent.
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        counts[i] = (await deriveSessionWorkRanges(db, duoId, jobs[i]!.sessionId, jobs[i]!.purpose)).length;
      }
    }),
  );
  const ranges: PendingWork["ranges"] = jobs.flatMap((j, i) => (counts[i]! > 0 ? [{ ...j, count: counts[i]! }] : []));
  return json({ ranges, workerOnline: isProcessorOnline() } satisfies PendingWork);
});
