import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  PLAIN_COUNTRY,
  SESSION_GAP_MS,
  confusionPairs as directedConfusionPairs,
  getCountryContinent,
  getCountryName,
  regionName,
  intervalsOverlap,
  gameBounds,
  gameOverlaps,
  gameRatingSessionId,
  gameSessionIds,
  rangeStatus,
  roundWindowsById,
  type SessionSpan,
  type TimeInterval,
  type WordTiming,
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
import { isUuid } from "../../uuid.js";
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
  deriveWorkRangesBySession,
  getCurrentTranscriptVersionIds,
  listCitedSections,
  listSources,
  loadTranscriptCorrector,
  type WorkRange,
  type WorkRangeCause,
  type DerivedLearningRecord,
  deriveCallLabelHistory,
  findRunInDuo,
  recordingInDuo,
  roundInDuo,
  speechInDuo,
} from "../services/index.js";
import { isProcessorOnline } from "../mcp/processing-jobs.js";
import {
  buildRunTimeline,
  sessionWorkRangeJobs,
  type RunTimeline,
  type WorkRangeJobState,
} from "./run-timeline.js";

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
  /** Cited speech from a Transcript version that is no longer current: read-only, outside the timeline. */
  historical: boolean;
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
  recordingIds: string[];
  /** Recordings with a committed stop: a cached heartbeat naming one never counts as recording again. */
  stoppedRecordingIds: string[];
  ratingDelta: number;
  extractWorkCount: number;
  tipsWorkCount: number;
  status: "up-to-date" | "stale" | "unprocessed";
  workRanges: Array<{
    purpose: ProcessingRunPurpose;
    startUtc: string;
    endUtc: string;
    reason: "unprocessed" | "stale";
    causes: Array<{ playerName: string; summary: string }>;
    lastRun: { playerName: string; model: string; finishedAt: string | null } | null;
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
  /** The run's Session, or every Session a Manual Learning's citations imply (0..N; uncited: none). */
  sessionIds: string[];
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
  /** The Source images behind imageUrls (new surfaces build ?r=2 URLs from them, #56 3a). */
  imageIds: string[];
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
  /** The Session the SESSION pane shows: ?sessionId=, else the ?run= pin's Session, else the newest. A
   * Recording-less Session stays selected; buildWorkbenchData lists only Sessions with Recordings. */
  selectedSession: { id: string; startedAt: string; recordingLess: boolean } | null;
  /** The selected Session's run history (#56 0b). */
  runTimeline: RunTimeline | null;
  processing: { workerOnline: boolean; rangeJobs: Record<string, WorkRangeJobState> };
}

export interface WorkbenchOptions {
  /** A Session of this Duo (callers validate it). */
  sessionId?: string | null;
  /** A ?run= pin; dropped (pinMissing) when malformed, missing, foreign or of another pinned Session. */
  runId?: string | null;
  /**
   * "cited" loads only the speech a Learning cites, for pages that show no Round speech or timeline: Learnings
   * derive the same, but Rounds' utteranceIds and utterances hold cited speech only. Default "all".
   */
  speech?: "all" | "cited";
}

/** Whether two Learnings' source spans overlap (supersession is per span, ADR 0001). */
function spansOverlap(a: DerivedLearningRecord, b: DerivedLearningRecord) {
  if (!a.sourceSpanStart || !a.sourceSpanEnd || !b.sourceSpanStart || !b.sourceSpanEnd) return false;
  return intervalsOverlap(
    { startedAt: a.sourceSpanStart, endedAt: a.sourceSpanEnd },
    { startedAt: b.sourceSpanStart, endedAt: b.sourceSpanEnd },
  );
}

function describeCause(cause: WorkRangeCause): string {
  return cause.changes
    .map((change) => {
      switch (change) {
        case "not-processed":
          return "not processed yet";
        case "missing-from-run":
          return "added after the last run";
        case "retranscribed":
          return "re-transcribed";
        case "chunks-changed":
          return cause.newChunks > 0
            ? `${cause.newChunks} new chunk${cause.newChunks === 1 ? "" : "s"}`
            : "chunks changed";
        case "clock":
          return `clock corrected by ${(Math.abs(cause.clockShiftMs) / 1000).toFixed(1)}s`;
        case "speech-deleted":
          return "speech deleted";
      }
    })
    .join(", ");
}

function describeWorkRange(range: WorkRange, playersById: Record<string, WorkbenchPlayer>) {
  const nameOf = (id: string) => playersById[id]?.displayName ?? "Unknown player";
  const latest = range.causes
    .flatMap((c) => (c.lastRun ? [c.lastRun] : []))
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
  return {
    purpose: range.purpose,
    startUtc: range.startUtc.toISOString(),
    endUtc: range.endUtc.toISOString(),
    reason: range.reason,
    causes: range.causes.map((c) => ({
      playerName: nameOf(c.playerId),
      summary: describeCause(c),
    })),
    lastRun: latest
      ? {
          playerName: nameOf(latest.startedByPlayerId),
          model: latest.model,
          finishedAt: latest.finishedAt?.toISOString() ?? null,
        }
      : null,
  };
}

// words only as first/last bounds (all speechSpanMs needs), never the full timing array.
export const UTTERANCE_COLUMNS = {
  id: utterances.id,
  recordingId: utterances.recordingId,
  transcriptVersionId: utterances.transcriptVersionId,
  playerId: utterances.playerId,
  text: utterances.text,
  startedAt: utterances.startedAt,
  endedAt: utterances.endedAt,
  startSampleMs: utterances.startSampleMs,
  avgLogprob: utterances.avgLogprob,
  noSpeechProb: utterances.noSpeechProb,
  words: sql<WordTiming[]>`case when jsonb_array_length(${utterances.words}) > 0
    then jsonb_build_array(${utterances.words}->0, ${utterances.words}->-1) else '[]'::jsonb end`,
};

type UtteranceRow = {
  id: string;
  recordingId: string;
  playerId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
  startSampleMs: number;
  avgLogprob: number | null;
  noSpeechProb: number | null;
  words: WordTiming[];
};
type WorkRangeRow = { startUtc: Date; endUtc: Date; reason: "unprocessed" | "stale" };

/**
 * Turns UTTERANCE_COLUMNS rows into WorkbenchUtterances. The derivation and the Round page's on-demand speech
 * (loadRoundSpeech) share it, so both read the same text, citations and range status.
 */
export function utteranceMapper(ctx: {
  recSessionById: ReadonlyMap<string, string>;
  workRangesBySession: ReadonlyMap<string, { extract: WorkRangeRow[]; tips: WorkRangeRow[] }>;
  /** Utterance id -> the current Learnings citing it. */
  citedByUtterance: ReadonlyMap<string, string[]>;
  correctTranscript: Awaited<ReturnType<typeof loadTranscriptCorrector>>;
}): (u: UtteranceRow, historical: boolean) => WorkbenchUtterance {
  const { recSessionById, workRangesBySession, citedByUtterance, correctTranscript } = ctx;
  // Range status per purpose (ADR 0002): any overlapping stale range wins over an unprocessed one. Each Session's
  // ranges are mapped once, not once per Utterance.
  const mappedRanges = new Map<WorkRangeRow[], Parameters<typeof rangeStatus>[1]>();
  const noRanges: WorkRangeRow[] = [];
  const derivePurposeRangeStatus = (u: UtteranceRow, ranges: WorkRangeRow[]) => {
    let mapped = mappedRanges.get(ranges);
    if (!mapped) {
      mapped = ranges.map((w) => ({ startedAt: w.startUtc, endedAt: w.endUtc, reason: w.reason }));
      mappedRanges.set(ranges, mapped);
    }
    return rangeStatus({ startedAt: u.startedAt, endedAt: u.endedAt }, mapped);
  };
  return (u, historical) => {
    const sesId = recSessionById.get(u.recordingId) ?? "";
    const sessionWork = workRangesBySession.get(sesId);
    const extractStatus = derivePurposeRangeStatus(u, sessionWork?.extract ?? noRanges);
    const tipsStatus = derivePurposeRangeStatus(u, sessionWork?.tips ?? noRanges);
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
      historical,
      rangeStatus: extractStatus,
      rangeStatusByPurpose: {
        extract: extractStatus,
        tips: tipsStatus,
      },
    };
  };
}

export async function buildWorkbenchData(
  db: AppDb,
  duoId: string,
  viewerPlayerId: string,
  options: WorkbenchOptions = {},
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
      db.select().from(recordings).where(recordingInDuo(duoId)).orderBy(asc(recordings.startedAt)),
      // Review never ships games.rawDuel.
      db.query.games.findMany({
        where: eq(games.duoId, duoId),
        orderBy: [desc(games.startedAt)],
        columns: { rawDuel: false },
      }),
      db.select().from(rounds).where(roundInDuo(duoId)).orderBy(asc(rounds.startTime)),
      // Replay availability as counts per stored Round (every Player's Replay row).
      db
        .select({
          gameId: replays.gameId,
          roundNumber: replays.roundNumber,
          count: sql<number>`count(*)::int`,
        })
        .from(replays)
        .where(and(eq(replays.duoId, duoId), eq(replays.hasEvents, true)))
        .groupBy(replays.gameId, replays.roundNumber),
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

  // Load current Transcript version Utterances for every Recording (versions elected in one query)
  const recSessionById = new Map<string, string>();
  const recsBySession = new Map<string, typeof allRecordings>();
  for (const rec of allRecordings) {
    recSessionById.set(rec.id, rec.sessionId);
    const list = recsBySession.get(rec.sessionId) ?? [];
    list.push(rec);
    recsBySession.set(rec.sessionId, list);
  }
  const currentVersionIds = [
    ...(
      await getCurrentTranscriptVersionIds(
        db,
        allRecordings.map((r) => r.id),
      )
    ).values(),
  ];

  const citedOnly = options.speech === "cited";
  const citedIds = citedOnly ? [...new Set(derivedLearnings.flatMap((l) => l.utteranceIds))] : [];
  const rawUtterances =
    currentVersionIds.length > 0 && (!citedOnly || citedIds.length > 0)
      ? await db
          .select(UTTERANCE_COLUMNS)
          .from(utterances)
          .where(
            and(
              inArray(utterances.transcriptVersionId, currentVersionIds),
              citedOnly ? inArray(utterances.id, citedIds) : undefined,
              speechInDuo(duoId),
            ),
          )
          .orderBy(asc(utterances.startedAt), asc(utterances.id))
      : [];

  // Historical citations: speech a Learning cites from a version that is no longer current, read through the
  // speech check and resolved against its own version (rules apply; one-off fixes belong to current versions).
  const currentUtteranceIds = new Set(rawUtterances.map((u) => u.id));
  const historicalIds = [
    ...new Set(derivedLearnings.flatMap((l) => l.utteranceIds).filter((id) => !currentUtteranceIds.has(id))),
  ];
  const historicalUtterances =
    historicalIds.length > 0
      ? await db
          .select(UTTERANCE_COLUMNS)
          .from(utterances)
          .where(and(inArray(utterances.id, historicalIds), speechInDuo(duoId)))
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

  // One batched derivation for every Session (a fixed number of queries, not several per Session).
  const workBySession = await deriveWorkRangesBySession(
    db,
    duoId,
    ["extract", "tips"] as const,
    allSessions.map((ses) => ses.id),
  );
  for (const ses of allSessions) {
    const work = workBySession.get(ses.id) ?? { extract: [], tips: [] };
    workRangesBySession.set(ses.id, work);
    totalPendingRanges += work.extract.length;
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

  const toWorkbenchUtterance = utteranceMapper({
    recSessionById,
    workRangesBySession,
    citedByUtterance,
    correctTranscript: await loadTranscriptCorrector(db, duoId),
  });

  const wbUtterances: WorkbenchUtterance[] = rawUtterances.map((u) => toWorkbenchUtterance(u, false));
  const utterancesById: Record<string, WorkbenchUtterance> = {};
  for (const u of wbUtterances) utterancesById[u.id] = u;
  for (const u of historicalUtterances) utterancesById[u.id] = toWorkbenchUtterance(u, true);

  // Replay availability count per (gameId, roundNumber), matched on the stored Round's number
  const replayPlayersByRoundKey = new Map<string, number>();
  for (const rep of allReplays) replayPlayersByRoundKey.set(`${rep.gameId}:${rep.roundNumber}`, rep.count);

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
      recordingIds: recs.map((r) => r.id),
      stoppedRecordingIds: recs.filter((r) => r.stoppedAt).map((r) => r.id),
      ratingDelta: 0,
      extractWorkCount: work.extract.length,
      tipsWorkCount: work.tips.length,
      status,
      workRanges: [...work.extract, ...work.tips].map((w) => describeWorkRange(w, playersMap)),
      deletedRanges,
    });
  }

  // Build Rounds and link overlapping Utterances
  const roundsByGame = new Map<string, string[]>();
  const roundsById: Record<string, WorkbenchRound> = {};
  const roundDateBounds = new Map<string, { start: Date; end: Date }>();
  // Full windows (#56 1a-derivation): a Round with a missing start links nothing, and a window stops at its own
  // end when the successor's start is missing.
  const windowsByRound = roundWindowsById(allRounds);
  // Utterances sorted by start, so each window scans only those that could overlap it (start within the longest
  // Utterance's duration before the window, up to its end) instead of every Utterance; the exact check is unchanged.
  const byStart = rawUtterances
    .map((u, index) => ({ u, index, startMs: u.startedAt.getTime() }))
    .sort((a, b) => a.startMs - b.startMs);
  const maxDurationMs = rawUtterances.reduce((m, u) => Math.max(m, u.endedAt.getTime() - u.startedAt.getTime()), 0);
  const firstStartingAtOrAfter = (ms: number) => {
    let lo = 0;
    let hi = byStart.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byStart[mid]!.startMs < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  for (const r of allRounds) {
    const list = roundsByGame.get(r.gameId) ?? [];
    list.push(r.id);
    roundsByGame.set(r.gameId, list);

    const window = windowsByRound.get(r.id) ?? null;
    const matchingUIds: string[] = [];
    if (window) {
      const endMs = window.full.endedAt.getTime();
      const matches: Array<{ id: string; index: number }> = [];
      for (let i = firstStartingAtOrAfter(window.full.startedAt.getTime() - maxDurationMs); i < byStart.length; i++) {
        const c = byStart[i]!;
        if (c.startMs > endMs) break;
        if (intervalsOverlap({ startedAt: c.u.startedAt, endedAt: c.u.endedAt }, window.full)) {
          matches.push({ id: c.u.id, index: c.index });
        }
      }
      // In the Utterances' own order, as before.
      for (const m of matches.sort((a, b) => a.index - b.index)) matchingUIds.push(m.id);
      roundDateBounds.set(r.id, { start: window.full.startedAt, end: window.full.endedAt });
    }
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

  // Build Games: Sessions by recording overlap on relationship bounds (0..N, shared with Stats), the rating
  // delta to one Session (ADR 0008), mic coverage on the same bounds.
  const gamesById: Record<string, WorkbenchGame> = {};
  const recentGames: WorkbenchGame[] = [];
  const roundRowsByGame = new Map<string, (typeof allRounds)[number][]>();
  for (const r of allRounds) roundRowsByGame.set(r.gameId, [...(roundRowsByGame.get(r.gameId) ?? []), r]);
  const sessionSpans: SessionSpan[] = wbSessions.map((ses) => ({
    id: ses.id,
    startedAt: sessionBoundsById.get(ses.id)!.startedAt,
    endedAt: sessionBoundsById.get(ses.id)!.endedAt,
    recordings: (recsBySession.get(ses.id) ?? []).map((rec) => ({
      startedAt: rec.startedAt,
      endedAt: rec.stoppedAt ?? new Date(nowMs),
    })),
  }));
  const relationshipByGame = new Map<string, TimeInterval | null>();
  for (const g of allGames) {
    const relationship = gameBounds(roundRowsByGame.get(g.id) ?? []).relationship;
    relationshipByGame.set(g.id, relationship);
    const overlappingSessionIds = gameSessionIds(relationship, sessionSpans);
    const ratingSessionId = gameRatingSessionId(relationship, sessionSpans);
    for (const ses of wbSessions) {
      if (!overlappingSessionIds.includes(ses.id)) continue;
      ses.gameIds.push(g.id);
      if (ses.id === ratingSessionId && g.duoRatingBefore !== null && g.duoRatingAfter !== null) {
        ses.ratingDelta += g.duoRatingAfter - g.duoRatingBefore;
      }
    }

    const activePlayersDuringGame = new Set<string>();
    for (const rec of allRecordings) {
      const recEnd = rec.stoppedAt ?? new Date(nowMs);
      if (gameOverlaps(relationship, { startedAt: rec.startedAt, endedAt: recEnd })) {
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

  // Two-way supersession links follow supersededByRunId only, through the same span overlap that decided it,
  // so a replacement lists only the Learnings it actually displaced.
  const learningsByRun = new Map<string, DerivedLearningRecord[]>();
  for (const l of derivedLearnings) {
    if (l.runId) {
      const arr = learningsByRun.get(l.runId) ?? [];
      arr.push(l);
      learningsByRun.set(l.runId, arr);
    }
  }
  const supersededByMap = new Map<string, string[]>();
  const supersedesMap = new Map<string, string[]>();
  for (const l of derivedLearnings) {
    if (!l.supersededByRunId) continue;
    for (const rep of learningsByRun.get(l.supersededByRunId) ?? []) {
      if (!spansOverlap(l, rep)) continue;
      supersededByMap.set(l.id, [...(supersededByMap.get(l.id) ?? []), rep.id]);
      supersedesMap.set(rep.id, [...(supersedesMap.get(rep.id) ?? []), l.id]);
    }
  }

  /**
   * Debrief fallback: speech outside every Round counts toward the Round that just ended, from the earliest
   * cited speech: the final Round of a Game overlapping that speech's Session, within 2 minutes of its results
   * end and before that Session's next Game starts. Speech in a missing-start successor's gap never takes it.
   */
  const debriefRoundFor = (u: WorkbenchUtterance): string | null => {
    const spokenAt = Date.parse(u.startedAt);
    const sessionGames = allGames
      .filter((g) => gamesById[g.id]?.sessionIds.includes(u.sessionId))
      .map((g) => ({ id: g.id, start: relationshipByGame.get(g.id)?.startedAt.getTime() ?? null }));
    let nearest: { id: string; endedAt: number } | null = null;
    for (const g of sessionGames) {
      const gameRounds = [...(roundRowsByGame.get(g.id) ?? [])].sort((a, b) => a.roundNumber - b.roundNumber);
      const finalRound = gameRounds[gameRounds.length - 1];
      if (!finalRound || !windowsByRound.get(finalRound.id)) continue;
      const endedAt = finalRound.resultsEndTime.getTime();
      if (endedAt > spokenAt || spokenAt - endedAt > DEBRIEF_LINK_WINDOW_MS) continue;
      const nextGameStarted = sessionGames.some(
        (other) => other.start !== null && other.start > finalRound.endTime.getTime() && other.start <= spokenAt,
      );
      if (nextGameStarted) continue;
      if (!nearest || endedAt > nearest.endedAt) nearest = { id: finalRound.id, endedAt };
    }
    return nearest?.id ?? null;
  };

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
        const earliest = l.utteranceIds
          .flatMap((uId) => (utterancesById[uId] ? [utterancesById[uId]!] : []))
          .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
        const fallback = earliest ? debriefRoundFor(earliest) : null;
        if (fallback) debriefRoundIds.push(fallback);
      }
      const allRoundIds = [...new Set([...derivedRoundSet, ...explicitRoundIds, ...debriefRoundIds])];
      const isDebrief = debriefRoundIds.length > 0;

      // A run's Learning belongs to the run's Session; a Manual one to every Session its cited speech and cited
      // Rounds' Games imply (uncited: none).
      let sessionIds: string[];
      if (l.sessionId) {
        sessionIds = [l.sessionId];
      } else {
        const implied = new Set<string>();
        for (const uId of l.utteranceIds) {
          const sesId = utterancesById[uId]?.sessionId;
          if (sesId) implied.add(sesId);
        }
        for (const rId of explicitRoundIds) {
          const game = roundsById[rId] ? gamesById[roundsById[rId]!.gameId] : null;
          for (const sesId of game?.sessionIds ?? []) implied.add(sesId);
        }
        sessionIds = [...implied];
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
        sessionIds,
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
        supersededByLearningIds: supersededByMap.get(l.id) ?? [],
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
    imageIds: c.imageIds,
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

  // The SESSION pane's Session and its run history (#56 0b). ?run= resolves first (X2), else the newest Session.
  let pinMissing = false;
  let pinnedRunSessionId: string | null = null;
  const requestedRunId = options.runId ?? null;
  if (requestedRunId) {
    const run = isUuid(requestedRunId) ? await findRunInDuo(db, duoId, requestedRunId) : null;
    // A run of another Session than a pinned ?sessionId= is foreign (X2).
    if (!run || (options.sessionId && run.sessionId !== options.sessionId)) pinMissing = true;
    else pinnedRunSessionId = run.sessionId;
  }
  const selectedSessionId = options.sessionId ?? pinnedRunSessionId ?? wbSessions[0]?.id ?? null;
  let selectedSession: WorkbenchData["selectedSession"] = null;
  if (selectedSessionId) {
    const listed = wbSessions.find((ses) => ses.id === selectedSessionId);
    const row = listed ? null : allSessions.find((ses) => ses.id === selectedSessionId);
    if (listed) selectedSession = { id: listed.id, startedAt: listed.startedAt, recordingLess: false };
    else if (row) selectedSession = { id: row.id, startedAt: row.createdAt.toISOString(), recordingLess: true };
  }
  let runTimeline: RunTimeline | null = null;
  let rangeJobs: Record<string, WorkRangeJobState> = {};
  if (selectedSession) {
    const callLabelHistory = await deriveCallLabelHistory(db, duoId);
    const manualCurrent = wbLearnings.filter(
      (l) =>
        l.origin === "manual" &&
        l.status === "current" &&
        l.sessionIds.includes(selectedSession.id) &&
        (l.utteranceIds.length > 0 || l.roundIds.length > 0),
    ).length;
    runTimeline = await buildRunTimeline(db, duoId, selectedSession.id, {
      learnings: derivedLearnings,
      callLabelHistory,
      manualCurrent,
      selectedRunId: pinMissing ? null : requestedRunId,
      pinMissing,
    });
    rangeJobs = await sessionWorkRangeJobs(
      db,
      duoId,
      selectedSession.id,
      wbSessions.find((ses) => ses.id === selectedSession.id)?.workRanges ?? [],
    );
  }

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
    selectedSession,
    runTimeline,
    processing: {
      workerOnline: isProcessorOnline(),
      rangeJobs,
    },
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
