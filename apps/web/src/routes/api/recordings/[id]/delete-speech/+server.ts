import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { assertAuthAvailable } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { deleteOwnSpeechRange, DomainError } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

const deleteSchema = z.object({
  duoId: z.string().uuid(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAuthAvailable(locals);
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = deleteSchema.parse(await request.json());
    const res = await deleteOwnSpeechRange(getDb(), locals.player.id, parsed.duoId, {
      recordingId: params.id,
      startUtc: new Date(parsed.startUtc),
      endUtc: new Date(parsed.endUtc),
    });
    duoEventBus.emitChanged(parsed.duoId, "session", params.id);
    return json(res);
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid speech delete request" }, { status: 400 });
  }
};
