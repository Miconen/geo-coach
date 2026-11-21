import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { getDiscordClient, isDevLoginEnabled } from "$lib/server/auth/index.js";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.player) {
    redirect(302, "/");
  }
  const devEnabled = isDevLoginEnabled();
  const seededPlayers = devEnabled ? await getDb().query.players.findMany() : [];
  return {
    discordConfigured: getDiscordClient() !== null,
    devEnabled,
    seededPlayers: seededPlayers.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      geoguessrName: p.geoguessrName,
    })),
  };
};
