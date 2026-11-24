import { redirect } from "@sveltejs/kit";
import { asc, eq, inArray } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertAuthAvailable, LAST_DUO_COOKIE, loginUrlFor } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships, duos } from "$lib/server/db/schema.js";
import { findScopedRun } from "$lib/server/services/index.js";
import { isUuid } from "$lib/uuid.js";

/**
 * / (X1): to ?duo= when it is the Player's, else to the owning Duo of a bare ?run=, else the last Duo
 * (last_duo cookie), else the first member Duo; other params are forwarded. A malformed or unresolvable ?run=
 * is dropped (never a 404). With no Duo at all, the page shows the 0-Duo state.
 */
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  assertAuthAvailable(locals);
  if (!locals.player) redirect(302, loginUrlFor(url));
  const db = getDb();
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, locals.player.id),
    columns: { duoId: true },
  });
  const memberDuos =
    memberships.length > 0
      ? await db.query.duos.findMany({
          where: inArray(
            duos.id,
            memberships.map((m) => m.duoId),
          ),
          columns: { id: true },
          orderBy: [asc(duos.name)],
        })
      : [];
  if (memberDuos.length === 0) return { player: locals.player };
  const duoIds = memberDuos.map((d) => d.id);

  const forward = new URLSearchParams(url.searchParams);
  forward.delete("duo");
  const requested = url.searchParams.get("duo");
  let target = requested && duoIds.includes(requested) ? requested : null;

  const runParam = url.searchParams.get("run");
  if (runParam !== null) {
    if (!isUuid(runParam)) forward.delete("run");
    else if (!target) {
      // A bare ?run= opens in its own Duo when the Player belongs to it; otherwise it is dropped.
      const run = await findScopedRun(db, runParam);
      if (run && duoIds.includes(run.duoId)) target = run.duoId;
      else forward.delete("run");
    }
  }
  if (!target) {
    const last = cookies.get(LAST_DUO_COOKIE);
    target = last && duoIds.includes(last) ? last : duoIds[0]!;
  }
  redirect(302, `/duos/${target}/review${forward.size > 0 ? `?${forward}` : ""}`);
};
