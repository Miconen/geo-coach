import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { reactionTypeSchema } from "@geo-coach/shared";
import { getDb } from "$lib/server/db/index.js";
import { learnings } from "$lib/server/db/schema.js";
import { assertPlayerInDuo, toggleReaction, DomainError } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { reaction?: unknown };
    const reaction = reactionTypeSchema.parse(body.reaction);
    const db = getDb();
    const learning = await db.query.learnings.findFirst({
      where: eq(learnings.id, params.id),
    });
    if (!learning) return json({ error: "Learning not found" }, { status: 404 });
    await assertPlayerInDuo(db, locals.player.id, learning.duoId);
    const res = await toggleReaction(db, learning.id, locals.player.id, reaction);
    duoEventBus.emitChanged(learning.duoId, "reaction", learning.id);
    return json(res);
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid reaction request" }, { status: 400 });
  }
};
