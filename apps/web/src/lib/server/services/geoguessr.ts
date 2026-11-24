import { and, eq, inArray } from "drizzle-orm";
import {
  deriveGameFromRawDuel,
  uuidv7,
  type Geocoder,
  type GeoguessrMissingRequest,
  type UploadGameRequest,
  type UploadReplayRequest,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { duoMemberships, duos, games, players, replays, rounds } from "../db/schema.js";
import { naturalEarthGeocoder } from "../geocoder/index.js";
import { DomainError } from "./recordings.js";

async function loadDuoPlayerMap(db: AppDb, duoId: string): Promise<{
  geoguessrTeamId: string;
  playerByGeoguessrId: Record<string, string>;
}> {
  const duo = await db.query.duos.findFirst({ where: eq(duos.id, duoId) });
  if (!duo) {
    throw new DomainError("NOT_FOUND", "Duo not found", 404);
  }
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.duoId, duoId),
  });
  const duoPlayerIds = memberships.map((m) => m.playerId);
  const duoPlayers =
    duoPlayerIds.length > 0
      ? await db.query.players.findMany({ where: inArray(players.id, duoPlayerIds) })
      : [];

  const playerByGeoguessrId: Record<string, string> = {};
  for (const p of duoPlayers) {
    if (p.geoguessrUserId) {
      playerByGeoguessrId[p.geoguessrUserId] = p.id;
    }
  }
  return { geoguessrTeamId: duo.geoguessrTeamId, playerByGeoguessrId };
}

export async function upsertRawGame(
  db: AppDb,
  input: UploadGameRequest,
  geocoder?: Geocoder,
): Promise<{ gameId: string; created: boolean; roundCount: number }> {
  const { geoguessrTeamId, playerByGeoguessrId } = await loadDuoPlayerMap(db, input.duoId);
  const derived = deriveGameFromRawDuel(
    input.rawDuel,
    geoguessrTeamId,
    playerByGeoguessrId,
    geocoder ?? (await naturalEarthGeocoder()),
  );

  const existing = await db.query.games.findFirst({
    where: and(
      eq(games.duoId, input.duoId),
      eq(games.geoguessrGameId, input.geoguessrGameId),
    ),
  });

  const gameId = existing?.id ?? uuidv7(derived.startedAt.getTime());

  if (existing) {
    await db
      .update(games)
      .set({
        rawDuel: input.rawDuel,
        fetchedAt: new Date(input.fetchedAt),
        startedAt: derived.startedAt,
        endedAt: derived.endedAt,
        won: derived.won,
        duoRatingBefore: derived.duoRatingBefore,
        duoRatingAfter: derived.duoRatingAfter,
        duoPositionBefore: derived.duoPositionBefore,
        duoPositionAfter: derived.duoPositionAfter,
        winStreak: derived.winStreak,
        duoFinalHealth: derived.duoFinalHealth,
        opponentFinalHealth: derived.opponentFinalHealth,
        opponentTeamName: derived.opponentTeamName,
        opponentRatingBefore: derived.opponentRatingBefore,
        mapName: derived.mapName,
        mode: derived.mode,
        roundCount: derived.roundCount,
      })
      .where(eq(games.id, gameId));
  } else {
    await db.insert(games).values({
      id: gameId,
      duoId: input.duoId,
      geoguessrGameId: input.geoguessrGameId,
      rawDuel: input.rawDuel,
      fetchedAt: new Date(input.fetchedAt),
      startedAt: derived.startedAt,
      endedAt: derived.endedAt,
      won: derived.won,
      duoRatingBefore: derived.duoRatingBefore,
      duoRatingAfter: derived.duoRatingAfter,
      duoPositionBefore: derived.duoPositionBefore,
      duoPositionAfter: derived.duoPositionAfter,
      winStreak: derived.winStreak,
      duoFinalHealth: derived.duoFinalHealth,
      opponentFinalHealth: derived.opponentFinalHealth,
      opponentTeamName: derived.opponentTeamName,
      opponentRatingBefore: derived.opponentRatingBefore,
      mapName: derived.mapName,
      mode: derived.mode,
      roundCount: derived.roundCount,
    });
  }

  // Upsert derived Rounds (preserving round ids if already present so explicit Learning->Round links survive rebuilds)
  const existingRounds = await db.query.rounds.findMany({
    where: eq(rounds.gameId, gameId),
  });
  const roundIdByNumber = new Map(existingRounds.map((r) => [r.roundNumber, r.id]));

  for (const r of derived.rounds) {
    const existingRoundId = roundIdByNumber.get(r.roundNumber);
    if (existingRoundId) {
      await db
        .update(rounds)
        .set({
          countryCode: r.countryCode,
          regionCode: r.regionCode,
          lat: r.lat,
          lng: r.lng,
          panoId: r.panoId,
          damageMultiplier: r.damageMultiplier,
          startTime: r.startTime,
          timerStartTime: r.timerStartTime,
          endTime: r.endTime,
          resultsEndTime: r.resultsEndTime,
          phases: r.phases,
          duoBestScore: r.duoBestScore,
          opponentBestScore: r.opponentBestScore,
          hpDelta: r.hpDelta,
          guesses: r.guesses,
        })
        .where(eq(rounds.id, existingRoundId));
    } else {
      await db.insert(rounds).values({
        id: uuidv7(r.startTime.getTime()),
        gameId,
        duoId: input.duoId,
        roundNumber: r.roundNumber,
        countryCode: r.countryCode,
        regionCode: r.regionCode,
        lat: r.lat,
        lng: r.lng,
        panoId: r.panoId,
        damageMultiplier: r.damageMultiplier,
        startTime: r.startTime,
        timerStartTime: r.timerStartTime,
        endTime: r.endTime,
        resultsEndTime: r.resultsEndTime,
        phases: r.phases,
        duoBestScore: r.duoBestScore,
        opponentBestScore: r.opponentBestScore,
        hpDelta: r.hpDelta,
        guesses: r.guesses,
      });
    }
  }

  return { gameId, created: !existing, roundCount: derived.roundCount };
}

export async function rebuildDerivedGamesForDuo(db: AppDb, duoId: string): Promise<number> {
  const allGames = await db.query.games.findMany({ where: eq(games.duoId, duoId) });
  for (const g of allGames) {
    await upsertRawGame(db, {
      duoId,
      geoguessrGameId: g.geoguessrGameId,
      fetchedAt: g.fetchedAt.toISOString(),
      rawDuel: g.rawDuel,
    });
  }
  return allGames.length;
}

export async function upsertRawReplay(
  db: AppDb,
  input: UploadReplayRequest,
): Promise<{ replayId: string; hasEvents: boolean; gameId: string }> {
  const game = await db.query.games.findFirst({
    where: and(
      eq(games.duoId, input.duoId),
      eq(games.geoguessrGameId, input.geoguessrGameId),
    ),
  });
  if (!game) {
    throw new DomainError("NOT_FOUND", "Game must be uploaded before its replays", 404);
  }

  const hasEvents = input.rawEvents.length > 0;
  const existing = await db.query.replays.findFirst({
    where: and(
      eq(replays.gameId, game.id),
      eq(replays.geoguessrPlayerId, input.geoguessrPlayerId),
      eq(replays.roundNumber, input.roundNumber),
    ),
  });

  if (existing) {
    await db
      .update(replays)
      .set({
        rawEvents: input.rawEvents,
        hasEvents,
        fetchedAt: new Date(input.fetchedAt),
      })
      .where(eq(replays.id, existing.id));
    return { replayId: existing.id, hasEvents, gameId: game.id };
  }

  const replayId = uuidv7();
  await db.insert(replays).values({
    id: replayId,
    gameId: game.id,
    duoId: input.duoId,
    geoguessrGameId: input.geoguessrGameId,
    geoguessrPlayerId: input.geoguessrPlayerId,
    roundNumber: input.roundNumber,
    rawEvents: input.rawEvents,
    hasEvents,
    fetchedAt: new Date(input.fetchedAt),
  });
  return { replayId, hasEvents, gameId: game.id };
}

export async function findMissingGeoguessrData(
  db: AppDb,
  input: GeoguessrMissingRequest,
): Promise<{
  missingGameIds: string[];
  missingReplays: Array<{ geoguessrGameId: string; geoguessrPlayerId: string; roundNumber: number }>;
}> {
  const existingGames =
    input.gameIds.length > 0
      ? await db
          .select({ geoguessrGameId: games.geoguessrGameId })
          .from(games)
          .where(and(eq(games.duoId, input.duoId), inArray(games.geoguessrGameId, input.gameIds)))
      : [];
  const haveGames = new Set(existingGames.map((g) => g.geoguessrGameId));
  const missingGameIds = input.gameIds.filter((id) => !haveGames.has(id));

  let allCandidates = [...input.replayCandidates];
  if (input.includeStoredReplayBackfill) {
    const storedGames = await db.query.games.findMany({
      where: eq(games.duoId, input.duoId),
    });
    for (const g of storedGames) {
      const raw = g.rawDuel as {
        teams?: Array<{ players?: Array<{ playerId?: string }> }>;
        rounds?: Array<{ roundNumber?: number }>;
      };
      const playerIds = (raw.teams ?? []).flatMap((t) =>
        (t.players ?? []).map((p) => p.playerId).filter((id): id is string => Boolean(id)),
      );
      const roundNumbers = (raw.rounds ?? [])
        .map((r) => r.roundNumber)
        .filter((n): n is number => typeof n === "number");
      for (const roundNumber of roundNumbers) {
        for (const geoguessrPlayerId of playerIds) {
          allCandidates.push({
            geoguessrGameId: g.geoguessrGameId,
            geoguessrPlayerId,
            roundNumber,
          });
        }
      }
    }
  }

  let missingReplays: GeoguessrMissingRequest["replayCandidates"] = [];
  if (allCandidates.length > 0) {
    const existingReplays = await db
      .select({
        geoguessrGameId: replays.geoguessrGameId,
        geoguessrPlayerId: replays.geoguessrPlayerId,
        roundNumber: replays.roundNumber,
      })
      .from(replays)
      .where(eq(replays.duoId, input.duoId));

    const haveReplays = new Set(
      existingReplays.map((r) => `${r.geoguessrGameId}:${r.geoguessrPlayerId}:${r.roundNumber}`),
    );
    const seen = new Set<string>();
    missingReplays = allCandidates.filter((c) => {
      const key = `${c.geoguessrGameId}:${c.geoguessrPlayerId}:${c.roundNumber}`;
      if (haveReplays.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { missingGameIds, missingReplays };
}
