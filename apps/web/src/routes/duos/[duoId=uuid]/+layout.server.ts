import { asc, eq, inArray } from "drizzle-orm";
import type { LayoutServerLoad } from "./$types";
import { assertDuoAccess, LAST_DUO_COOKIE } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";

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
  cookies.set(LAST_DUO_COOKIE, duo.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_S,
  });
  return { player, duo, duos: memberDuos };
};
