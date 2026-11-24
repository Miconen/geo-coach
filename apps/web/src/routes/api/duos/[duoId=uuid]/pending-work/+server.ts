import { json } from "@sveltejs/kit";
import type { PendingWork } from "@geo-coach/shared";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { deriveWorkRangesBySession } from "$lib/server/services/index.js";
import { isProcessorOnline } from "$lib/server/mcp/processing-jobs.js";

/**
 * Pending work ranges per Session and purpose, for the Duo chrome's badge (fetched lazily, never in a load), from
 * one batched derivation over the Duo's Sessions. ?probe=1 answers after the guard only: the stream's authorization
 * probe needs the status, not the ranges.
 */
export const GET: RequestHandler = duoRoute(async ({ url }, { db, duoId }) => {
  if (url.searchParams.has("probe")) return json({ ok: true });
  const work = await deriveWorkRangesBySession(db, duoId, ["extract", "tips"] as const);
  const ranges: PendingWork["ranges"] = [];
  for (const [sessionId, byPurpose] of work) {
    for (const purpose of ["extract", "tips"] as const) {
      const count = byPurpose[purpose].length;
      if (count > 0) ranges.push({ sessionId, purpose, count });
    }
  }
  return json({ ranges, workerOnline: isProcessorOnline() } satisfies PendingWork);
});
