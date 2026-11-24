import { redirect } from "@sveltejs/kit";
import { eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertAuthAvailable, loginUrlFor } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";
import { listPlayerTokens } from "$lib/server/auth/index.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  assertAuthAvailable(locals);
  if (!locals.player) redirect(302, loginUrlFor(url));
  const db = getDb();
  const [memberships, tokens] = await Promise.all([
    db.query.duoMemberships.findMany({
      where: eq(duoMemberships.playerId, locals.player.id),
    }),
    listPlayerTokens(db, locals.player.id),
  ]);
  const duoIds = memberships.map((m) => m.duoId);
  const playerDuos =
    duoIds.length > 0 ? await db.query.duos.findMany({ where: inArray(duos.id, duoIds) }) : [];

  return {
    player: locals.player,
    origin: url.origin,
    duos: playerDuos.map((d) => ({
      id: d.id,
      name: d.name,
      geoguessrTeamId: d.geoguessrTeamId,
      hotwords: d.hotwords,
    })),
    tokens: tokens.map((t) => ({
      id: t.id,
      scope: t.scope,
      label: t.label,
      tokenPrefix: t.tokenPrefix,
      expiresAt: t.expiresAt.toISOString(),
      revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
};
