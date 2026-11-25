import { redirect } from "@sveltejs/kit";
import { eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertAuthAvailable, loginUrlFor } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos, players } from "$lib/server/db/schema.js";
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
  const [playerDuos, duoMembers] =
    duoIds.length > 0
      ? await Promise.all([
          db.query.duos.findMany({ where: inArray(duos.id, duoIds) }),
          db.query.duoMemberships.findMany({ where: inArray(duoMemberships.duoId, duoIds), columns: { playerId: true } }),
        ])
      : [[], []];
  // Duo partners' colour choices (#74), so the picker can say when a partner chose the same one.
  const partnerIds = [...new Set(duoMembers.map((m) => m.playerId))].filter((id) => id !== locals.player!.id);
  const partners =
    partnerIds.length > 0
      ? await db.query.players.findMany({
          where: inArray(players.id, partnerIds),
          columns: { id: true, displayName: true, color: true },
        })
      : [];

  return {
    player: locals.player,
    origin: url.origin,
    partners,
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
