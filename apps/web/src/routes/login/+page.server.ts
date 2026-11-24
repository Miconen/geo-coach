import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { getDiscordClient, isDevLoginEnabled } from "$lib/server/auth/index.js";
import { safeNext } from "$lib/server/auth/guards.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  // Only a same-origin relative path survives as next (open-redirect safe).
  const next = safeNext(url.searchParams.get("next"));
  if (locals.player) {
    redirect(302, next);
  }
  const devEnabled = isDevLoginEnabled();
  const seededPlayers = devEnabled ? await getDb().query.players.findMany() : [];
  return {
    discordConfigured: getDiscordClient() !== null,
    devEnabled,
    next,
    seededPlayers: seededPlayers.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      geoguessrName: p.geoguessrName,
    })),
  };
};
