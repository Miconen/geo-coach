import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
} from "./recordings.js";

export interface WorkRange {
  sessionId: string;
  purpose: ProcessingRunPurpose;
  startUtc: Date;
  endUtc: Date;
  reason: "unprocessed" | "stale";
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
  startMs: number;
  endMs: number;
  currentVersionId: string | null;
  chunkCount: number;
  effectiveOffsetMs: number;
  deletedRangeCount: number;
}

async function getSessionRecordingStates(
  db: AppDb,
  duoId: string,
  sessionId: string,
): Promise<RecordingCurrentState[]> {
  const recs = await db.query.recordings.findMany({
    where: and(eq(recordings.duoId, duoId), eq(recordings.sessionId, sessionId)),
    orderBy: [asc(recordings.startedAt)],
  });

  const states: RecordingCurrentState[] = [];
  for (const rec of recs) {
    const currentVersionId = await getCurrentTranscriptVersionId(db, rec.id);
    const chunks = currentVersionId
      ? await db.query.transcriptChunks.findMany({
          where: eq(transcriptChunks.transcriptVersionId, currentVersionId),
        })
      : [];

    // Derive endMs from stoppedAt or latest utterance or startedAt + 1s
    let endMs = rec.stoppedAt ? rec.stoppedAt.getTime() : rec.startedAt.getTime();
    if (!rec.stoppedAt && currentVersionId) {
      const latestU = await db.query.utterances.findFirst({
        where: eq(utterances.transcriptVersionId, currentVersionId),
        orderBy: [desc(utterances.endedAt)],
      });
      if (latestU) {
        endMs = Math.max(endMs, latestU.endedAt.getTime());
      }
    }
    if (endMs <= rec.startedAt.getTime() && chunks.length > 0) {
      endMs = rec.startedAt.getTime() + 1000;
    }

    states.push({
      recordingId: rec.id,
      startMs: rec.startedAt.getTime(),
      endMs,
      currentVersionId,
      chunkCount: chunks.length,
      effectiveOffsetMs: rec.effectiveOffsetMs,
      deletedRangeCount: rec.deletedRanges.length,
    });
  }
  return states;
}

/**
 * Derives unprocessed and stale ranges for a Session & purpose per ADR 0001 + ADR 0002.
 */
export async function deriveSessionWorkRanges(
  db: AppDb,
  duoId: string,
  sessionId: string,
  purpose: ProcessingRunPurpose,
): Promise<WorkRange[]> {
  const recStates = await getSessionRecordingStates(db, duoId, sessionId);
  const activeStates = recStates.filter((r) => r.endMs > r.startMs && r.chunkCount > 0);
  if (activeStates.length === 0) return [];

  const sessionIntervals = mergeIntervals(
    activeStates.map((r) => ({ startMs: r.startMs, endMs: r.endMs })),
  );

  const finishedRuns = await db.query.processingRuns.findMany({
    where: and(
      eq(processingRuns.duoId, duoId),
      eq(processingRuns.sessionId, sessionId),
      eq(processingRuns.purpose, purpose),
      eq(processingRuns.status, "finished"),
    ),
    orderBy: [asc(processingRuns.finishedAt), asc(processingRuns.id)],
  });

  if (finishedRuns.length === 0) {
    return sessionIntervals.map((seg) => ({
      sessionId,
      purpose,
      startUtc: new Date(seg.startMs),
      endUtc: new Date(seg.endMs),
      reason: "unprocessed",
    }));
  }

  const runIds = finishedRuns.map((r) => r.id);
  const allInputs = await db.query.processingRunInputs.findMany({
    where: inArray(processingRunInputs.runId, runIds),
  });
  const inputsByRun = new Map<string, Map<string, typeof allInputs[number]>>();
  for (const inp of allInputs) {
    const map = inputsByRun.get(inp.runId) ?? new Map();
    map.set(inp.recordingId, inp);
    inputsByRun.set(inp.runId, map);
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
  for (const run of finishedRuns) {
    const runInterval: Interval = {
      startMs: run.rangeStart.getTime(),
      endMs: run.rangeEnd.getTime(),
    };
    const savedMap = inputsByRun.get(run.id) ?? new Map();

    const changedInThisRun: Interval[] = [];
    for (const rec of activeStates) {
      const overlap = intersectInterval(runInterval, { startMs: rec.startMs, endMs: rec.endMs });
      if (!overlap) continue;

      const saved = savedMap.get(rec.recordingId);
      const changed =
        !saved ||
        saved.transcriptVersionId !== rec.currentVersionId ||
        saved.chunkCount !== rec.chunkCount ||
        saved.effectiveOffsetMs !== rec.effectiveOffsetMs ||
        saved.deletedRangeCount !== rec.deletedRangeCount;

      if (changed) {
        changedInThisRun.push(overlap);
      }
    }

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
    })),
    ...staleIntervals.map((seg) => ({
      sessionId,
      purpose,
      startUtc: new Date(seg.startMs),
      endUtc: new Date(seg.endMs),
      reason: "stale" as const,
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

  const states = await getSessionRecordingStates(db, run.duoId, run.sessionId);
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

  let sourceSpanStart: Date | null = null;
  let sourceSpanEnd: Date | null = null;
  if (input.utteranceIds.length > 0) {
    const us = await db.query.utterances.findMany({
      where: inArray(utterances.id, input.utteranceIds),
    });
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
  const [allLearnings, allRuns, allULinks, allRLinks, allReactions] = await Promise.all([
    db.query.learnings.findMany({
      where: eq(learnings.duoId, duoId),
      orderBy: [desc(learnings.createdAt)],
    }),
    db.query.processingRuns.findMany({
      where: eq(processingRuns.duoId, duoId),
      orderBy: [asc(processingRuns.finishedAt), asc(processingRuns.id)],
    }),
    db.query.learningUtterances.findMany(),
    db.query.learningRounds.findMany(),
    db.query.learningReactions.findMany(),
  ]);

  const runById = new Map(allRuns.map((r) => [r.id, r]));
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
            finishedAt: run.finishedAt,
          }
        : null,
    };
  });
}
