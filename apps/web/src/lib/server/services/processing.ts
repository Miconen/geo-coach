import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  RUN_ABANDON_MS,
  intervalsOverlap,
  uuidv7,
  type LearningKind,
  type LearningRegion,
  type LearningRunPurpose,
  type ManualLearningInput,
  type ProcessingRunPurpose,
  type ReactionType,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  callLabels,
  learnings,
  learningReactions,
  learningRounds,
  learningUtterances,
  processingRunInputs,
  processingRuns,
  recordings,
  transcriptChunks,
  utterances,
} from "../db/schema.js";
import {
  DomainError,
  assertPlayerInDuo,
  getCurrentTranscriptVersionId,
  getCurrentTranscriptVersionIds,
} from "./recordings.js";
import { recordingInDuo, roundInDuo, runInDuo, speechInDuo } from "./scope.js";
import { isUuid } from "../../uuid.js";
import { rounds, sessions } from "../db/schema.js";

/** Clock estimates wobble by a few ms; only a shift that could move speech between Rounds counts. */
const STALE_CLOCK_TOLERANCE_MS = 250;

export type WorkRangeChange =
  | "not-processed"
  | "missing-from-run"
  | "retranscribed"
  | "chunks-changed"
  | "clock"
  | "speech-deleted";

/** Which Recording put a range on the work list, and what changed since the last run read it. */
export interface WorkRangeCause {
  recordingId: string;
  playerId: string;
  changes: WorkRangeChange[];
  newChunks: number;
  clockShiftMs: number;
  lastRun: {
    startedByPlayerId: string;
    agent: string;
    model: string;
    finishedAt: Date | null;
  } | null;
}

export interface WorkRange {
  sessionId: string;
  purpose: ProcessingRunPurpose;
  startUtc: Date;
  endUtc: Date;
  reason: "unprocessed" | "stale";
  causes: WorkRangeCause[];
}

interface Interval {
  startMs: number;
  endMs: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];
  const merged: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = merged[merged.length - 1]!;
    if (cur.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function subtractIntervals(base: Interval[], subtract: Interval[]): Interval[] {
  let result = mergeIntervals(base);
  const cuts = mergeIntervals(subtract);
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const seg of result) {
      if (cut.endMs <= seg.startMs || cut.startMs >= seg.endMs) {
        next.push(seg);
      } else {
        if (cut.startMs > seg.startMs) {
          next.push({ startMs: seg.startMs, endMs: cut.startMs });
        }
        if (cut.endMs < seg.endMs) {
          next.push({ startMs: cut.endMs, endMs: seg.endMs });
        }
      }
    }
    result = next;
  }
  return result;
}

function intersectInterval(a: Interval, b: Interval): Interval | null {
  const startMs = Math.max(a.startMs, b.startMs);
  const endMs = Math.min(a.endMs, b.endMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

interface RecordingCurrentState {
  recordingId: string;
  playerId: string;
  startMs: number;
  endMs: number;
  currentVersionId: string | null;
  chunkCount: number;
  effectiveOffsetMs: number;
  deletedRangeCount: number;
}

/**
 * Current Recording states for the given Sessions (all of the Duo's when null), batched: one query each for
 * Recordings, elected versions and chunk counts, whatever the number of Sessions.
 */
async function getRecordingStatesBySession(
  db: AppDb,
  duoId: string,
  sessionIds: readonly string[] | null,
): Promise<Map<string, RecordingCurrentState[]>> {
  const out = new Map<string, RecordingCurrentState[]>();
  if (sessionIds !== null && sessionIds.length === 0) return out;
  const recs = await db.query.recordings.findMany({
    where:
      sessionIds === null
        ? recordingInDuo(duoId)
        : and(recordingInDuo(duoId), inArray(recordings.sessionId, [...sessionIds])),
    orderBy: [asc(recordings.startedAt)],
  });

  // Versions elected and chunks counted in one query each (#56 1a-derivation).
  const versionByRecording = await getCurrentTranscriptVersionIds(
    db,
    recs.map((r) => r.id),
  );
  const versionIds = [...versionByRecording.values()];
  const chunkCounts =
    versionIds.length > 0
      ? await db
          .select({
            transcriptVersionId: transcriptChunks.transcriptVersionId,
            recordingId: transcriptChunks.recordingId,
            count: sql<number>`count(*)::int`,
          })
          .from(transcriptChunks)
          .where(inArray(transcriptChunks.transcriptVersionId, versionIds))
          .groupBy(transcriptChunks.transcriptVersionId, transcriptChunks.recordingId)
      : [];
  // A chunk counts only when it belongs to the version's own Recording.
  const chunkCount = new Map(chunkCounts.map((c) => [`${c.transcriptVersionId}:${c.recordingId}`, Number(c.count)]));

  for (const rec of recs) {
    const currentVersionId = versionByRecording.get(rec.id) ?? null;
    const chunks = currentVersionId ? (chunkCount.get(`${currentVersionId}:${rec.id}`) ?? 0) : 0;

    // Derive endMs from stoppedAt or latest utterance or startedAt + 1s
    let endMs = rec.stoppedAt ? rec.stoppedAt.getTime() : rec.startedAt.getTime();
    if (!rec.stoppedAt && currentVersionId) {
      const latestU = await db.query.utterances.findFirst({
        where: and(eq(utterances.transcriptVersionId, currentVersionId), speechInDuo(duoId)),
        orderBy: [desc(utterances.endedAt)],
      });
      if (latestU) {
        endMs = Math.max(endMs, latestU.endedAt.getTime());
      }
    }
    if (endMs <= rec.startedAt.getTime() && chunks > 0) {
      endMs = rec.startedAt.getTime() + 1000;
    }

    const list = out.get(rec.sessionId) ?? [];
    list.push({
      recordingId: rec.id,
      playerId: rec.playerId,
      startMs: rec.startedAt.getTime(),
      endMs,
      currentVersionId,
      chunkCount: chunks,
      effectiveOffsetMs: rec.effectiveOffsetMs,
      deletedRangeCount: rec.deletedRanges.length,
    });
    out.set(rec.sessionId, list);
  }
  return out;
}

function compareRunInput(
  rec: RecordingCurrentState,
  saved:
    | { transcriptVersionId: string; chunkCount: number; effectiveOffsetMs: number; deletedRangeCount: number }
    | undefined,
): Pick<WorkRangeCause, "changes" | "newChunks" | "clockShiftMs"> {
  if (!saved) return { changes: ["missing-from-run"], newChunks: 0, clockShiftMs: 0 };

  const changes: WorkRangeChange[] = [];
  let newChunks = 0;
  if (saved.transcriptVersionId !== rec.currentVersionId) {
    changes.push("retranscribed");
  } else if (saved.chunkCount !== rec.chunkCount) {
    changes.push("chunks-changed");
    newChunks = rec.chunkCount - saved.chunkCount;
  }
  const clockShiftMs = rec.effectiveOffsetMs - saved.effectiveOffsetMs;
  if (Math.abs(clockShiftMs) > STALE_CLOCK_TOLERANCE_MS) changes.push("clock");
  if (saved.deletedRangeCount !== rec.deletedRangeCount) changes.push("speech-deleted");
  return { changes, newChunks, clockShiftMs };
}

function causesOverlapping(
  entries: Array<{ interval: Interval; cause: WorkRangeCause }>,
  seg: Interval,
): WorkRangeCause[] {
  const byRecording = new Map<string, WorkRangeCause>();
  for (const e of entries) {
    if (intersectInterval(e.interval, seg)) byRecording.set(e.cause.recordingId, e.cause);
  }
  return [...byRecording.values()];
}

type FinishedRun = typeof processingRuns.$inferSelect;
type RunInput = typeof processingRunInputs.$inferSelect;

/**
 * Derives unprocessed and stale ranges for a Session & purpose per ADR 0001 + ADR 0002.
 */
export async function deriveSessionWorkRanges(
  db: AppDb,
  duoId: string,
  sessionId: string,
  purpose: ProcessingRunPurpose,
): Promise<WorkRange[]> {
  const all = await deriveWorkRangesBySession(db, duoId, [purpose], [sessionId]);
  return all.get(sessionId)?.[purpose] ?? [];
}

/**
 * Work ranges for many Sessions and purposes at once (all of the Duo's Sessions when sessionIds is omitted): the
 * same derivation as deriveSessionWorkRanges with a fixed number of queries, so pages and the pending-work badge
 * no longer cost several queries per Session. Sessions without ranges are absent or map to empty lists.
 */
export async function deriveWorkRangesBySession<P extends ProcessingRunPurpose>(
  db: AppDb,
  duoId: string,
  purposes: readonly P[],
  sessionIds: readonly string[] | null = null,
): Promise<Map<string, Record<P, WorkRange[]>>> {
  const out = new Map<string, Record<P, WorkRange[]>>();
  const states = await getRecordingStatesBySession(db, duoId, sessionIds);
  const activeSessionIds = [...states.keys()];
  if (activeSessionIds.length === 0 || purposes.length === 0) return out;

  const runs = await db.query.processingRuns.findMany({
    where: and(
      eq(processingRuns.duoId, duoId),
      inArray(processingRuns.sessionId, activeSessionIds),
      inArray(processingRuns.purpose, [...purposes]),
      eq(processingRuns.status, "finished"),
    ),
    orderBy: [asc(processingRuns.finishedAt), asc(processingRuns.id)],
  });
  const inputs =
    runs.length > 0
      ? await db.query.processingRunInputs.findMany({
          where: inArray(
            processingRunInputs.runId,
            runs.map((r) => r.id),
          ),
        })
      : [];
  const inputsByRun = new Map<string, Map<string, RunInput>>();
  for (const inp of inputs) {
    const map = inputsByRun.get(inp.runId) ?? new Map();
    map.set(inp.recordingId, inp);
    inputsByRun.set(inp.runId, map);
  }

  for (const [sessionId, recStates] of states) {
    const entry = {} as Record<P, WorkRange[]>;
    for (const purpose of purposes) {
      const finishedRuns = runs.filter((r) => r.sessionId === sessionId && r.purpose === purpose);
      entry[purpose] = computeWorkRanges(sessionId, purpose, recStates, finishedRuns, inputsByRun);
    }
    out.set(sessionId, entry);
  }
  return out;
}

function computeWorkRanges(
  sessionId: string,
  purpose: ProcessingRunPurpose,
  recStates: RecordingCurrentState[],
  finishedRuns: FinishedRun[],
  inputsByRun: Map<string, Map<string, RunInput>>,
): WorkRange[] {
  const activeStates = recStates.filter((r) => r.endMs > r.startMs && r.chunkCount > 0);
  if (activeStates.length === 0) return [];

  const sessionIntervals = mergeIntervals(
    activeStates.map((r) => ({ startMs: r.startMs, endMs: r.endMs })),
  );
  const unprocessedEntries = activeStates.map((r) => ({
    interval: { startMs: r.startMs, endMs: r.endMs },
    cause: {
      recordingId: r.recordingId,
      playerId: r.playerId,
      changes: ["not-processed"] as WorkRangeChange[],
      newChunks: 0,
      clockShiftMs: 0,
      lastRun: null,
    },
  }));

  if (finishedRuns.length === 0) {
    return sessionIntervals.map((seg) => ({
      sessionId,
      purpose,
      startUtc: new Date(seg.startMs),
      endUtc: new Date(seg.endMs),
      reason: "unprocessed",
      causes: causesOverlapping(unprocessedEntries, seg),
    }));
  }

  // Evaluate freshness of each finished run against current Recording states;
  // a later fresh run clears staleness over its range.
  const allCoveredIntervals = mergeIntervals(
    finishedRuns.map((r) => ({
      startMs: r.rangeStart.getTime(),
      endMs: r.rangeEnd.getTime(),
    })),
  );
  const unprocessedIntervals = subtractIntervals(sessionIntervals, allCoveredIntervals);

  let staleIntervals: Interval[] = [];
  let staleCauses: Array<{ interval: Interval; cause: WorkRangeCause }> = [];
  for (const run of finishedRuns) {
    const runInterval: Interval = {
      startMs: run.rangeStart.getTime(),
      endMs: run.rangeEnd.getTime(),
    };
    const savedMap = inputsByRun.get(run.id) ?? new Map();

    const changedInThisRun: Interval[] = [];
    const runCauses: typeof staleCauses = [];
    for (const rec of activeStates) {
      const overlap = intersectInterval(runInterval, { startMs: rec.startMs, endMs: rec.endMs });
      if (!overlap) continue;

      const difference = compareRunInput(rec, savedMap.get(rec.recordingId));
      if (difference.changes.length > 0) {
        changedInThisRun.push(overlap);
        runCauses.push({
          interval: overlap,
          cause: {
            recordingId: rec.recordingId,
            playerId: rec.playerId,
            ...difference,
            lastRun: {
              startedByPlayerId: run.startedByPlayerId,
              agent: run.agent,
              model: run.model,
              finishedAt: run.finishedAt,
            },
          },
        });
      }
    }
    // This run re-judged its whole range, so it replaces earlier causes there.
    staleCauses = staleCauses.flatMap((e) =>
      subtractIntervals([e.interval], [runInterval]).map((interval) => ({ interval, cause: e.cause })),
    );
    staleCauses.push(...runCauses);

    if (changedInThisRun.length === 0) {
      // This run is completely fresh -> clears any earlier staleness it overlaps
      staleIntervals = subtractIntervals(staleIntervals, [runInterval]);
    } else {
      // Clear unaffected part of this run, add changed parts as stale
      const freshParts = subtractIntervals([runInterval], changedInThisRun);
      staleIntervals = subtractIntervals(staleIntervals, freshParts);
      staleIntervals = mergeIntervals([...staleIntervals, ...changedInThisRun]);
    }
  }

  const results: WorkRange[] = [
    ...unprocessedIntervals.map((seg) => ({
      sessionId,
      purpose,
      startUtc: new Date(seg.startMs),
      endUtc: new Date(seg.endMs),
      reason: "unprocessed" as const,
      causes: causesOverlapping(unprocessedEntries, seg),
    })),
    ...staleIntervals.map((seg) => ({
      sessionId,
      purpose,
      startUtc: new Date(seg.startMs),
      endUtc: new Date(seg.endMs),
      reason: "stale" as const,
      causes: causesOverlapping(staleCauses, seg),
    })),
  ];

  results.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return results;
}

export async function startProcessingRun(
  db: AppDb,
  input: {
    duoId: string;
    sessionId: string;
    startedByPlayerId: string;
    purpose: ProcessingRunPurpose;
    agent: string;
    model: string;
    promptVersion: string;
    rangeStart: Date;
    rangeEnd: Date;
    now?: Date;
  },
) {
  await assertPlayerInDuo(db, input.startedByPlayerId, input.duoId);
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, input.sessionId), eq(sessions.duoId, input.duoId)),
  });
  if (!session) {
    throw new DomainError("NOT_FOUND", "Session not found", 404);
  }
  if (input.rangeEnd.getTime() <= input.rangeStart.getTime()) {
    throw new DomainError("INVALID_RANGE", "rangeEnd must be after rangeStart", 400);
  }

  const now = input.now ?? new Date();

  // Abandon stale open runs older than 2 hours
  const openRuns = await db.query.processingRuns.findMany({
    where: and(
      eq(processingRuns.duoId, input.duoId),
      eq(processingRuns.sessionId, input.sessionId),
      eq(processingRuns.purpose, input.purpose),
      eq(processingRuns.status, "open"),
    ),
  });

  for (const open of openRuns) {
    if (now.getTime() - open.startedAt.getTime() >= RUN_ABANDON_MS) {
      await db
        .update(processingRuns)
        .set({ status: "abandoned" })
        .where(eq(processingRuns.id, open.id));
      continue;
    }

    if (
      intervalsOverlap(
        { startedAt: input.rangeStart, endedAt: input.rangeEnd },
        { startedAt: open.rangeStart, endedAt: open.rangeEnd },
      )
    ) {
      throw new DomainError(
        "RUN_CONFLICT",
        `Overlaps open ${input.purpose} Processing run ${open.id}`,
        409,
      );
    }
  }

  const id = uuidv7(now.getTime());
  await db.insert(processingRuns).values({
    id,
    duoId: input.duoId,
    sessionId: input.sessionId,
    startedByPlayerId: input.startedByPlayerId,
    purpose: input.purpose,
    agent: input.agent,
    model: input.model,
    promptVersion: input.promptVersion,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    status: "open",
    startedAt: now,
  });

  return {
    id,
    duoId: input.duoId,
    sessionId: input.sessionId,
    purpose: input.purpose,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    promptVersion: input.promptVersion,
  };
}

export async function insertRunLearnings(
  db: AppDb,
  runId: string,
  duoId: string,
  purpose: LearningRunPurpose,
  items: Array<{
    kind: LearningKind;
    text: string;
    detail?: string | null;
    countries: string[];
    regions: LearningRegion[];
    topics: string[];
    origin: "speech" | "agent";
    agentNote?: string | null;
    utteranceIds: string[];
    roundIds: string[];
    claimId?: string | null;
    sourceSpanStart: Date;
    sourceSpanEnd: Date;
  }>,
): Promise<string[]> {
  const createdIds: string[] = [];
  for (const item of items) {
    const id = uuidv7();
    await db.insert(learnings).values({
      id,
      duoId,
      runId,
      purpose,
      kind: item.kind,
      origin: item.origin,
      text: item.text,
      detail: item.detail ?? null,
      countries: item.countries,
      regions: item.regions,
      topics: item.topics,
      agentNote: item.agentNote ?? null,
      claimId: item.claimId ?? null,
      sourceSpanStart: item.sourceSpanStart,
      sourceSpanEnd: item.sourceSpanEnd,
    });

    if (item.utteranceIds.length > 0) {
      await db
        .insert(learningUtterances)
        .values(item.utteranceIds.map((utteranceId) => ({ learningId: id, utteranceId })))
        .onConflictDoNothing();
    }
    if (item.roundIds.length > 0) {
      await db
        .insert(learningRounds)
        .values(item.roundIds.map((roundId) => ({ learningId: id, roundId })))
        .onConflictDoNothing();
    }
    createdIds.push(id);
  }
  return createdIds;
}

export async function finishProcessingRun(
  db: AppDb,
  runId: string,
  now: Date = new Date(),
): Promise<{ runId: string; inputCount: number; learningCount: number; callLabelCount: number }> {
  const run = await db.query.processingRuns.findFirst({
    where: eq(processingRuns.id, runId),
  });
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  if (run.status !== "open") {
    throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
  }

  const states = (await getRecordingStatesBySession(db, run.duoId, [run.sessionId])).get(run.sessionId) ?? [];
  const overlapping = states.filter(
    (rec) =>
      rec.currentVersionId !== null &&
      rec.chunkCount > 0 &&
      intervalsOverlap(
        { startedAt: new Date(rec.startMs), endedAt: new Date(rec.endMs) },
        { startedAt: run.rangeStart, endedAt: run.rangeEnd },
      ),
  );

  for (const rec of overlapping) {
    await db
      .insert(processingRunInputs)
      .values({
        runId: run.id,
        recordingId: rec.recordingId,
        transcriptVersionId: rec.currentVersionId!,
        chunkCount: rec.chunkCount,
        effectiveOffsetMs: rec.effectiveOffsetMs,
        deletedRangeCount: rec.deletedRangeCount,
      })
      .onConflictDoNothing();
  }

  await db
    .update(processingRuns)
    .set({ status: "finished", finishedAt: now })
    .where(eq(processingRuns.id, run.id));

  const [runLearnings, runCallLabels] = await Promise.all([
    db.query.learnings.findMany({ where: eq(learnings.runId, run.id) }),
    db.query.callLabels.findMany({ where: eq(callLabels.runId, run.id) }),
  ]);

  return {
    runId: run.id,
    inputCount: overlapping.length,
    learningCount: runLearnings.length,
    callLabelCount: runCallLabels.length,
  };
}

export async function createManualLearning(
  db: AppDb,
  playerId: string,
  input: ManualLearningInput,
): Promise<string> {
  await assertPlayerInDuo(db, playerId, input.duoId);

  for (const id of [...input.utteranceIds, ...input.roundIds]) {
    if (!isUuid(id)) throw new DomainError("INVALID_ID", "Invalid Utterance or Round id", 400);
  }
  // Every cited Round must pass the Round/Game check; a missing or foreign one is a 404, never dropped.
  if (input.roundIds.length > 0) {
    const found = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(inArray(rounds.id, input.roundIds), roundInDuo(input.duoId)));
    if (new Set(found.map((r) => r.id)).size !== new Set(input.roundIds).size) {
      throw new DomainError("NOT_FOUND", "Round not found", 404);
    }
  }

  let sourceSpanStart: Date | null = null;
  let sourceSpanEnd: Date | null = null;
  if (input.utteranceIds.length > 0) {
    const us = await db.query.utterances.findMany({
      where: and(inArray(utterances.id, input.utteranceIds), speechInDuo(input.duoId)),
    });
    if (new Set(us.map((u) => u.id)).size !== new Set(input.utteranceIds).size) {
      throw new DomainError("NOT_FOUND", "Utterance not found", 404);
    }
    for (const u of us) {
      if (!sourceSpanStart || u.startedAt < sourceSpanStart) sourceSpanStart = u.startedAt;
      if (!sourceSpanEnd || u.endedAt > sourceSpanEnd) sourceSpanEnd = u.endedAt;
    }
  }

  const id = uuidv7();
  await db.insert(learnings).values({
    id,
    duoId: input.duoId,
    runId: null,
    authorPlayerId: playerId,
    purpose: null,
    kind: input.kind,
    origin: "manual",
    text: input.text,
    detail: input.detail ?? null,
    countries: input.countries,
    regions: input.regions,
    topics: input.topics,
    sourceSpanStart,
    sourceSpanEnd,
  });

  if (input.utteranceIds.length > 0) {
    await db
      .insert(learningUtterances)
      .values(input.utteranceIds.map((utteranceId) => ({ learningId: id, utteranceId })))
      .onConflictDoNothing();
  }
  if (input.roundIds.length > 0) {
    await db
      .insert(learningRounds)
      .values(input.roundIds.map((roundId) => ({ learningId: id, roundId })))
      .onConflictDoNothing();
  }

  return id;
}

export async function toggleReaction(
  db: AppDb,
  learningId: string,
  playerId: string,
  reaction: ReactionType,
): Promise<{ active: boolean }> {
  const existing = await db.query.learningReactions.findFirst({
    where: and(
      eq(learningReactions.learningId, learningId),
      eq(learningReactions.playerId, playerId),
      eq(learningReactions.reaction, reaction),
    ),
  });

  if (existing) {
    await db
      .delete(learningReactions)
      .where(
        and(
          eq(learningReactions.learningId, learningId),
          eq(learningReactions.playerId, playerId),
          eq(learningReactions.reaction, reaction),
        ),
      );
    return { active: false };
  }

  await db.insert(learningReactions).values({
    learningId,
    playerId,
    reaction,
  });
  return { active: true };
}

export interface DerivedLearningRecord {
  id: string;
  duoId: string;
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
  claimId: string | null;
  sourceSpanStart: Date | null;
  sourceSpanEnd: Date | null;
  createdAt: Date;
  status: "current" | "superseded" | "draft";
  supersededByRunId: string | null;
  utteranceIds: string[];
  explicitRoundIds: string[];
  reactions: Array<{ playerId: string; reaction: ReactionType; createdAt: Date }>;
  runMeta: {
    agent: string;
    model: string;
    promptVersion: string;
    finishedAt: Date | null;
  } | null;
}

/**
 * Derives current / superseded / draft status for all Learnings in a Duo
 * strictly per ADR 0001 + ADR 0002.
 */
export async function deriveLearningsWithStatus(
  db: AppDb,
  duoId: string,
): Promise<DerivedLearningRecord[]> {
  // Link and reaction rows are read through this Duo's Learnings, and Utterance/Round links also through the
  // speech and Round/Game checks, so cross-Duo rows never attach.
  const [allLearningsRaw, allRuns, allULinks, allRLinks, allReactions] = await Promise.all([
    db.query.learnings.findMany({
      where: eq(learnings.duoId, duoId),
      orderBy: [desc(learnings.createdAt)],
    }),
    db.query.processingRuns.findMany({
      where: runInDuo(duoId),
      orderBy: [asc(processingRuns.finishedAt), asc(processingRuns.id)],
    }),
    db
      .select({ learningId: learningUtterances.learningId, utteranceId: learningUtterances.utteranceId })
      .from(learningUtterances)
      .innerJoin(learnings, eq(learnings.id, learningUtterances.learningId))
      .innerJoin(utterances, eq(utterances.id, learningUtterances.utteranceId))
      .where(and(eq(learnings.duoId, duoId), speechInDuo(duoId))),
    db
      .select({ learningId: learningRounds.learningId, roundId: learningRounds.roundId })
      .from(learningRounds)
      .innerJoin(learnings, eq(learnings.id, learningRounds.learningId))
      .innerJoin(rounds, eq(rounds.id, learningRounds.roundId))
      .where(and(eq(learnings.duoId, duoId), roundInDuo(duoId))),
    db
      .select({
        learningId: learningReactions.learningId,
        playerId: learningReactions.playerId,
        reaction: learningReactions.reaction,
        createdAt: learningReactions.createdAt,
      })
      .from(learningReactions)
      .innerJoin(learnings, eq(learnings.id, learningReactions.learningId))
      .where(eq(learnings.duoId, duoId)),
  ]);

  const runById = new Map(allRuns.map((r) => [r.id, r]));
  // Run ownership: a Learning whose run fails the run-to-Session check is excluded everywhere;
  // run-less Manual Learnings survive.
  const allLearnings = allLearningsRaw.filter((l) => l.runId === null || runById.has(l.runId));
  const finishedRuns = allRuns.filter((r) => r.status === "finished" && r.finishedAt !== null);

  const uByLearning = new Map<string, string[]>();
  for (const row of allULinks) {
    const arr = uByLearning.get(row.learningId) ?? [];
    arr.push(row.utteranceId);
    uByLearning.set(row.learningId, arr);
  }

  const rByLearning = new Map<string, string[]>();
  for (const row of allRLinks) {
    const arr = rByLearning.get(row.learningId) ?? [];
    arr.push(row.roundId);
    rByLearning.set(row.learningId, arr);
  }

  const reactByLearning = new Map<
    string,
    Array<{ playerId: string; reaction: ReactionType; createdAt: Date }>
  >();
  for (const row of allReactions) {
    const arr = reactByLearning.get(row.learningId) ?? [];
    arr.push({ playerId: row.playerId, reaction: row.reaction, createdAt: row.createdAt });
    reactByLearning.set(row.learningId, arr);
  }

  return allLearnings.map((l) => {
    const run = l.runId ? runById.get(l.runId) ?? null : null;

    let status: "current" | "superseded" | "draft" = "current";
    let supersededByRunId: string | null = null;

    if (l.origin !== "manual" && run) {
      if (run.status !== "finished" || !run.finishedAt) {
        status = "draft";
      } else if (l.sourceSpanStart && l.sourceSpanEnd) {
        const span = { startedAt: l.sourceSpanStart, endedAt: l.sourceSpanEnd };
        // Find the earliest later finished run in the same Session & same purpose whose range overlaps sourceSpan
        const superseder = finishedRuns.find((other) => {
          if (other.id === run.id) return false;
          if (other.sessionId !== run.sessionId) return false;
          if (other.purpose !== run.purpose) return false;
          const otherFin = other.finishedAt!.getTime();
          const runFin = run.finishedAt!.getTime();
          if (otherFin < runFin || (otherFin === runFin && other.id <= run.id)) return false;
          return intervalsOverlap(span, { startedAt: other.rangeStart, endedAt: other.rangeEnd });
        });

        if (superseder) {
          status = "superseded";
          supersededByRunId = superseder.id;
        }
      }
    }

    return {
      id: l.id,
      duoId: l.duoId,
      runId: l.runId,
      sessionId: run?.sessionId ?? null,
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
      sourceSpanStart: l.sourceSpanStart,
      sourceSpanEnd: l.sourceSpanEnd,
      createdAt: l.createdAt,
      status,
      supersededByRunId,
      utteranceIds: uByLearning.get(l.id) ?? [],
      explicitRoundIds: rByLearning.get(l.id) ?? [],
      reactions: reactByLearning.get(l.id) ?? [],
      runMeta: run
        ? {
            agent: run.agent,
            model: run.model,
            promptVersion: run.promptVersion,
            finishedAt: run.status === "finished" ? run.finishedAt : null,
          }
        : null,
    };
  });
}
