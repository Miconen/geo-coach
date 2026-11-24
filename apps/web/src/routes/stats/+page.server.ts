import { error, redirect } from "@sveltejs/kit";
import { eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertAuthAvailable, loginUrlFor } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";
import { buildStatsPayload } from "$lib/server/stats/payload.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  assertAuthAvailable(locals);
  if (!locals.player) redirect(302, loginUrlFor(url));
  const db = getDb();
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, locals.player.id),
  });
  const duoIds = memberships.map((m) => m.duoId);
  const availableDuos =
    duoIds.length > 0 ? await db.query.duos.findMany({ where: inArray(duos.id, duoIds) }) : [];

  const requestedDuoId = url.searchParams.get("duo");
  if (!requestedDuoId) {
    const first = availableDuos[0];
    if (!first) redirect(302, "/");
    const params = new URLSearchParams(url.searchParams);
    params.set("duo", first.id);
    redirect(302, `/stats?${params}`);
  }

  // Only Players of the Duo may see its statistics; anyone else gets the same answer as a missing Duo.
  const duo = availableDuos.find((d) => d.id === requestedDuoId);
  if (!duo) error(404, "Duo not found");

  return {
    player: locals.player,
    duo: { id: duo.id, name: duo.name },
    stats: await buildStatsPayload(db, duo.id),
  };
};
