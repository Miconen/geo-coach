import { error, redirect } from "@sveltejs/kit";
import { eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";
import { findScopedRun } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { isUuid } from "$lib/uuid.js";

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
      selectedRunId: null,
    };
  }

  const requestedDuoId = url.searchParams.get("duo");
  // ?run= (X2): malformed, missing or outside the requested Duo is a 404; a bare ?run= resolves its owning Duo.
  const requestedRunId = url.searchParams.get("run");
  let runDuoId: string | null = null;
  if (requestedRunId !== null) {
    if (!isUuid(requestedRunId)) error(404, "Run not found");
    const run = await findScopedRun(db, requestedRunId);
    if (!run || !duoIds.includes(run.duoId)) error(404, "Run not found");
    if (requestedDuoId && run.duoId !== requestedDuoId) error(404, "Run not found");
    runDuoId = run.duoId;
  }
  const activeDuo =
    availableDuos.find((d) => d.id === (runDuoId ?? requestedDuoId)) ?? availableDuos[0]!;

  const workbench = await buildWorkbenchData(db, activeDuo.id, locals.player.id, {
    runId: requestedRunId,
  });

  return {
    player: locals.player,
    availableDuos: availableDuos.map((d) => ({ id: d.id, name: d.name })),
    workbench,
    selectedRunId: requestedRunId,
  };
};
