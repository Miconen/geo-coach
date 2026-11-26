import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadCluesPayload } from "$lib/server/entities/clues.js";
import { enqueueClaimTagging, isProcessorOnline } from "$lib/server/mcp/processing-jobs.js";
import { DomainError } from "$lib/server/services/index.js";

/** The Clues page's refresh. */
export const GET: RequestHandler = duoRoute(async (_event, { db, duoId }) => json(await loadCluesPayload(db, duoId)));

// limit: tag at most this many Claims (the maintainer's 100-Claim test run); null tags the whole queue (the backfill).
const tagSchema = z.object({ limit: z.number().int().min(1).max(100_000).nullable() });

/** Queues Claim tagging (#89) for the processing worker. */
export const POST: RequestHandler = duoRoute(async ({ request }, { db, player, duoId }) => {
  const parsed = tagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid tagging request" }, { status: 400 });
  if (!isProcessorOnline()) return json({ error: "The processing worker is offline." }, { status: 503 });
  try {
    return json(await enqueueClaimTagging(db, player.id, { duoId, limit: parsed.data.limit }), { status: 202 });
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
