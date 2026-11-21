import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { duos } from "$lib/server/db/schema.js";
import { assertPlayerInDuo, DomainError } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

const hotwordsSchema = z.object({
  hotwords: z.array(z.string().trim().min(1).max(80)).max(200),
});

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    await assertPlayerInDuo(db, locals.player.id, params.duoId);
    const parsed = hotwordsSchema.parse(await request.json());
    await db
      .update(duos)
      .set({ hotwords: parsed.hotwords })
      .where(eq(duos.id, params.duoId));
    duoEventBus.emitChanged(params.duoId, "hotwords", params.duoId);
    return json({ ok: true, hotwords: parsed.hotwords });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid hotwords payload" }, { status: 400 });
  }
};
