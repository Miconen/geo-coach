import { error, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertAuthAvailable, LAST_DUO_COOKIE, loginUrlFor } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { duoMemberships } from "$lib/server/db/schema.js";

// Legacy /stats (X1): to /duos/[id]/stats with every param but duo. A bare /stats follows /'s last_duo rule;
// a foreign or malformed ?duo= keeps its 404.
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  assertAuthAvailable(locals);
  if (!locals.player) redirect(302, loginUrlFor(url));
  const memberships = await getDb().query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, locals.player.id),
    columns: { duoId: true },
  });
  const duoIds = memberships.map((m) => m.duoId);
  const requested = url.searchParams.get("duo");
  let target: string | undefined;
  if (requested !== null) {
    if (!duoIds.includes(requested)) error(404, "Duo not found");
    target = requested;
  } else {
    const last = cookies.get(LAST_DUO_COOKIE);
    target = last && duoIds.includes(last) ? last : duoIds[0];
    if (!target) redirect(302, "/");
  }
  const params = new URLSearchParams(url.searchParams);
  params.delete("duo");
  redirect(302, `/duos/${target}/stats${params.size > 0 ? `?${params}` : ""}`);
};
