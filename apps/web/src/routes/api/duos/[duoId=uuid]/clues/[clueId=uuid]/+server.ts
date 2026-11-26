import { json } from "@sveltejs/kit";
import { z } from "zod";
import { clueNameSchema } from "@geo-coach/shared";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { duoEventBus } from "$lib/server/events/bus.js";
import { DomainError, mergeClues, renameClue } from "$lib/server/services/index.js";

// A Player renames a Clue within its family, or merges it into another Clue, moving every link (#89).
const bodySchema = z.union([z.object({ name: clueNameSchema }), z.object({ mergeInto: z.string().uuid() })]);

export const PATCH: RequestHandler = duoRoute(async ({ params, request }, { db, duoId }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid Clue change" }, { status: 400 });
  try {
    const body = parsed.data;
    const result =
      "name" in body
        ? { clue: await renameClue(db, duoId, params.clueId, body.name) }
        : await mergeClues(db, duoId, params.clueId, body.mergeInto);
    duoEventBus.emitChanged(duoId, "clue", params.clueId);
    return json(result);
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
