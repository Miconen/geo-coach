import { asc, eq, inArray } from "drizzle-orm";
import {
  panoViewsByRound,
  type PanoView,
  type RawDuelPayload,
  type StatsCall,
  type StatsGame,
  type StatsPayload,
  type StatsRound,
  type StatsSession,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { duoMemberships, games, players, recordings, rounds } from "../db/schema.js";
import {
  deriveCurrentCallLabels,
  deriveLearningsWithStatus,
  isCallableRound,
  type CurrentCallLabel,
} from "../services/index.js";

/** A Round's Call (GLOSSARY: Call); null when unlabelled or not a Split or Spread. */
function roundCall(
  round: typeof rounds.$inferSelect,
  label: CurrentCallLabel | undefined,
): StatsCall | null {
  if (!label || !isCallableRound(round)) return null;
  return label.called ? "called" : "not-called";
}

/**
 * The compact payload the statistics page computes every panel from, in the
 * browser (ADR 0003). Opponents carry no nickname or GeoGuessr ID: only
 * `isDuo: false` tells them apart from the Duo's Players.
 */
export async function buildStatsPayload(db: AppDb, duoId: string): Promise<StatsPayload> {
  const callLabels = await deriveCurrentCallLabels(db, duoId);
  const [memberships, allRecordings, allGames, allRounds, derivedLearnings] = await Promise.all([
    db.query.duoMemberships.findMany({ where: eq(duoMemberships.duoId, duoId) }),
    db.query.recordings.findMany({ where: eq(recordings.duoId, duoId) }),
    db.query.games.findMany({ where: eq(games.duoId, duoId), orderBy: [asc(games.startedAt)] }),
    db.query.rounds.findMany({
      where: eq(rounds.duoId, duoId),
      orderBy: [asc(rounds.startTime), asc(rounds.roundNumber)],
    }),
    deriveLearningsWithStatus(db, duoId),
  ]);

  const playerIds = memberships.map((m) => m.playerId);
  const duoPlayers =
    playerIds.length > 0
      ? await db.query.players.findMany({ where: inArray(players.id, playerIds) })
      : [];

  // A Session spans its Recordings; a live Recording counts up to now (as in the workbench).
  const nowMs = Date.now();
  const boundsBySession = new Map<string, StatsSession>();
  for (const rec of allRecordings) {
    const startMs = rec.startedAt.getTime();
    const endMs = rec.stoppedAt ? rec.stoppedAt.getTime() : nowMs;
    const bounds = boundsBySession.get(rec.sessionId);
    if (bounds) {
      bounds.startedAtMs = Math.min(bounds.startedAtMs, startMs);
      bounds.endedAtMs = Math.max(bounds.endedAtMs, endMs);
    } else {
      boundsBySession.set(rec.sessionId, { id: rec.sessionId, startedAtMs: startMs, endedAtMs: endMs });
    }
  }
  const sessions = [...boundsBySession.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);

  const statsGames: StatsGame[] = allGames.map((g) => {
    const startMs = g.startedAt.getTime();
    const endMs = g.endedAt.getTime();
    const session = sessions.find((s) => s.startedAtMs < endMs && startMs < s.endedAtMs);
    return {
      id: g.id,
      startedAtMs: startMs,
      won: g.won,
      ratingBefore: g.duoRatingBefore,
      ratingAfter: g.duoRatingAfter,
      mapName: g.mapName,
      mode: g.mode,
      opponentRatingBefore: g.opponentRatingBefore,
      positionBefore: g.duoPositionBefore,
      positionAfter: g.duoPositionAfter,
      sessionId: session?.id ?? null,
    };
  });

  // Each Round's starting camera stays in the raw duel; no derived column holds it.
  const panoViews = new Map<string, Map<number, PanoView>>(
    allGames.map((g) => [g.id, panoViewsByRound(g.rawDuel as RawDuelPayload)]),
  );

  const statsRounds: StatsRound[] = allRounds.map((r) => {
    const roundStartMs = r.startTime.getTime();
    return {
      id: r.id,
      gameId: r.gameId,
      roundNumber: r.roundNumber,
      startedAtMs: roundStartMs,
      countryCode: r.countryCode,
      regionCode: r.regionCode,
      lat: r.lat,
      lng: r.lng,
      panoId: r.panoId,
      panoView: panoViews.get(r.gameId)?.get(r.roundNumber) ?? null,
      damageMultiplier: r.damageMultiplier,
      hpDelta: r.hpDelta,
      duoBestScore: r.duoBestScore,
      opponentBestScore: r.opponentBestScore,
      guesses: r.guesses.map((g) => {
        // jsonb gives back ISO strings where the derivation wrote Dates.
        const guessedAtMs = g.guessedAt ? new Date(g.guessedAt).getTime() : null;
        return {
          playerId: g.isDuo ? g.playerId : null,
          isDuo: g.isDuo,
          lat: g.lat,
          lng: g.lng,
          // Guesses derived before the geocoder existed lack these until a rebuild.
          countryCode: g.countryCode ?? null,
          regionCode: g.regionCode ?? null,
          distanceMeters: g.distanceMeters,
          score: g.score,
          guessedFirst: g.guessedFirst,
          isBestForTeam: g.isBestForTeam,
          // Rows derived before `timedOut` existed lack it until `db:rebuild-derived`.
          timedOut: g.timedOut ?? false,
          secondsToGuess:
            guessedAtMs !== null && !Number.isNaN(guessedAtMs)
              ? (guessedAtMs - roundStartMs) / 1000
              : null,
        };
      }),
      call: roundCall(r, callLabels.get(r.id)),
    };
  });

  return {
    duoId,
    players: duoPlayers.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      avatarColor: p.avatarColor,
    })),
    sessions,
    games: statsGames,
    rounds: statsRounds,
    learnings: derivedLearnings
      .filter((l) => l.status === "current" && !l.reactions.some((r) => r.reaction === "dismiss"))
      .map((l) => ({
        id: l.id,
        countryCodes: l.countries.map((c) => c.toUpperCase()),
        createdAtMs: l.createdAt.getTime(),
      })),
  };
}
