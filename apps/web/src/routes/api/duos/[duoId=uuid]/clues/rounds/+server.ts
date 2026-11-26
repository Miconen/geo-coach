import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { enqueueAllRoundTagging, isProcessorOnline } from "$lib/server/mcp/processing-jobs.js";
import { DomainError } from "$lib/server/services/index.js";

/** Queues Round tagging (`clues` runs) for every Session of the Duo (#95), for the processing worker. */
export const POST: RequestHandler = duoRoute(async (_event, { db, player, duoId }) => {
  if (!isProcessorOnline()) return json({ error: "The processing worker is offline." }, { status: 503 });
  try {
    return json(await enqueueAllRoundTagging(db, player.id, duoId), { status: 202 });
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
