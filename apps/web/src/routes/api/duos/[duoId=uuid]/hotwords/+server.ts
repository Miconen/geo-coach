import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { duos } from "$lib/server/db/schema.js";
import { DomainError } from "$lib/server/services/index.js";
import { duoRoute } from "$lib/server/auth/guards.js";
import { duoEventBus } from "$lib/server/events/bus.js";

const hotwordsSchema = z.object({
  hotwords: z.array(z.string().trim().min(1).max(80)).max(200),
});

export const PUT: RequestHandler = duoRoute(async ({ request }, { db, duoId }) => {
  try {
    const parsed = hotwordsSchema.parse(await request.json());
    await db
      .update(duos)
      .set({ hotwords: parsed.hotwords })
      .where(eq(duos.id, duoId));
    duoEventBus.emitChanged(duoId, "hotwords", duoId);
    return json({ ok: true, hotwords: parsed.hotwords });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid hotwords payload" }, { status: 400 });
  }
});
