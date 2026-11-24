import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { loadClaimPayload } from "$lib/server/entities/index.js";
import { assertUuid } from "$lib/uuid.js";

// One Claim for Review's drawer (#56 3b): malformed id 400; another Duo's or a deleted Claim 404 ("no longer exists").
export const GET: RequestHandler = duoRoute(async ({ params }, { db, player, duoId }) => {
  const claimId = assertUuid(params.claimId, "claimId");
  const payload = await loadClaimPayload(db, duoId, player.id, claimId);
  if (!payload) return json({ error: "Claim not found" }, { status: 404 });
  return json(payload);
});
