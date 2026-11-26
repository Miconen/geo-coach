import { and, eq, inArray } from "drizzle-orm";
import { panoViewsByRound, type RawDuelPayload } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { games } from "../db/schema.js";
import type { DebriefGameMeta } from "./build.js";

export * from "./build.js";

/**
 * Each Game's mode, map and per-Round starting camera, for the given Games only: the debrief never reads the Duo-wide
 * Stats payload (#79).
 */
export async function loadDebriefMeta(db: AppDb, duoId: string, gameIds: readonly string[]): Promise<Map<string, DebriefGameMeta>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({ id: games.id, mode: games.mode, mapName: games.mapName, rawDuel: games.rawDuel })
    .from(games)
    .where(and(eq(games.duoId, duoId), inArray(games.id, [...gameIds])));
  return new Map(
    rows.map((g) => [g.id, { mode: g.mode, mapName: g.mapName, panoViews: panoViewsByRound(g.rawDuel as RawDuelPayload) }]),
  );
}
