import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { intervalsOverlap, uuidv7 } from "@geo-coach/shared";
import { hashToken } from "../auth/index.js";
import type { AppDb } from "../db/index.js";
import { learnings, processingJobs, processingRuns, recordings } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import { DomainError, assertPlayerInDuo } from "../services/index.js";
import { mcpListWork, mcpStartRun } from "./workflow.js";

export const JOB_TOKEN_PREFIX = "gc_job_";
const LEASE_MS = 3 * 60 * 1000;
const PROCESSOR_ONLINE_MS = 45 * 1000;
const WORKER_AGENT = "geo-coach-worker";

export type ProcessingJobPurpose = "extract" | "tips";
type JobRow = typeof processingJobs.$inferSelect;

/** What a job's short-lived MCP token may touch. */
export interface ProcessingJobScope {
  jobId: string;
  playerId: string;
  duoId: string;
  runId: string;
  purpose: ProcessingJobPurpose;
}

let processorSeenAt = 0;

export function isProcessorOnline(now: number = Date.now()): boolean {
  return now - processorSeenAt < PROCESSOR_ONLINE_MS;
}

export function verifyProcessorSecret(rawToken: string | null): boolean {
  const secret = process.env.PROCESSOR_SECRET;
  if (!secret || !rawToken) return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(rawToken).digest();
  return timingSafeEqual(expected, actual);
}

function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return intervalsOverlap(
    { startedAt: a.start, endedAt: a.end },
    { startedAt: b.start, endedAt: b.end },
  );
}

async function assertSessionNotRecording(db: AppDb, duoId: string, sessionId: string) {
  const liveIds = duoEventBus
    .getLiveStatuses(duoId)
    .flatMap((s) => (s.recording && s.recordingId ? [s.recordingId] : []));
  if (liveIds.length === 0) return;
  const live = await db.query.recordings.findFirst({
    where: and(eq(recordings.sessionId, sessionId), inArray(recordings.id, liveIds)),
  });
  if (live) {
    throw new DomainError(
      "RECORDING_IN_PROGRESS",
      "This Session is still recording. Process it after you stop.",
      409,
    );
  }
}

/** Queues the clicked range, one job per ~25k-token chunk, skipping chunks already queued. */
export async function enqueueProcessingJobs(
  db: AppDb,
  playerId: string,
  input: {
    duoId: string;
    sessionId: string;
    purpose: ProcessingJobPurpose;
    startUtc: Date;
    endUtc: Date;
  },
): Promise<{ queued: number; alreadyActive: number }> {
  await assertPlayerInDuo(db, playerId, input.duoId);
  await assertSessionNotRecording(db, input.duoId, input.sessionId);

  const clicked = { start: input.startUtc, end: input.endUtc };
  const { ranges } = await mcpListWork(db, playerId, { purpose: input.purpose, duo: input.duoId });
  const wanted = ranges
    .filter((r) => r.sessionId === input.sessionId)
    .map((r) => ({ start: new Date(r.startUtc), end: new Date(r.endUtc) }))
    .filter((r) => overlaps(r, clicked));
  if (wanted.length === 0) {
    throw new DomainError("NOTHING_TO_PROCESS", "This range is already up to date.", 409);
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}))`);
    const active = await tx
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.duoId, input.duoId),
          eq(processingJobs.sessionId, input.sessionId),
          eq(processingJobs.purpose, input.purpose),
          inArray(processingJobs.status, ["queued", "running"]),
        ),
      );
    const fresh = wanted.filter(
      (r) => !active.some((j) => overlaps(r, { start: j.rangeStart, end: j.rangeEnd })),
    );
    if (fresh.length > 0) {
      await tx.insert(processingJobs).values(
        fresh.map((r) => ({
          id: uuidv7(),
          duoId: input.duoId,
          sessionId: input.sessionId,
          requestedByPlayerId: playerId,
          purpose: input.purpose,
          rangeStart: r.start,
          rangeEnd: r.end,
        })),
      );
    }
    return { queued: fresh.length, alreadyActive: wanted.length - fresh.length };
  });

  if (result.queued > 0) duoEventBus.emitChanged(input.duoId, "processing", input.sessionId);
  return result;
}

async function closeJob(
  db: AppDb,
  job: JobRow,
  status: "succeeded" | "failed" | "cancelled",
  error: string | null,
) {
  await db
    .update(processingJobs)
    .set({ status, error, tokenHash: null, leaseExpiresAt: null, finishedAt: new Date() })
    .where(and(eq(processingJobs.id, job.id), inArray(processingJobs.status, ["queued", "running"])));
  duoEventBus.emitChanged(job.duoId, "processing", job.sessionId);
}

async function expireProcessingJobs(db: AppDb, now: Date) {
  const expired = await db.query.processingJobs.findMany({
    where: and(eq(processingJobs.status, "running"), lt(processingJobs.leaseExpiresAt, now)),
  });
  for (const job of expired) {
    await finishProcessingJob(db, job.id, {
      ok: false,
      error: "The worker stopped responding. Try again.",
    });
  }
}

/** Gives the worker the oldest queued job, with an open Processing run and a job-scoped token. */
export async function claimNextProcessingJob(db: AppDb, model: string, now: Date = new Date()) {
  processorSeenAt = now.getTime();
  await expireProcessingJobs(db, now);

  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.status, "queued"))
        .orderBy(asc(processingJobs.createdAt), asc(processingJobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      const mcpToken = `${JOB_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      await tx
        .update(processingJobs)
        .set({
          status: "running",
          tokenHash: hashToken(mcpToken),
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          startedAt: now,
        })
        .where(eq(processingJobs.id, next.id));
      return { job: next, mcpToken };
    });
    if (!claimed) return null;

    const { job, mcpToken } = claimed;
    try {
      const { ranges } = await mcpListWork(db, job.requestedByPlayerId, {
        purpose: job.purpose,
        duo: job.duoId,
      });
      const stillNeeded = ranges.some(
        (r) =>
          r.sessionId === job.sessionId &&
          overlaps(
            { start: new Date(r.startUtc), end: new Date(r.endUtc) },
            { start: job.rangeStart, end: job.rangeEnd },
          ),
      );
      if (!stillNeeded) {
        await closeJob(db, job, "cancelled", "Already up to date.");
        continue;
      }

      const run = await mcpStartRun(db, job.requestedByPlayerId, {
        sessionId: job.sessionId,
        startUtc: job.rangeStart.toISOString(),
        endUtc: job.rangeEnd.toISOString(),
        purpose: job.purpose,
        agent: WORKER_AGENT,
        model,
        duo: job.duoId,
      });
      await db
        .update(processingJobs)
        .set({ runId: run.runId })
        .where(eq(processingJobs.id, job.id));
      duoEventBus.emitChanged(job.duoId, "processing", job.sessionId);
      return { jobId: job.id, runId: run.runId, purpose: job.purpose, mcpToken };
    } catch (err) {
      const message =
        err instanceof DomainError ? err.message : "Could not start the Processing run.";
      await closeJob(db, job, "failed", message);
    }
  }
}

export async function verifyProcessingJobToken(
  db: AppDb,
  rawToken: string,
  now: Date = new Date(),
): Promise<ProcessingJobScope | null> {
  const job = await db.query.processingJobs.findFirst({
    where: and(
      eq(processingJobs.tokenHash, hashToken(rawToken)),
      eq(processingJobs.status, "running"),
    ),
  });
  if (!job?.runId || !job.leaseExpiresAt || job.leaseExpiresAt <= now) return null;
  return {
    jobId: job.id,
    playerId: job.requestedByPlayerId,
    duoId: job.duoId,
    runId: job.runId,
    purpose: job.purpose,
  };
}

export async function extendProcessingJobLease(
  db: AppDb,
  jobId: string,
  now: Date = new Date(),
): Promise<boolean> {
  processorSeenAt = now.getTime();
  const updated = await db
    .update(processingJobs)
    .set({ leaseExpiresAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.status, "running")))
    .returning({ id: processingJobs.id });
  return updated.length > 0;
}

/** A job only succeeds if its run really finished; otherwise the open run is abandoned. */
export async function finishProcessingJob(
  db: AppDb,
  jobId: string,
  outcome: { ok: boolean; error?: string | null },
): Promise<{ status: JobRow["status"] | null }> {
  const job = await db.query.processingJobs.findFirst({ where: eq(processingJobs.id, jobId) });
  if (!job) return { status: null };
  if (job.status !== "running") return { status: job.status };

  const run = job.runId
    ? await db.query.processingRuns.findFirst({ where: eq(processingRuns.id, job.runId) })
    : null;
  if (run?.status === "finished") {
    await closeJob(db, job, "succeeded", null);
    return { status: "succeeded" };
  }

  if (run) {
    await db
      .update(processingRuns)
      .set({ status: "abandoned" })
      .where(and(eq(processingRuns.id, run.id), eq(processingRuns.status, "open")));
  }
  const error = outcome.error?.slice(0, 300) || "The model stopped before finishing the run.";
  await closeJob(db, job, "failed", error);
  return { status: "failed" };
}

export interface WorkbenchProcessingJob {
  id: string;
  sessionId: string;
  purpose: ProcessingJobPurpose;
  startUtc: string;
  endUtc: string;
  status: JobRow["status"];
  error: string | null;
  requestedByPlayerId: string;
  learningCount: number | null;
  finishedAt: string | null;
}

export async function listRecentProcessingJobs(
  db: AppDb,
  duoId: string,
): Promise<WorkbenchProcessingJob[]> {
  const jobs = await db.query.processingJobs.findMany({
    where: eq(processingJobs.duoId, duoId),
    orderBy: [desc(processingJobs.createdAt), desc(processingJobs.id)],
    limit: 50,
  });
  const runIds = jobs.flatMap((j) => (j.status === "succeeded" && j.runId ? [j.runId] : []));
  const counts =
    runIds.length > 0
      ? await db
          .select({ runId: learnings.runId, count: sql<number>`count(*)::int` })
          .from(learnings)
          .where(inArray(learnings.runId, runIds))
          .groupBy(learnings.runId)
      : [];
  const countByRun = new Map(counts.map((c) => [c.runId, c.count]));
  return jobs.map((j) => ({
    id: j.id,
    sessionId: j.sessionId,
    purpose: j.purpose,
    startUtc: j.rangeStart.toISOString(),
    endUtc: j.rangeEnd.toISOString(),
    status: j.status,
    error: j.error,
    requestedByPlayerId: j.requestedByPlayerId,
    learningCount:
      j.status === "succeeded" && j.runId ? (countByRun.get(j.runId) ?? 0) : null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  }));
}
