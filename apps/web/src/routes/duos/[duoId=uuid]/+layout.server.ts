import { asc, eq, inArray } from "drizzle-orm";
import type { LayoutServerLoad } from "./$types";
import { assertDuoAccess, LAST_DUO_COOKIE } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos, players } from "$lib/server/db/schema.js";
import { resolvePlayerColors } from "$lib/player-color.js";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Duo chrome only (cheap): the guard, the Duo switcher list and last_duo. Pages load their own data. */
export const load: LayoutServerLoad = async ({ locals, params, url, cookies }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, player.id),
    columns: { duoId: true },
  });
  const memberDuos = await db.query.duos.findMany({
    where: inArray(
      duos.id,
      memberships.map((m) => m.duoId),
    ),
    columns: { id: true, name: true },
    orderBy: [asc(duos.name)],
  });
  const duo = memberDuos.find((d) => d.id === params.duoId)!;
  // The colour every page draws each of the Duo's Players in (#74), resolved for this viewer.
  const duoPlayerIds = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.duoId, duo.id),
    columns: { playerId: true },
  });
  const duoPlayers =
    duoPlayerIds.length > 0
      ? await db.query.players.findMany({
          where: inArray(
            players.id,
            duoPlayerIds.map((m) => m.playerId),
          ),
          columns: { id: true, color: true },
        })
      : [];
  const playerColors = resolvePlayerColors(duoPlayers, player.id);
  cookies.set(LAST_DUO_COOKIE, duo.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_S,
  });
  // The server time the page data was served: the stream's first open skips its catch-up unless the Duo changed since.
  return { player, duo, duos: memberDuos, playerColors, servedAt: Date.now() };
};
