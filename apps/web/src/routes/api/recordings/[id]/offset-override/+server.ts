import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { assertAuthAvailable } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { DomainError, setManualOffsetOverride } from "$lib/server/services/index.js";

const bodySchema = z.object({
  manualOffsetOverrideMs: z.number().int().nullable(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAuthAvailable(locals);
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = bodySchema.parse(await request.json());
    const res = await setManualOffsetOverride(
      getDb(),
      locals.player.id,
      params.id,
      parsed.manualOffsetOverrideMs,
    );
    return json(res);
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid offset override request" }, { status: 400 });
  }
};
