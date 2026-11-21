import { redirect } from "@sveltejs/kit";
import { eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.player) {
    redirect(302, "/login");
  }
  const db = getDb();
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, locals.player.id),
  });
  const duoIds = memberships.map((m) => m.duoId);
  const availableDuos =
    duoIds.length > 0 ? await db.query.duos.findMany({ where: inArray(duos.id, duoIds) }) : [];

  if (availableDuos.length === 0) {
    return {
      player: locals.player,
      availableDuos: [],
      workbench: null,
    };
  }

  const requestedDuoId = url.searchParams.get("duo");
  const activeDuo =
    availableDuos.find((d) => d.id === requestedDuoId) ?? availableDuos[0]!;

  const workbench = await buildWorkbenchData(db, activeDuo.id, locals.player.id);

  return {
    player: locals.player,
    availableDuos: availableDuos.map((d) => ({ id: d.id, name: d.name })),
    workbench,
  };
};
