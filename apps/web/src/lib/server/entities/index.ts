import { and, eq } from "drizzle-orm";
import type { AppDb } from "../db/index.js";
import { games, rounds, sessions } from "../db/schema.js";
import { roundInDuo } from "../services/index.js";
import { loadWorkbench } from "../workbench/cache.js";
import {
  type WorkbenchData,
  type WorkbenchGame,
  type WorkbenchLearning,
  type WorkbenchRound,
  type WorkbenchSession,
  type WorkbenchUtterance,
} from "../workbench/view-model.js";
import { loadSessionRunsPage, type SessionRunsPage } from "./session-runs.js";
import { loadGameRuns, type GameRun } from "./game-runs.js";
import { loadRoundSpeech } from "./round-speech.js";
import { buildDebrief, loadDebriefMeta } from "../debrief/load.js";
import { numberInPlayOrder } from "$lib/game-number.js";
import type { Debrief } from "$lib/debrief/types.js";

export * from "./session-runs.js";
export * from "./game-runs.js";
export * from "./round-speech.js";

/**
 * Entity payloads for the Game, Round and Session pages and their /refresh endpoints (#56 2a). Each is a slice of
 * the Duo-wide Review derivation (buildWorkbenchData), so pages and Review always agree on windows, supersession
 * and Session links. The slice keeps WorkbenchData's lookup shape, so the shared components render it unchanged.
 */
export type EntityWorkbench = Pick<
  WorkbenchData,
  "duo" | "players" | "liveStatuses" | "gamesById" | "roundsById" | "utterancesById" | "claimsById" | "processing"
> & {
  learnings: WorkbenchLearning[];
  utterances: WorkbenchUtterance[];
  sessions: WorkbenchSession[];
  claims: WorkbenchData["claims"];
};

export interface SessionChip {
  id: string;
  startedAt: string;
}

export interface GameChip {
  id: string;
  startedAt: string;
  opponentTeamName: string | null;
  won: WorkbenchGame["won"];
}

export interface GamePayload {
  kind: "game";
  game: WorkbenchGame;
  /** Sessions whose Recordings overlap the Game (relationship bounds), both ways reciprocal with the Session page. */
  sessions: SessionChip[];
  /** Sessions related only by citation (a Learning of that Session cites one of this Game's Rounds). */
  relatedSessions: SessionChip[];
  /** Runs listed on the Game page, with run-wide and Game-scoped counts. */
  runs: GameRun[];
  wb: EntityWorkbench;
}

export interface RoundPayload {
  kind: "round";
  game: WorkbenchGame;
  round: WorkbenchRound;
  /** Linkable (X7): only positive Round numbers get their own page. */
  linkable: boolean;
  /** Claims with Evidence on this Round. */
  citingClaimIds: string[];
  sessions: SessionChip[];
  wb: EntityWorkbench;
}

export interface SessionPayload {
  kind: "session";
  session: WorkbenchSession;
  /** Games whose bounds overlap this Session's Recordings. */
  games: GameChip[];
  /** Games related only by citation (this Session's Learnings cite their Rounds). */
  relatedGames: GameChip[];
  runs: SessionRunsPage;
  wb: EntityWorkbench;
  /** The map-first debrief of the Session's Games (#79). */
  debrief: Debrief;
}

const chipOfGame = (g: WorkbenchGame): GameChip => ({
  id: g.id,
  startedAt: g.startedAt,
  opponentTeamName: g.opponentTeamName,
  won: g.won,
});

function slice(
  full: WorkbenchData,
  keep: { gameIds: Set<string>; sessionIds: Set<string>; learningIds?: Set<string> },
): EntityWorkbench {
  const gamesById: WorkbenchData["gamesById"] = {};
  const roundsById: WorkbenchData["roundsById"] = {};
  for (const gid of keep.gameIds) {
    const g = full.gamesById[gid];
    if (!g) continue;
    gamesById[gid] = g;
    for (const rid of g.roundIds) {
      const r = full.roundsById[rid];
      if (r) roundsById[rid] = r;
    }
  }
  const learnings = full.learnings.filter(
    (l) =>
      keep.learningIds?.has(l.id) ||
      l.roundIds.some((rid) => roundsById[rid]) ||
      l.sessionIds.some((sid) => keep.sessionIds.has(sid)),
  );
  // Learnings cite Rounds of other Games too: keep those Rounds and Games so chips resolve.
  for (const l of learnings) {
    for (const rid of l.roundIds) {
      const r = full.roundsById[rid];
      if (!r) continue;
      roundsById[rid] = r;
      const g = full.gamesById[r.gameId];
      if (g) gamesById[g.id] = g;
    }
  }
  const utteranceIds = new Set<string>();
  for (const r of Object.values(roundsById)) for (const id of r.utteranceIds) utteranceIds.add(id);
  for (const l of learnings) for (const id of l.utteranceIds) utteranceIds.add(id);
  const utterances = full.utterances.filter(
    (u) => utteranceIds.has(u.id) || (keep.sessionIds.has(u.sessionId) && !u.historical),
  );
  const utterancesById: WorkbenchData["utterancesById"] = {};
  for (const u of utterances) utterancesById[u.id] = u;
  for (const id of utteranceIds) {
    const u = full.utterancesById[id];
    if (u) utterancesById[id] = u;
  }
  const claimIds = new Set(learnings.flatMap((l) => (l.claimId ? [l.claimId] : [])));
  for (const c of full.claims) if (c.evidence.some((e) => e.roundId && roundsById[e.roundId])) claimIds.add(c.id);
  const claims = full.claims.filter((c) => claimIds.has(c.id));
  const claimsById: WorkbenchData["claimsById"] = {};
  for (const c of claims) claimsById[c.id] = c;
  return {
    duo: full.duo,
    players: full.players,
    liveStatuses: full.liveStatuses,
    gamesById,
    roundsById,
    utterancesById,
    claimsById,
    claims,
    processing: full.processing,
    learnings,
    utterances,
    sessions: full.sessions.filter((s) => keep.sessionIds.has(s.id)),
  };
}

function sessionChip(full: WorkbenchData, id: string, fallbackStartedAt?: string): SessionChip | null {
  const s = full.sessions.find((x) => x.id === id);
  if (s) return { id, startedAt: s.startedAt };
  return fallbackStartedAt ? { id, startedAt: fallbackStartedAt } : null;
}

/** Null when the Game is not this Duo's. */
export async function loadGamePayload(
  db: AppDb,
  duoId: string,
  playerId: string,
  gameId: string,
): Promise<GamePayload | null> {
  const [row] = await db.select({ id: games.id }).from(games).where(and(eq(games.id, gameId), eq(games.duoId, duoId)));
  if (!row) return null;
  // Cited speech, as the Games list reads it: the Game page shows no Round speech, so both share one cache entry.
  const full = await loadWorkbench(db, duoId, playerId, { speech: "cited" });
  const game = full.gamesById[gameId];
  if (!game) return null;
  const overlap = full.sessions.filter((s) => s.gameIds.includes(gameId)).map((s) => s.id);
  const overlapSet = new Set(overlap);
  const roundIds = new Set(game.roundIds);
  const cited = new Set<string>();
  for (const l of full.learnings) {
    if (!l.roundIds.some((rid) => roundIds.has(rid))) continue;
    for (const sid of l.sessionIds) if (!overlapSet.has(sid)) cited.add(sid);
  }
  return {
    kind: "game",
    game,
    sessions: overlap.flatMap((id) => sessionChip(full, id) ?? []),
    relatedSessions: [...cited].flatMap((id) => sessionChip(full, id) ?? []),
    runs: await loadGameRuns(db, duoId, game, full),
    wb: slice(full, { gameIds: new Set([gameId]), sessionIds: new Set(overlap) }),
  };
}

/** Null when the Round is not this Duo's (Round, its Game and the Duo must agree). */
export async function loadRoundPayload(
  db: AppDb,
  duoId: string,
  playerId: string,
  roundId: string,
): Promise<RoundPayload | null> {
  const [row] = await db
    .select({ id: rounds.id, gameId: rounds.gameId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), roundInDuo(duoId)));
  if (!row) return null;
  // The cited-speech derivation the Game page shares, plus this Round's full speech loaded on its own.
  const full = await loadWorkbench(db, duoId, playerId, { speech: "cited" });
  const cited = full.roundsById[roundId];
  const game = cited ? full.gamesById[cited.gameId] : undefined;
  if (!cited || !game) return null;
  const speech = await loadRoundSpeech(db, duoId, roundId, full);
  const round: WorkbenchRound = { ...cited, utteranceIds: speech.utteranceIds };
  const sessionIds = full.sessions.filter((s) => s.gameIds.includes(game.id)).map((s) => s.id);
  const wb = slice(full, { gameIds: new Set([game.id]), sessionIds: new Set(sessionIds) });
  wb.roundsById[roundId] = round;
  wb.utterancesById = { ...wb.utterancesById, ...speech.utterancesById };
  const known = new Set(wb.utterances.map((u) => u.id));
  wb.utterances = [...wb.utterances, ...Object.values(speech.utterancesById).filter((u) => !known.has(u.id))];
  return {
    kind: "round",
    game,
    round,
    linkable: round.roundNumber > 0,
    citingClaimIds: wb.claims.filter((c) => c.evidence.some((e) => e.roundId === roundId)).map((c) => c.id),
    sessions: sessionIds.flatMap((id) => sessionChip(full, id) ?? []),
    wb,
  };
}

/** Finds a Game's Round by its stored number (X7: numbers as stored; the page's matcher admits only n > 0). */
export async function findRoundIdByNumber(
  db: AppDb,
  duoId: string,
  gameId: string,
  roundNumber: number,
): Promise<string | null> {
  const [row] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.gameId, gameId), eq(rounds.roundNumber, roundNumber), roundInDuo(duoId)));
  return row?.id ?? null;
}

/** Null when the Session is not this Duo's. ?run= (runId) is a pin: malformed, missing or foreign is dropped. */
export async function loadSessionPayload(
  db: AppDb,
  duoId: string,
  playerId: string,
  sessionId: string,
  runId: string | null,
): Promise<SessionPayload | null> {
  const [row] = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.duoId, duoId)));
  if (!row) return null;
  const [full, runs] = await Promise.all([
    loadWorkbench(db, duoId, playerId, { sessionId }),
    loadSessionRunsPage(db, duoId, sessionId, { cursor: null, purpose: null, noop: false, runId }),
  ]);
  const session: WorkbenchSession = full.sessions.find((s) => s.id === sessionId) ?? {
    // A Recording-less Session (runs only): an empty Transcript.
    id: sessionId,
    startedAt: row.createdAt.toISOString(),
    endedAt: row.createdAt.toISOString(),
    ended: true,
    playerIds: [],
    micCount: 0,
    gameIds: [],
    recordingIds: [],
    stoppedRecordingIds: [],
    ratingDelta: 0,
    extractWorkCount: 0,
    tipsWorkCount: 0,
    status: "up-to-date",
    workRanges: [],
    deletedRanges: [],
  };
  const overlap = new Set(session.gameIds);
  const cited = new Set<string>();
  for (const l of full.learnings) {
    if (!l.sessionIds.includes(sessionId)) continue;
    for (const rid of l.roundIds) {
      const gid = full.roundsById[rid]?.gameId;
      if (gid && !overlap.has(gid)) cited.add(gid);
    }
  }
  const wb = slice(full, { gameIds: overlap, sessionIds: new Set([sessionId]) });
  if (!wb.sessions.some((s) => s.id === sessionId)) wb.sessions = [session, ...wb.sessions];
  // The debrief names no Opponent team (#79): the page never receives one.
  wb.gamesById = Object.fromEntries(Object.entries(wb.gamesById).map(([id, g]) => [id, { ...g, opponentTeamName: null }]));
  const anonymous = (g: WorkbenchGame): GameChip => ({ ...chipOfGame(g), opponentTeamName: null });
  const sessionGames = [...overlap].flatMap((id) => (full.gamesById[id] ? [full.gamesById[id]!] : []));
  // A Session page numbers every Game of the Session in play order, as the Games list does (#81).
  const numbers = numberInPlayOrder(sessionGames);
  const debrief = buildDebrief({
    wb: full,
    games: sessionGames.map((g) => ({ id: g.id, number: numbers.get(g.id)! })),
    meta: await loadDebriefMeta(db, duoId, [...overlap]),
    sessionId,
  });
  return {
    kind: "session",
    session,
    games: [...overlap].flatMap((id) => (full.gamesById[id] ? [anonymous(full.gamesById[id]!)] : [])),
    relatedGames: [...cited].flatMap((id) => (full.gamesById[id] ? [anonymous(full.gamesById[id]!)] : [])),
    runs,
    wb,
    debrief,
  };
}
export * from "./knowledge.js";
export * from "./source.js";
