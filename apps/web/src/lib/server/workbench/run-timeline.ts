import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { intervalsOverlap, type ProcessingRunPurpose } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { claimEvidence, claims, processingJobs, processingRuns, sessions } from "../db/schema.js";
import { ALREADY_UP_TO_DATE } from "../mcp/processing-jobs.js";
import {
  evidenceInDuo,
  runInDuo,
  type CallLabelHistoryEntry,
  type DerivedLearningRecord,
} from "../services/index.js";

/** At most this many display rows per Session (no-op groups are collapsed first and not counted). */
export const RUN_TIMELINE_LIMIT = 50;

/**
 * What a run-history row shows. TypeScript-only text: nothing here is stored.
 * - queued: a job waiting for the worker; starting: claimed, its run not created yet.
 * - open / finished / abandoned: the run's own state (a failed job with an abandoned run shows abandoned).
 * - failed / cancelled: a job that never got a run.
 * - run-removed: a job that succeeded but whose run was deleted (run_id set null).
 */
export type RunTimelineStatus =
  | "queued"
  | "starting"
  | "open"
  | "finished"
  | "abandoned"
  | "failed"
  | "cancelled"
  | "run-removed";

export interface RunTimelineCounts {
  /** Outputs still in effect. */
  current: number;
  /** Outputs that still exist (deleted speech removes Learnings, so this is never "written"). */
  surviving: number;
}

export interface RunSupersession {
  runId: string;
  /** This run's outputs the later run displaced (same-purpose span overlap; Calls: per Round label). */
  displaced: number;
  /** Outputs the superseding run wrote; 0 shows "no replacement output". */
  replacementOutputs: number;
}

export interface RunTimelineRow {
  /** Stable row id: run:<id> or job:<id>. */
  key: string;
  runId: string | null;
  jobId: string | null;
  purpose: ProcessingRunPurpose;
  status: RunTimelineStatus;
  error: string | null;
  agent: string | null;
  model: string | null;
  playerId: string | null;
  rangeStart: string;
  rangeEnd: string;
  startedAt: string | null;
  /** Null unless the run finished. */
  finishedAt: string | null;
  sortAt: string;
  /** Active rows sit on top: an active job, or a jobless open run. */
  pinned: boolean;
  /** The run is open or abandoned: its outputs are drafts and not counted as current. */
  draft: boolean;
  learnings: RunTimelineCounts | null;
  callLabels: RunTimelineCounts | null;
  claimsCreated: number;
  claimsWithNewEvidence: number;
  supersededBy: RunSupersession[];
  /** On a collapsed no-op row of the paged history: how many no-op jobs of this purpose it stands for. */
  noOpCount?: number;
}

export interface RunTimelineNoOp {
  purpose: "extract" | "tips";
  count: number;
  newestJobId: string;
  newestAt: string;
}

export interface RunTimeline {
  sessionId: string;
  rows: RunTimelineRow[];
  noOps: RunTimelineNoOp[];
  /** Cited run-less Manual Learnings attributed to this Session that are current. */
  manualCurrent: number;
  /** The ?run= pin when it is not among `rows` (outside the cap). */
  pinnedRun: RunTimelineRow | null;
  selectedRunId: string | null;
  /** A ?run= was asked for but is malformed, missing or foreign: show "no longer exists". */
  pinMissing: boolean;
}

type RunRow = typeof processingRuns.$inferSelect;
type JobRow = typeof processingJobs.$inferSelect;

/** A job whose Session belongs to the job's Duo (stored independently). */
export function jobInDuo(duoId: string) {
  return and(
    eq(processingJobs.duoId, duoId),
    sql`exists (select 1 from ${sessions} s where s.id = ${processingJobs.sessionId} and s.duo_id = ${duoId})`,
  )!;
}

function byTimeDesc(a: { sortAt: string; key: string }, b: { sortAt: string; key: string }) {
  if (a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? 1 : -1;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/**
 * The selected Session's run history (#56 0b): processing jobs and runs merged, newest first, active rows
 * pinned on top, run-less "Already up to date." jobs collapsed to one no-op group per purpose.
 */
export async function buildRunTimeline(
  db: AppDb,
  duoId: string,
  sessionId: string,
  input: {
    learnings: DerivedLearningRecord[];
    callLabelHistory: CallLabelHistoryEntry[];
    manualCurrent: number;
    selectedRunId: string | null;
    pinMissing: boolean;
  },
): Promise<RunTimeline> {
  const [runs, jobs] = await Promise.all([
    db.select().from(processingRuns).where(and(runInDuo(duoId), eq(processingRuns.sessionId, sessionId))),
    db
      .select()
      .from(processingJobs)
      .where(and(jobInDuo(duoId), eq(processingJobs.sessionId, sessionId)))
      .orderBy(asc(processingJobs.createdAt), asc(processingJobs.id)),
  ]);
  const runById = new Map(runs.map((r) => [r.id, r]));

  // A job and run merge only when Duo, Session and purpose agree; a run attached to several jobs shows once,
  // under the earliest job, and the later jobs are not shown.
  const jobOfRun = new Map<string, JobRow>();
  const runlessJobs: JobRow[] = [];
  for (const job of jobs) {
    const run = job.runId ? runById.get(job.runId) : undefined;
    const agrees = run && run.duoId === job.duoId && run.sessionId === job.sessionId && run.purpose === job.purpose;
    if (agrees) {
      if (!jobOfRun.has(run.id)) jobOfRun.set(run.id, job);
    } else {
      runlessJobs.push(job);
    }
  }

  const counts = await outputCounts(db, duoId, runs, input.learnings, input.callLabelHistory);
  const runRows = runs.map((run) => runRow(run, jobOfRun.get(run.id) ?? null, counts));

  const jobRows: RunTimelineRow[] = [];
  const noOps = new Map<"extract" | "tips", RunTimelineNoOp>();
  for (const job of runlessJobs) {
    if (job.status === "cancelled" && job.error === ALREADY_UP_TO_DATE) {
      const at = (job.finishedAt ?? job.createdAt).toISOString();
      const group = noOps.get(job.purpose);
      if (!group) noOps.set(job.purpose, { purpose: job.purpose, count: 1, newestJobId: job.id, newestAt: at });
      else {
        group.count += 1;
        if (at > group.newestAt || (at === group.newestAt && job.id > group.newestJobId)) {
          group.newestAt = at;
          group.newestJobId = job.id;
        }
      }
      continue;
    }
    jobRows.push(jobRow(job));
  }

  const all = [...runRows, ...jobRows];
  const pinned = all.filter((r) => r.pinned).sort(byTimeDesc);
  const rest = all.filter((r) => !r.pinned).sort(byTimeDesc);
  const rows = [...pinned, ...rest].slice(0, RUN_TIMELINE_LIMIT);

  let pinnedRun: RunTimelineRow | null = null;
  if (input.selectedRunId && !rows.some((r) => r.runId === input.selectedRunId)) {
    pinnedRun = runRows.find((r) => r.runId === input.selectedRunId) ?? null;
  }
  const pinMissing = input.pinMissing || (input.selectedRunId !== null && !runById.has(input.selectedRunId));

  return {
    sessionId,
    rows,
    noOps: [...noOps.values()].sort((a, b) => a.purpose.localeCompare(b.purpose)),
    manualCurrent: input.manualCurrent,
    pinnedRun,
    selectedRunId: pinMissing ? null : input.selectedRunId,
    pinMissing,
  };
}

export interface OutputCounts {
  learnings: Map<string, RunTimelineCounts>;
  callLabels: Map<string, RunTimelineCounts>;
  claimsCreated: Map<string, number>;
  claimsWithNewEvidence: Map<string, number>;
  supersededBy: Map<string, RunSupersession[]>;
}

export async function outputCounts(
  db: AppDb,
  duoId: string,
  runs: RunRow[],
  learnings: DerivedLearningRecord[],
  callLabelHistory: CallLabelHistoryEntry[],
): Promise<OutputCounts> {
  const runIds = runs.map((r) => r.id);
  const out: OutputCounts = {
    learnings: new Map(),
    callLabels: new Map(),
    claimsCreated: new Map(),
    claimsWithNewEvidence: new Map(),
    supersededBy: new Map(),
  };
  if (runIds.length === 0) return out;
  const inSession = new Set(runIds);

  // Outputs per run, for counts and for each superseder's "replacement output".
  const outputsByRun = new Map<string, number>();
  const bump = (m: Map<string, RunTimelineCounts>, runId: string, current: boolean) => {
    const c = m.get(runId) ?? { current: 0, surviving: 0 };
    c.surviving += 1;
    if (current) c.current += 1;
    m.set(runId, c);
    outputsByRun.set(runId, (outputsByRun.get(runId) ?? 0) + 1);
  };
  const displaced = new Map<string, Map<string, number>>();
  const displace = (runId: string, by: string) => {
    const m = displaced.get(runId) ?? new Map<string, number>();
    m.set(by, (m.get(by) ?? 0) + 1);
    displaced.set(runId, m);
  };

  for (const l of learnings) {
    if (!l.runId || !inSession.has(l.runId)) continue;
    bump(out.learnings, l.runId, l.status === "current");
    if (l.supersededByRunId) displace(l.runId, l.supersededByRunId);
  }
  for (const label of callLabelHistory) {
    if (!inSession.has(label.runId)) continue;
    bump(out.callLabels, label.runId, label.status === "current");
    if (label.supersededByRunId) displace(label.runId, label.supersededByRunId);
  }
  for (const [runId, by] of displaced) {
    out.supersededBy.set(
      runId,
      [...by.entries()].map(([supersederId, n]) => ({
        runId: supersederId,
        displaced: n,
        replacementOutputs: outputsByRun.get(supersederId) ?? 0,
      })),
    );
  }

  const [created, evidenced] = await Promise.all([
    db
      .select({ runId: claims.runId, n: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(eq(claims.duoId, duoId), inArray(claims.runId, runIds)))
      .groupBy(claims.runId),
    // Claims this run did not create but gave Evidence to, counted once per run (direction-neutral; ADR 0005).
    db
      .select({ runId: claimEvidence.runId, n: sql<number>`count(distinct ${claimEvidence.claimId})::int` })
      .from(claimEvidence)
      .innerJoin(claims, eq(claims.id, claimEvidence.claimId))
      .where(
        and(
          evidenceInDuo(duoId),
          inArray(claimEvidence.runId, runIds),
          sql`${claims.runId} is distinct from ${claimEvidence.runId}`,
        ),
      )
      .groupBy(claimEvidence.runId),
  ]);
  for (const r of created) if (r.runId) out.claimsCreated.set(r.runId, r.n);
  for (const r of evidenced) if (r.runId) out.claimsWithNewEvidence.set(r.runId, r.n);
  return out;
}

export function runRow(run: RunRow, job: JobRow | null, counts: OutputCounts): RunTimelineRow {
  const jobActive = job !== null && (job.status === "queued" || job.status === "running");
  const status: RunTimelineStatus = run.status;
  const finished = run.status === "finished" && run.finishedAt !== null;
  const draft = !finished;
  const learnings = counts.learnings.get(run.id) ?? { current: 0, surviving: 0 };
  const callLabels = counts.callLabels.get(run.id) ?? { current: 0, surviving: 0 };
  return {
    key: `run:${run.id}`,
    runId: run.id,
    jobId: job?.id ?? null,
    purpose: run.purpose,
    status,
    error: run.status === "abandoned" && job?.status === "failed" ? job.error : null,
    agent: run.agent,
    model: run.model,
    playerId: run.startedByPlayerId,
    rangeStart: run.rangeStart.toISOString(),
    rangeEnd: run.rangeEnd.toISOString(),
    startedAt: run.startedAt.toISOString(),
    finishedAt: finished ? run.finishedAt!.toISOString() : null,
    sortAt: (finished ? run.finishedAt! : run.startedAt).toISOString(),
    // A run leaves the pin when its job closes, or, jobless, once it is no longer open.
    pinned: job ? jobActive : run.status === "open",
    draft,
    learnings: run.purpose === "calls" ? null : draft ? { current: 0, surviving: learnings.surviving } : learnings,
    callLabels: run.purpose === "calls" ? (draft ? { current: 0, surviving: callLabels.surviving } : callLabels) : null,
    claimsCreated: counts.claimsCreated.get(run.id) ?? 0,
    claimsWithNewEvidence: counts.claimsWithNewEvidence.get(run.id) ?? 0,
    supersededBy: counts.supersededBy.get(run.id) ?? [],
  };
}

export function jobRow(job: JobRow): RunTimelineRow {
  const status: RunTimelineStatus =
    job.status === "queued"
      ? "queued"
      : job.status === "running"
        ? "starting"
        : job.status === "failed"
          ? "failed"
          : job.status === "cancelled"
            ? "cancelled"
            : "run-removed";
  const active = job.status === "queued" || job.status === "running";
  return {
    key: `job:${job.id}`,
    runId: null,
    jobId: job.id,
    purpose: job.purpose,
    status,
    error: job.error,
    agent: null,
    model: null,
    playerId: job.requestedByPlayerId,
    rangeStart: job.rangeStart.toISOString(),
    rangeEnd: job.rangeEnd.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: null,
    sortAt: (job.finishedAt ?? job.createdAt).toISOString(),
    pinned: active,
    draft: false,
    learnings: null,
    callLabels: null,
    claimsCreated: 0,
    claimsWithNewEvidence: 0,
    supersededBy: [],
  };
}

export interface WorkRangeJobState {
  running: number;
  queued: number;
  /** The newest failure's message, when the newest job of some chunk failed. */
  failed: string | null;
}

/** The key the workbench uses for a pending work range. */
export function workRangeKey(sessionId: string, wr: { purpose: string; startUtc: string }) {
  return `${sessionId}:${wr.purpose}:${wr.startUtc}`;
}

/**
 * Active jobs and the latest failure for each of a Session's pending work ranges. Scoped to the Session (not
 * the Duo's last 50 jobs), newest job per chunk start before status, so an older failure never resurfaces
 * after a newer success or cancellation.
 */
export async function sessionWorkRangeJobs(
  db: AppDb,
  duoId: string,
  sessionId: string,
  ranges: Array<{ purpose: string; startUtc: string; endUtc: string }>,
): Promise<Record<string, WorkRangeJobState>> {
  const out: Record<string, WorkRangeJobState> = {};
  if (ranges.length === 0) return out;
  const jobs = await db
    .select()
    .from(processingJobs)
    .where(and(jobInDuo(duoId), eq(processingJobs.sessionId, sessionId)))
    .orderBy(sql`${processingJobs.createdAt} desc`, sql`${processingJobs.id} desc`);
  for (const wr of ranges) {
    const range = { startedAt: new Date(wr.startUtc), endedAt: new Date(wr.endUtc) };
    const newestPerChunk = new Map<number, JobRow>();
    for (const job of jobs) {
      if (job.purpose !== wr.purpose) continue;
      if (!intervalsOverlap({ startedAt: job.rangeStart, endedAt: job.rangeEnd }, range)) continue;
      const chunk = job.rangeStart.getTime();
      if (!newestPerChunk.has(chunk)) newestPerChunk.set(chunk, job);
    }
    const newest = [...newestPerChunk.values()];
    const failed = newest
      .filter((j) => j.status === "failed")
      .sort((a, b) => (b.finishedAt ?? b.createdAt).getTime() - (a.finishedAt ?? a.createdAt).getTime())[0];
    out[workRangeKey(sessionId, wr)] = {
      running: newest.filter((j) => j.status === "running").length,
      queued: newest.filter((j) => j.status === "queued").length,
      failed: failed ? (failed.error ?? "Processing failed.") : null,
    };
  }
  return out;
}
