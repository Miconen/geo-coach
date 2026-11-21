import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { manualLearningInputSchema } from "@geo-coach/shared";
import { getDb } from "$lib/server/db/index.js";
import { createManualLearning, DomainError } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const parsed = manualLearningInputSchema.parse(body);
    const id = await createManualLearning(getDb(), locals.player.id, parsed);
    duoEventBus.emitChanged(parsed.duoId, "learning", id);
    return json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid manual Learning input" }, { status: 400 });
  }
};
