import { readFile } from "node:fs/promises";
import { uuidv7 } from "@geo-coach/shared";
import { getDb } from "./index.js";
import { duoMemberships, duos, players } from "./schema.js";

interface SeedConfig {
  duos: Array<{
    name: string;
    geoguessrTeamId: string;
    targetRating?: number;
    targetDivision?: string;
    hotwords?: string[];
  }>;
  players: Array<{
    discordId: string;
    displayName: string;
    geoguessrUserId?: string;
    geoguessrName?: string;
    avatarColor?: string;
    duoTeamIds: string[];
  }>;
}

const DEFAULT_DEV_SEED: SeedConfig = {
  duos: [
    {
      name: "Road to Champ",
      geoguessrTeamId: "gg_team_dev_duo",
      targetRating: 1200,
      targetDivision: "Champion (1200)",
      hotwords: ["Bulgaria", "Plovdiv", "Romania", "Bollards", "Rondônia", "Kabupaten"],
    },
  ],
  players: [
    {
      discordId: "dev_discord_1",
      displayName: "Miko",
      geoguessrUserId: "gg_dev_p1",
      geoguessrName: "MikoGeo",
      avatarColor: "#2563eb",
      duoTeamIds: ["gg_team_dev_duo"],
    },
    {
      discordId: "dev_discord_2",
      displayName: "Sora",
      geoguessrUserId: "gg_dev_p2",
      geoguessrName: "SoraMaps",
      avatarColor: "#7c3aed",
      duoTeamIds: ["gg_team_dev_duo"],
    },
  ],
};

async function main() {
  const configPath = process.env.SEED_CONFIG_PATH;
  const cfg: SeedConfig = configPath
    ? (JSON.parse(await readFile(configPath, "utf8")) as SeedConfig)
    : DEFAULT_DEV_SEED;

  const db = getDb();
  const duoIdByTeamId = new Map<string, string>();

  for (const d of cfg.duos) {
    const existing = await db.query.duos.findFirst({
      where: (t, { eq }) => eq(t.geoguessrTeamId, d.geoguessrTeamId),
    });
    if (existing) {
      duoIdByTeamId.set(d.geoguessrTeamId, existing.id);
    } else {
      const id = uuidv7();
      await db.insert(duos).values({
        id,
        name: d.name,
        geoguessrTeamId: d.geoguessrTeamId,
        targetRating: d.targetRating ?? 1200,
        targetDivision: d.targetDivision ?? "Champion (1200)",
        hotwords: d.hotwords ?? [],
      });
      duoIdByTeamId.set(d.geoguessrTeamId, id);
    }
  }

  for (const p of cfg.players) {
    const existing = await db.query.players.findFirst({
      where: (t, { eq }) => eq(t.discordId, p.discordId),
    });
    const playerId = existing?.id ?? uuidv7();
    if (!existing) {
      await db.insert(players).values({
        id: playerId,
        discordId: p.discordId,
        displayName: p.displayName,
        geoguessrUserId: p.geoguessrUserId ?? null,
        geoguessrName: p.geoguessrName ?? null,
        avatarColor: p.avatarColor ?? "#2563eb",
      });
    }
    for (const teamId of p.duoTeamIds) {
      const duoId = duoIdByTeamId.get(teamId);
      if (!duoId) continue;
      await db
        .insert(duoMemberships)
        .values({ duoId, playerId })
        .onConflictDoNothing();
    }
  }

  console.log(`Seeded ${cfg.duos.length} Duo(s) and ${cfg.players.length} Player(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
