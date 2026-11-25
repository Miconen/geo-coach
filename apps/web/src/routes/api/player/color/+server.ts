import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { assertAuthAvailable } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, players } from "$lib/server/db/schema.js";
import { duoEventBus } from "$lib/server/events/bus.js";
import { isPlayerColorKey } from "$lib/player-color.js";

// The signed-in Player's colour (#74): a PLAYER_PALETTE key, or null to go back to the default.
const colorSchema = z.object({ color: z.string().refine(isPlayerColorKey).nullable() });

export const PUT: RequestHandler = async ({ locals, request }) => {
  assertAuthAvailable(locals);
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  const parsed = colorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Unknown colour" }, { status: 400 });
  const db = getDb();
  await db.update(players).set({ color: parsed.data.color }).where(eq(players.id, locals.player.id));
  // Both Players of each Duo see the new colour: cached derivations and open pages refresh.
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, locals.player.id),
    columns: { duoId: true },
  });
  for (const m of memberships) duoEventBus.emitChanged(m.duoId, "player", locals.player.id);
  return json({ ok: true, color: parsed.data.color });
};
