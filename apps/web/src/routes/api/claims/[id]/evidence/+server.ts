import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { assertAuthAvailable } from "$lib/server/auth/guards.js";
import { playerEvidenceInputSchema } from "@geo-coach/shared";
import { getDb } from "$lib/server/db/index.js";
import { DomainError, setPlayerEvidence } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

/**
 * Sets the signed-in Player's own ✓ (`for`) or ✗ (`against`) on a Claim, or
 * withdraws it with `direction: null`. Never touches another Player's Evidence.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAuthAvailable(locals);
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { direction } = playerEvidenceInputSchema.parse(await request.json());
    const res = await setPlayerEvidence(getDb(), locals.player.id, params.id, direction);
    duoEventBus.emitChanged(res.duoId, "claim", params.id);
    return json({ direction: res.direction });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Invalid Evidence request" }, { status: 400 });
  }
};
