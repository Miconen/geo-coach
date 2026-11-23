import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  PLAIN_COUNTRY,
  SESSION_GAP_MS,
  confusionPairs as directedConfusionPairs,
  getCountryContinent,
  getCountryName,
  regionName,
  intervalsOverlap,
  undirectedConfusionPairs,
  type ClaimStatus,
  type Continent,
  type EvidenceDirection,
  type EvidenceKind,
  type SourceKind,
  type DerivedGuess,
  type LearningKind,
  type LearningRegion,
  type ProcessingRunPurpose,
  type ReactionType,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  duoMemberships,
  duos,
  games,
  players,
  recordings,
  replays,
  rounds,
  sessions,
  utterances,
} from "../db/schema.js";
import { duoEventBus, type PlayerLiveStatus } from "../events/bus.js";
import {
  DomainError,
  deriveClaims,
  deriveLearningsWithStatus,
  deriveSessionWorkRanges,
  getCurrentTranscriptVersionId,
  listCitedSections,
  listSources,
  loadTranscriptCorrector,
} from "../services/index.js";

export interface WorkbenchPlayer {
  id: string;
  displayName: string;
  geoguessrUserId: string | null;
  geoguessrName: string | null;
  avatarColor: string;
  isCurrentPlayer: boolean;
}

export interface WorkbenchUtterance {
  id: string;
  recordingId: string;
  sessionId: string;
  playerId: string;
  text: string;
  /** What Whisper heard, before Transcript corrections. */
  rawText: string;
  startedAt: string;
  endedAt: string;
  avgLogprob: number | null;
  noSpeechProb: number | null;
  citedByLearningIds: string[];
  rangeStatus: "processed" | "stale" | "unprocessed";
  rangeStatusByPurpose: {
    extract: "processed" | "stale" | "unprocessed";
    tips: "processed" | "stale" | "unprocessed";
  };
}

export interface WorkbenchGuess extends DerivedGuess {
  regionName: string | null;
}

export interface WorkbenchRound {
  id: string;
  gameId: string;
  roundNumber: number;
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  lat: number | null;
  lng: number | null;
  panoId: string | null;
  damageMultiplier: number;
  startTime: string;
  timerStartTime: string | null;
  endTime: string;
  resultsEndTime: string;
  phases: Array<{ phase: "play" | "countdown" | "results"; startedAt: string; endedAt: string }>;
  duoBestScore: number;
  opponentBestScore: number;
  hpDelta: number;
  guesses: WorkbenchGuess[];
  replayPlayerCount: number;
  utteranceIds: string[];
  learningIds: string[];
  debriefLearningIds: string[];
}

export interface WorkbenchGame {
  id: string;
  geoguessrGameId: string;
  startedAt: string;
  endedAt: string;
  won: boolean | null;
  duoRatingBefore: number | null;
  duoRatingAfter: number | null;
  ratingDelta: number | null;
  duoFinalHealth: number | null;
  opponentFinalHealth: number | null;
  opponentTeamName: string | null;
  roundCount: number;
  roundIds: string[];
  sessionIds: string[];
  micCount: number;
}

export interface WorkbenchSession {
  id: string;
  startedAt: string;
  endedAt: string;
  ended: boolean;
  playerIds: string[];
  micCount: number;
  gameIds: string[];
  ratingDelta: number;
  extractWorkCount: number;
  tipsWorkCount: number;
  status: "up-to-date" | "stale" | "unprocessed";
  workRanges: Array<{
    purpose: ProcessingRunPurpose;
    startUtc: string;
    endUtc: string;
    reason: "unprocessed" | "stale";
  }>;
  deletedRanges: Array<{
    recordingId: string;
    playerId: string;
    startUtc: string;
    endUtc: string;
  }>;
}

/** How long after a Round's results unlinked speech still counts as a debrief of that Round. */
const DEBRIEF_LINK_WINDOW_MS = 2 * 60_000;

export interface WorkbenchLearning {
  id: string;
  runId: string | null;
  sessionId: string | null;
  authorPlayerId: string | null;
  purpose: ProcessingRunPurpose | null;
  kind: LearningKind;
  origin: "speech" | "agent" | "manual";
  text: string;
  detail: string | null;
  countries: string[];
  regions: LearningRegion[];
  topics: string[];
  agentNote: string | null;
  /** The Claim this Learning rests on; look it up in `WorkbenchData.claimsById`. */
  claimId: string | null;
  sourceSpanStart: string | null;
  sourceSpanEnd: string | null;
  createdAt: string;
  status: "current" | "superseded" | "draft";
  supersededByRunId: string | null;
  supersededByLearningIds: string[];
  supersedesLearningIds: string[];
  isStale: boolean;
  utteranceIds: string[];
  derivedRoundIds: string[];
  explicitRoundIds: string[];
  roundIds: string[];
  isDebrief: boolean;
  worstHpDelta: number;
  reactions: Array<{ playerId: string; reaction: ReactionType; createdAt: string }>;
  starred: boolean;
  dismissed: boolean;
  done: boolean;
  runMeta: {
    agent: string;
    model: string;
    promptVersion: string;
    finishedAt: string | null;
  } | null;
}

export interface CountryDossier {
  code: string;
  name: string;
  continent: Continent;
  learningCount: number;
  claimCount: number;
  roundsPlayed: number;
  avgScore: number | null;
  missCount: number;
  netHpDelta: number;
  roundIds: string[];
}

/** One piece of Evidence on a Claim, resolved to what it points at. */
export interface WorkbenchEvidence {
  id: string;
  kind: EvidenceKind;
  direction: EvidenceDirection;
  roundId: string | null;
  playerId: string | null;
  /** For Documentation Evidence: the Source section it cites, pinned to its version. */
  source: {
    sourceId: string;
    title: string;
    versionNo: number;
    anchor: string;
    heading: string;
  } | null;
  note: string | null;
  createdAt: string;
}

export interface WorkbenchClaim {
  id: string;
  text: string;
  countries: string[];
  regions: LearningRegion[];
  topics: string[];
  /** Derived from `evidence`, never stored (ADR 0005). */
  status: ClaimStatus;
  evidence: WorkbenchEvidence[];
  /** The viewing Player's own ✓ (`for`) or ✗ (`against`), if any. */
  viewerDirection: EvidenceDirection | null;
  /** Current Learnings resting on this Claim. */
  learningIds: string[];
  imageUrls: string[];
  createdAt: string;
}

export interface WorkbenchSource {
  id: string;
  title: string;
  url: string | null;
  kind: SourceKind;
  latestVersionNo: number;
  versionCount: number;
  updatedAt: string;
  sectionCount: number;
  imageCount: number;
}

export interface ConfusionPair {
  countries: [string, string];
  labels: [string, string];
  missCount: number;
  learningCount: number;
}

export interface WorkbenchData {
  duo: {
    id: string;
    name: string;
    geoguessrTeamId: string;
    targetRating: number;
    targetDivision: string;
    currentRating: number | null;
    hotwords: string[];
  };
  players: Record<string, WorkbenchPlayer>;
  liveStatuses: PlayerLiveStatus[];
  recentGames: WorkbenchGame[];
  gamesById: Record<string, WorkbenchGame>;
  roundsById: Record<string, WorkbenchRound>;
  sessions: WorkbenchSession[];
  utterances: WorkbenchUtterance[];
  utterancesById: Record<string, WorkbenchUtterance>;
  learnings: WorkbenchLearning[];
  claims: WorkbenchClaim[];
  claimsById: Record<string, WorkbenchClaim>;
  sources: WorkbenchSource[];
  countryDossiers: CountryDossier[];
  confusionPairs: ConfusionPair[];
  totalPendingRanges: number;
  allTopics: string[];
}

export async function buildWorkbenchData(
  db: AppDb,
  duoId: string,
  viewerPlayerId: string,
): Promise<WorkbenchData> {
  const duo = await db.query.duos.findFirst({ where: eq(duos.id, duoId) });
  if (!duo) {
    throw new DomainError("NOT_FOUND", "Duo not found", 404);
  }

  const [
    memberships,
    allSessions,
    allRecordings,
    allGames,
    allRounds,
    allReplays,
    derivedLearnings,
    derivedClaims,
    duoSources,
    citedSections,
  ] = await Promise.all([
      db.query.duoMemberships.findMany({ where: eq(duoMemberships.duoId, duoId) }),
      db.query.sessions.findMany({
        where: eq(sessions.duoId, duoId),
        orderBy: [desc(sessions.createdAt)],
      }),
      db.query.recordings.findMany({
        where: eq(recordings.duoId, duoId),
        orderBy: [asc(recordings.startedAt)],
      }),
      db.query.games.findMany({
        where: eq(games.duoId, duoId),
        orderBy: [desc(games.startedAt)],
      }),
      db.query.rounds.findMany({
        where: eq(rounds.duoId, duoId),
        orderBy: [asc(rounds.startTime)],
      }),
      db.query.replays.findMany({ where: eq(replays.duoId, duoId) }),
      deriveLearningsWithStatus(db, duoId),
      deriveClaims(db, duoId),
      listSources(db, duoId),
      listCitedSections(db, duoId),
    ]);

  const duoPlayerIds = memberships.map((m) => m.playerId);
  const duoPlayers =
    duoPlayerIds.length > 0
      ? await db.query.players.findMany({ where: inArray(players.id, duoPlayerIds) })
      : [];

  const playersMap: Record<string, WorkbenchPlayer> = {};
  for (const p of duoPlayers) {
    playersMap[p.id] = {
      id: p.id,
      displayName: p.displayName,
      geoguessrUserId: p.geoguessrUserId,
      geoguessrName: p.geoguessrName,
      avatarColor: p.avatarColor,
      isCurrentPlayer: p.id === viewerPlayerId,
    };
  }

  // Load current Transcript version Utterances for every Recording
  const currentVersionIds: string[] = [];
  const recSessionById = new Map<string, string>();
  const recsBySession = new Map<string, typeof allRecordings>();
  for (const rec of allRecordings) {
    recSessionById.set(rec.id, rec.sessionId);
    const list = recsBySession.get(rec.sessionId) ?? [];
    list.push(rec);
    recsBySession.set(rec.sessionId, list);

    const tvId = await getCurrentTranscriptVersionId(db, rec.id);
    if (tvId) currentVersionIds.push(tvId);
  }

  const rawUtterances =
    currentVersionIds.length > 0
      ? await db.query.utterances.findMany({
          where: inArray(utterances.transcriptVersionId, currentVersionIds),
          orderBy: [asc(utterances.startedAt), asc(utterances.id)],
        })
      : [];

  // Derive work ranges per Session for both purposes
  const workRangesBySession = new Map<
    string,
    {
      extract: Awaited<ReturnType<typeof deriveSessionWorkRanges>>;
      tips: Awaited<ReturnType<typeof deriveSessionWorkRanges>>;
    }
  >();
  let totalPendingRanges = 0;

  for (const ses of allSessions) {
    const [extractWork, tipsWork] = await Promise.all([
      deriveSessionWorkRanges(db, duoId, ses.id, "extract"),
      deriveSessionWorkRanges(db, duoId, ses.id, "tips"),
    ]);
    workRangesBySession.set(ses.id, { extract: extractWork, tips: tipsWork });
    totalPendingRanges += extractWork.length;
  }

  // Build citation map (Utterance -> current Learning ids)
  const citedByUtterance = new Map<string, string[]>();
  for (const l of derivedLearnings) {
    if (l.status !== "current") continue;
    for (const uId of l.utteranceIds) {
      const arr = citedByUtterance.get(uId) ?? [];
      arr.push(l.id);
      citedByUtterance.set(uId, arr);
    }
  }

  // Map Utterances with derived range status per purpose (ADR 0002)
  const derivePurposeRangeStatus = (
    u: (typeof rawUtterances)[number],
    ranges: Array<{ startUtc: Date; endUtc: Date; reason: "unprocessed" | "stale" }>,
  ): "processed" | "stale" | "unprocessed" => {
    for (const w of ranges) {
      if (
        intervalsOverlap(
          { startedAt: u.startedAt, endedAt: u.endedAt },
          { startedAt: w.startUtc, endedAt: w.endUtc },
        )
      ) {
        return w.reason;
      }
    }
    return "processed";
  };

  const correctTranscript = await loadTranscriptCorrector(db, duoId);
  const wbUtterances: WorkbenchUtterance[] = rawUtterances.map((u) => {
    const sesId = recSessionById.get(u.recordingId) ?? "";
    const sessionWork = workRangesBySession.get(sesId);
    const extractStatus = derivePurposeRangeStatus(u, sessionWork?.extract ?? []);
    const tipsStatus = derivePurposeRangeStatus(u, sessionWork?.tips ?? []);
    return {
      id: u.id,
      recordingId: u.recordingId,
      sessionId: sesId,
      playerId: u.playerId,
      text: correctTranscript(u).text,
      rawText: u.text,
      startedAt: u.startedAt.toISOString(),
      endedAt: u.endedAt.toISOString(),
      avgLogprob: u.avgLogprob,
      noSpeechProb: u.noSpeechProb,
      citedByLearningIds: citedByUtterance.get(u.id) ?? [],
      rangeStatus: extractStatus,
      rangeStatusByPurpose: {
        extract: extractStatus,
        tips: tipsStatus,
      },
    };
  });

  const utterancesById: Record<string, WorkbenchUtterance> = {};
  for (const u of wbUtterances) utterancesById[u.id] = u;

  // Replay availability count per (gameId, roundNumber)
  const replayPlayersByRoundKey = new Map<string, number>();
  for (const rep of allReplays) {
    if (!rep.hasEvents) continue;
    const key = `${rep.gameId}:${rep.roundNumber}`;
    replayPlayersByRoundKey.set(key, (replayPlayersByRoundKey.get(key) ?? 0) + 1);
  }

  // Build Sessions with derived start/end/ended/players
  const nowMs = Date.now();
  const wbSessions: WorkbenchSession[] = [];
  const sessionBoundsById = new Map<string, { startedAt: Date; endedAt: Date }>();

  for (const ses of allSessions) {
    const recs = recsBySession.get(ses.id) ?? [];
    if (recs.length === 0) continue;

    let minStart = recs[0]!.startedAt.getTime();
    let maxEnd = recs[0]!.stoppedAt ? recs[0]!.stoppedAt.getTime() : nowMs;
    let hasLive = false;
    const playerSet = new Set<string>();
    const deletedRanges: WorkbenchSession["deletedRanges"] = [];

    for (const r of recs) {
      playerSet.add(r.playerId);
      const s = r.startedAt.getTime();
      if (s < minStart) minStart = s;
      if (!r.stoppedAt) {
        hasLive = true;
        maxEnd = Math.max(maxEnd, nowMs);
      } else {
        maxEnd = Math.max(maxEnd, r.stoppedAt.getTime());
      }
      for (const dr of r.deletedRanges) {
        deletedRanges.push({
          recordingId: r.id,
          playerId: r.playerId,
          startUtc: dr.startUtc,
          endUtc: dr.endUtc,
        });
      }
    }

    const work = workRangesBySession.get(ses.id) ?? { extract: [], tips: [] };
    const status: WorkbenchSession["status"] = work.extract.some((w) => w.reason === "unprocessed")
      ? "unprocessed"
      : work.extract.some((w) => w.reason === "stale")
        ? "stale"
        : "up-to-date";

    sessionBoundsById.set(ses.id, { startedAt: new Date(minStart), endedAt: new Date(maxEnd) });
    wbSessions.push({
      id: ses.id,
      startedAt: new Date(minStart).toISOString(),
      endedAt: new Date(maxEnd).toISOString(),
      ended: !hasLive && nowMs - maxEnd >= SESSION_GAP_MS,
      playerIds: [...playerSet],
      micCount: playerSet.size,
      gameIds: [],
      ratingDelta: 0,
      extractWorkCount: work.extract.length,
      tipsWorkCount: work.tips.length,
      status,
      workRanges: [
        ...work.extract.map((w) => ({
          purpose: w.purpose,
          startUtc: w.startUtc.toISOString(),
          endUtc: w.endUtc.toISOString(),
          reason: w.reason,
        })),
        ...work.tips.map((w) => ({
          purpose: w.purpose,
          startUtc: w.startUtc.toISOString(),
          endUtc: w.endUtc.toISOString(),
          reason: w.reason,
        })),
      ],
      deletedRanges,
    });
  }

  // Build Rounds and link overlapping Utterances
  const roundsByGame = new Map<string, string[]>();
  const roundsById: Record<string, WorkbenchRound> = {};
  const roundDateBounds = new Map<string, { start: Date; end: Date }>();

  for (const r of allRounds) {
    const list = roundsByGame.get(r.gameId) ?? [];
    list.push(r.id);
    roundsByGame.set(r.gameId, list);

    const matchingUIds: string[] = [];
    for (const u of rawUtterances) {
      if (
        intervalsOverlap(
          { startedAt: u.startedAt, endedAt: u.endedAt },
          { startedAt: r.startTime, endedAt: r.resultsEndTime },
        )
      ) {
        matchingUIds.push(u.id);
      }
    }

    roundDateBounds.set(r.id, { start: r.startTime, end: r.resultsEndTime });
    roundsById[r.id] = {
      id: r.id,
      gameId: r.gameId,
      roundNumber: r.roundNumber,
      countryCode: r.countryCode,
      countryName: r.countryCode ? getCountryName(r.countryCode) : null,
      regionCode: r.regionCode,
      regionName: regionName(r.regionCode),
      lat: r.lat,
      lng: r.lng,
      panoId: r.panoId,
      damageMultiplier: r.damageMultiplier,
      startTime: r.startTime.toISOString(),
      timerStartTime: r.timerStartTime ? r.timerStartTime.toISOString() : null,
      endTime: r.endTime.toISOString(),
      resultsEndTime: r.resultsEndTime.toISOString(),
      phases: r.phases.map((p) => ({
        phase: p.phase,
        startedAt: new Date(p.startedAt).toISOString(),
        endedAt: new Date(p.endedAt).toISOString(),
      })),
      duoBestScore: r.duoBestScore,
      opponentBestScore: r.opponentBestScore,
      hpDelta: r.hpDelta,
      guesses: r.guesses.map((g) => ({ ...g, regionName: regionName(g.regionCode) })),
      replayPlayerCount: replayPlayersByRoundKey.get(`${r.gameId}:${r.roundNumber}`) ?? 0,
      utteranceIds: matchingUIds,
      learningIds: [],
      debriefLearningIds: [],
    };
  }

  // Build Games and link overlapping Sessions + mic coverage
  const gamesById: Record<string, WorkbenchGame> = {};
  const recentGames: WorkbenchGame[] = [];
  for (const g of allGames) {
    const overlappingSessionIds: string[] = [];
    for (const ses of wbSessions) {
      const b = sessionBoundsById.get(ses.id);
      if (
        b &&
        intervalsOverlap(
          { startedAt: g.startedAt, endedAt: g.endedAt },
          { startedAt: b.startedAt, endedAt: b.endedAt },
        )
      ) {
        overlappingSessionIds.push(ses.id);
        ses.gameIds.push(g.id);
        if (g.duoRatingBefore !== null && g.duoRatingAfter !== null) {
          ses.ratingDelta += g.duoRatingAfter - g.duoRatingBefore;
        }
      }
    }

    const activePlayersDuringGame = new Set<string>();
    for (const rec of allRecordings) {
      const recEnd = rec.stoppedAt ?? new Date(nowMs);
      if (
        intervalsOverlap(
          { startedAt: g.startedAt, endedAt: g.endedAt },
          { startedAt: rec.startedAt, endedAt: recEnd },
        )
      ) {
        activePlayersDuringGame.add(rec.playerId);
      }
    }

    const ratingDelta =
      g.duoRatingBefore !== null && g.duoRatingAfter !== null
        ? g.duoRatingAfter - g.duoRatingBefore
        : null;

    const wbGame: WorkbenchGame = {
      id: g.id,
      geoguessrGameId: g.geoguessrGameId,
      startedAt: g.startedAt.toISOString(),
      endedAt: g.endedAt.toISOString(),
      won: g.won,
      duoRatingBefore: g.duoRatingBefore,
      duoRatingAfter: g.duoRatingAfter,
      ratingDelta,
      duoFinalHealth: g.duoFinalHealth,
      opponentFinalHealth: g.opponentFinalHealth,
      opponentTeamName: g.opponentTeamName,
      roundCount: g.roundCount,
      roundIds: roundsByGame.get(g.id) ?? [],
      sessionIds: overlappingSessionIds,
      micCount: activePlayersDuringGame.size,
    };
    gamesById[g.id] = wbGame;
    recentGames.push(wbGame);
  }

  // Two-way supersession links + derived Round links + Session fallback for Manual Learnings
  const learningsByRun = new Map<string, string[]>();
  for (const l of derivedLearnings) {
    if (l.runId) {
      const arr = learningsByRun.get(l.runId) ?? [];
      arr.push(l.id);
      learningsByRun.set(l.runId, arr);
    }
  }

  const supersedesMap = new Map<string, string[]>();
  for (const l of derivedLearnings) {
    if (l.supersededByRunId) {
      const replacements = learningsByRun.get(l.supersededByRunId) ?? [];
      for (const repId of replacements) {
        const list = supersedesMap.get(repId) ?? [];
        list.push(l.id);
        supersedesMap.set(repId, list);
      }
    }
  }

  const allTopicsSet = new Set<string>();
  const wbLearnings: WorkbenchLearning[] = derivedLearnings
    .filter((l) => l.status !== "draft")
    .map((l) => {
      for (const t of l.topics) allTopicsSet.add(t);

      // Derive Rounds from source Utterances overlapping Round time windows
      const derivedRoundSet = new Set<string>();
      for (const uId of l.utteranceIds) {
        const u = utterancesById[uId];
        if (!u) continue;
        const uInterval = { startedAt: new Date(u.startedAt), endedAt: new Date(u.endedAt) };
        for (const [rId, b] of roundDateBounds.entries()) {
          if (intervalsOverlap(uInterval, { startedAt: b.start, endedAt: b.end })) {
            derivedRoundSet.add(rId);
          }
        }
      }

      const explicitRoundIds = l.explicitRoundIds;
      const debriefRoundIds = explicitRoundIds.filter((rId) => !derivedRoundSet.has(rId));
      if (derivedRoundSet.size === 0 && explicitRoundIds.length === 0) {
        // Speech outside every Round is a debrief of the Round that just ended
        const spokenAt = Math.min(
          ...l.utteranceIds.flatMap((uId) => {
            const u = utterancesById[uId];
            return u ? [Date.parse(u.startedAt)] : [];
          }),
        );
        let nearest: { id: string; endedAt: number } | null = null;
        for (const [rId, b] of roundDateBounds.entries()) {
          const endedAt = b.end.getTime();
          if (
            endedAt <= spokenAt &&
            spokenAt - endedAt <= DEBRIEF_LINK_WINDOW_MS &&
            (!nearest || endedAt > nearest.endedAt)
          ) {
            nearest = { id: rId, endedAt };
          }
        }
        if (nearest) debriefRoundIds.push(nearest.id);
      }
      const allRoundIds = [...new Set([...derivedRoundSet, ...explicitRoundIds, ...debriefRoundIds])];
      const isDebrief = debriefRoundIds.length > 0;

      // Derive Session for Manual Learnings via Utterance -> Recording -> Session OR Round -> Game -> Session
      let sessionId = l.sessionId;
      if (!sessionId && l.utteranceIds.length > 0) {
        sessionId = utterancesById[l.utteranceIds[0]!]?.sessionId ?? null;
      }
      if (!sessionId && allRoundIds.length > 0) {
        const round = roundsById[allRoundIds[0]!];
        const game = round ? gamesById[round.gameId] : null;
        sessionId = game?.sessionIds[0] ?? null;
      }

      // Compute worst HP delta across linked Rounds (for HP-leak sort)
      let worstHpDelta = 0;
      for (const rId of allRoundIds) {
        const r = roundsById[rId];
        if (r && r.hpDelta < worstHpDelta) {
          worstHpDelta = r.hpDelta;
        }
      }

      // Check whether any cited Utterance currently sits in a stale range for THIS Learning's purpose (ADR 0002)
      const purposeKey: "extract" | "tips" = l.purpose === "tips" ? "tips" : "extract";
      const isStale =
        l.status === "current" &&
        l.origin !== "manual" &&
        l.utteranceIds.some(
          (uId) => utterancesById[uId]?.rangeStatusByPurpose[purposeKey] === "stale",
        );

      // Attach Learning onto its linked Rounds
      if (l.status === "current") {
        for (const rId of allRoundIds) {
          const r = roundsById[rId];
          if (!r) continue;
          if (!r.learningIds.includes(l.id)) r.learningIds.push(l.id);
          if (debriefRoundIds.includes(rId) && !r.debriefLearningIds.includes(l.id)) {
            r.debriefLearningIds.push(l.id);
          }
        }
      }

      return {
        id: l.id,
        runId: l.runId,
        sessionId,
        authorPlayerId: l.authorPlayerId,
        purpose: l.purpose,
        kind: l.kind,
        origin: l.origin,
        text: l.text,
        detail: l.detail,
        countries: l.countries,
        regions: l.regions,
        topics: l.topics,
        agentNote: l.agentNote,
        claimId: l.claimId,
        sourceSpanStart: l.sourceSpanStart ? l.sourceSpanStart.toISOString() : null,
        sourceSpanEnd: l.sourceSpanEnd ? l.sourceSpanEnd.toISOString() : null,
        createdAt: l.createdAt.toISOString(),
        status: l.status,
        supersededByRunId: l.supersededByRunId,
        supersededByLearningIds: l.supersededByRunId
          ? (learningsByRun.get(l.supersededByRunId) ?? [])
          : [],
        supersedesLearningIds: supersedesMap.get(l.id) ?? [],
        isStale,
        utteranceIds: l.utteranceIds,
        derivedRoundIds: [...derivedRoundSet],
        explicitRoundIds,
        roundIds: allRoundIds,
        isDebrief,
        worstHpDelta,
        reactions: l.reactions.map((r) => ({
          playerId: r.playerId,
          reaction: r.reaction,
          createdAt: r.createdAt.toISOString(),
        })),
        starred: l.reactions.some((r) => r.reaction === "star"),
        dismissed: l.reactions.some((r) => r.reaction === "dismiss"),
        done: l.reactions.some((r) => r.reaction === "done"),
        runMeta: l.runMeta
          ? {
              agent: l.runMeta.agent,
              model: l.runMeta.model,
              promptVersion: l.runMeta.promptVersion,
              finishedAt: l.runMeta.finishedAt ? l.runMeta.finishedAt.toISOString() : null,
            }
          : null,
      };
    });

  // Knowledge bank: Claims with resolved Evidence, and the Duo's Sources
  const currentLearningIds = new Set(
    wbLearnings.filter((l) => l.status === "current").map((l) => l.id),
  );
  const sectionByKey = new Map(citedSections.map((c) => [`${c.sourceVersionId}:${c.anchor}`, c]));
  const claims: WorkbenchClaim[] = derivedClaims.map((c) => ({
    id: c.id,
    text: c.text,
    countries: c.countries,
    regions: c.regions,
    topics: c.topics,
    status: c.status,
    evidence: c.evidence.map((e) => {
      const section =
        e.kind === "documentation" ? sectionByKey.get(`${e.sourceVersionId}:${e.sectionAnchor}`) : null;
      return {
        id: e.id,
        kind: e.kind,
        direction: e.kind === "round" ? "for" : e.direction,
        roundId: e.roundId,
        playerId: e.playerId,
        source: section
          ? {
              sourceId: section.sourceId,
              title: section.title,
              versionNo: section.versionNo,
              anchor: section.anchor,
              heading: section.heading,
            }
          : null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      };
    }),
    viewerDirection:
      c.evidence.find((e) => e.kind === "player" && e.playerId === viewerPlayerId)?.direction ?? null,
    learningIds: c.learningIds.filter((id) => currentLearningIds.has(id)),
    imageUrls: c.imageIds.map((id) => `/api/sources/images/${id}`),
    createdAt: c.createdAt.toISOString(),
  }));
  const claimsById: Record<string, WorkbenchClaim> = {};
  for (const c of claims) claimsById[c.id] = c;

  const sources: WorkbenchSource[] = duoSources.map((s) => {
    const latest = s.versions[s.versions.length - 1];
    return {
      id: s.id,
      title: s.title,
      url: s.url,
      kind: s.kind,
      latestVersionNo: latest?.versionNo ?? 0,
      versionCount: s.versions.length,
      updatedAt: (latest?.createdAt ?? s.createdAt).toISOString(),
      sectionCount: latest?.sectionCount ?? 0,
      imageCount: latest?.imageCount ?? 0,
    };
  });

  // Derive Country Dossiers (including 0-Learning countries with played Rounds)
  const countryAcc = new Map<
    string,
    {
      learningCount: number;
      claimCount: number;
      roundsPlayed: number;
      scoreSum: number;
      missCount: number;
      netHpDelta: number;
      roundIds: string[];
    }
  >();

  const ensureCountry = (code: string) => {
    const upper = code.toUpperCase();
    let entry = countryAcc.get(upper);
    if (!entry) {
      entry = {
        learningCount: 0,
        claimCount: 0,
        roundsPlayed: 0,
        scoreSum: 0,
        missCount: 0,
        netHpDelta: 0,
        roundIds: [],
      };
      countryAcc.set(upper, entry);
    }
    return entry;
  };

  for (const l of wbLearnings) {
    if (l.status !== "current" || l.dismissed) continue;
    for (const code of l.countries) {
      ensureCountry(code).learningCount += 1;
    }
  }

  for (const c of claims) {
    for (const code of c.countries) {
      ensureCountry(code).claimCount += 1;
    }
  }

  // Confusion Pairs from wrong-country Round guesses + multi-country Learnings
  const pairAcc = new Map<string, { countries: [string, string]; missCount: number; learningCount: number }>();
  const touchPair = (a: string, b: string) => {
    const [c1, c2] = [a.toUpperCase(), b.toUpperCase()].sort() as [string, string];
    const key = `${c1}:${c2}`;
    let entry = pairAcc.get(key);
    if (!entry) {
      entry = { countries: [c1, c2], missCount: 0, learningCount: 0 };
      pairAcc.set(key, entry);
    }
    return entry;
  };

  for (const r of Object.values(roundsById)) {
    if (!r.countryCode) continue;
    const entry = ensureCountry(r.countryCode);
    entry.roundsPlayed += 1;
    entry.scoreSum += r.duoBestScore;
    entry.netHpDelta += r.hpDelta;
    entry.roundIds.push(r.id);

    const bestDuoGuess = r.guesses.find((g) => g.isDuo && g.isBestForTeam);
    if (bestDuoGuess?.countryCode && bestDuoGuess.countryCode !== r.countryCode) {
      entry.missCount += 1;
    }
  }

  // Order-free: both directions of the shared directed pairs added up, water left out,
  // plain country codes (overseas Regions not split off).
  const roundPairs = directedConfusionPairs(Object.values(roundsById), PLAIN_COUNTRY);
  for (const p of undirectedConfusionPairs(roundPairs)) {
    touchPair(p.countries[0], p.countries[1]).missCount += p.count;
  }

  for (const l of wbLearnings) {
    if (l.status !== "current" || l.dismissed || l.countries.length < 2) continue;
    for (let i = 0; i < l.countries.length; i++) {
      for (let j = i + 1; j < l.countries.length; j++) {
        touchPair(l.countries[i]!, l.countries[j]!).learningCount += 1;
      }
    }
  }

  const countryDossiers: CountryDossier[] = [...countryAcc.entries()]
    .map(([code, acc]) => ({
      code,
      name: getCountryName(code),
      continent: getCountryContinent(code),
      learningCount: acc.learningCount,
      claimCount: acc.claimCount,
      roundsPlayed: acc.roundsPlayed,
      avgScore: acc.roundsPlayed > 0 ? Math.round(acc.scoreSum / acc.roundsPlayed) : null,
      missCount: acc.missCount,
      netHpDelta: acc.netHpDelta,
      roundIds: acc.roundIds,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const confusionPairs: ConfusionPair[] = [...pairAcc.values()]
    .map((p) => ({
      countries: p.countries,
      labels: [getCountryName(p.countries[0]), getCountryName(p.countries[1])] as [string, string],
      missCount: p.missCount,
      learningCount: p.learningCount,
    }))
    .sort((a, b) => b.missCount * 3 + b.learningCount - (a.missCount * 3 + a.learningCount));

  const currentRating = recentGames.find((g) => g.duoRatingAfter !== null)?.duoRatingAfter ?? null;

  return {
    duo: {
      id: duo.id,
      name: duo.name,
      geoguessrTeamId: duo.geoguessrTeamId,
      targetRating: duo.targetRating,
      targetDivision: duo.targetDivision,
      currentRating,
      hotwords: duo.hotwords,
    },
    players: playersMap,
    liveStatuses: duoEventBus.getLiveStatuses(duoId),
    recentGames,
    gamesById,
    roundsById,
    sessions: wbSessions,
    utterances: wbUtterances,
    utterancesById,
    learnings: wbLearnings,
    claims,
    claimsById,
    sources,
    countryDossiers,
    confusionPairs,
    totalPendingRanges,
    allTopics: [...allTopicsSet].sort(),
  };
}

/**
 * Searches both Learnings and uncited raw Utterances, keeping range status so the UI
 * groups uncited hits under Unprocessed / Stale / Processed · not extracted.
 */
export function searchWorkbench(
  wb: WorkbenchData,
  query: string,
): {
  learningIds: string[];
  uncitedUtterances: WorkbenchUtterance[];
} {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { learningIds: wb.learnings.map((l) => l.id), uncitedUtterances: [] };
  }

  const learningIds = wb.learnings
    .filter((l) => {
      const hay = [
        l.text,
        l.detail ?? "",
        l.agentNote ?? "",
        ...l.countries,
        ...l.countries.map(getCountryName),
        ...l.regions.map((r) => r.name),
        ...l.topics,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .map((l) => l.id);

  const uncitedUtterances = wb.utterances.filter(
    (u) => u.citedByLearningIds.length === 0 && u.text.toLowerCase().includes(q),
  );

  return { learningIds, uncitedUtterances };
}
