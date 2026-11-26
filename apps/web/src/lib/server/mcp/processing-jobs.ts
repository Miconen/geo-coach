import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { intervalsOverlap, uuidv7 } from "@geo-coach/shared";
import { hashToken } from "../auth/index.js";
import type { AppDb } from "../db/index.js";
import { claimTaggingJobs, learnings, processingJobs, processingRuns, recordings } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import { CLAIM_TAGGING_BATCH, DomainError, assertPlayerInDuo, loadClaimTaggingQueue } from "../services/index.js";
import { countJobTagged, type ClaimTaggingScope } from "./clue-tagging.js";
import { getCurrentPromptVersion } from "./prompts.js";
import { mcpListWork, mcpStartRun } from "./workflow.js";

export const JOB_TOKEN_PREFIX = "gc_job_";
const LEASE_MS = 3 * 60 * 1000;
// A worker is online while it polled (even idle) within this window; e2e shortens it.
const PROCESSOR_ONLINE_MS = Number(process.env.PROCESSOR_ONLINE_MS) || 45 * 1000;
const WORKER_AGENT = "geo-coach-worker";
/** The cancellation note for a job whose range was already processed; the run history collapses these. */
export const ALREADY_UP_TO_DATE = "Already up to date.";

export type ProcessingJobPurpose = "extract" | "tips" | "clues";
type JobRow = typeof processingJobs.$inferSelect;

/**
 * What a job's short-lived MCP token may touch: a Session job's one Processing run, or a Claim tagging job's
 * Claims (#89).
 */
export type ProcessingJobScope =
  | { kind: "run"; jobId: string; playerId: string; duoId: string; runId: string; purpose: ProcessingJobPurpose }
  | ({ kind: "tag-claims"; playerId: string } & ClaimTaggingScope);

/** A job the worker claimed: a Session job with its open run, or a Claim tagging job. */
export type ClaimedProcessingJob =
  | { jobId: string; runId: string; purpose: ProcessingJobPurpose; mcpToken: string }
  | { jobId: string; runId: null; purpose: "tag-claims"; mcpToken: string; claimCount: number };
type TagJobRow = typeof claimTaggingJobs.$inferSelect;

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
    // A committed stop wins over cached heartbeats (kept up to 90 s): only Recordings not yet stopped count.
    where: and(
      eq(recordings.sessionId, sessionId),
      eq(recordings.duoId, duoId),
      inArray(recordings.id, liveIds),
      isNull(recordings.stoppedAt),
    ),
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
  const expiredTagging = await db.query.claimTaggingJobs.findMany({
    where: and(eq(claimTaggingJobs.status, "running"), lt(claimTaggingJobs.leaseExpiresAt, now)),
  });
  for (const job of [...expired, ...expiredTagging]) {
    await finishProcessingJob(db, job.id, {
      ok: false,
      error: "The worker stopped responding. Try again.",
    });
  }
}

/**
 * Gives the worker the oldest queued Session job, with an open Processing run and a job-scoped token; with none,
 * the oldest Claim tagging job, so a backfill never holds up a Session a Player asked to process.
 */
export async function claimNextProcessingJob(
  db: AppDb,
  model: string,
  now: Date = new Date(),
): Promise<ClaimedProcessingJob | null> {
  processorSeenAt = now.getTime();
  await expireProcessingJobs(db, now);
  return (await claimNextSessionJob(db, model, now)) ?? (await claimNextTaggingJob(db, now));
}

async function claimNextSessionJob(db: AppDb, model: string, now: Date): Promise<ClaimedProcessingJob | null> {
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
    // The claim committed: the run history shows the job as starting before its run exists.
    duoEventBus.emitChanged(job.duoId, "processing", job.sessionId);
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
        await closeJob(db, job, "cancelled", ALREADY_UP_TO_DATE);
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
  if (!job) {
    const tagging = await db.query.claimTaggingJobs.findFirst({
      where: and(eq(claimTaggingJobs.tokenHash, hashToken(rawToken)), eq(claimTaggingJobs.status, "running")),
    });
    if (!tagging?.startedAt || tagging.claimIds.length === 0 || !tagging.leaseExpiresAt || tagging.leaseExpiresAt <= now) {
      return null;
    }
    return {
      kind: "tag-claims",
      jobId: tagging.id,
      playerId: tagging.requestedByPlayerId,
      duoId: tagging.duoId,
      claimIds: tagging.claimIds,
      startedAt: tagging.startedAt,
    };
  }
  if (!job.runId || !job.leaseExpiresAt || job.leaseExpiresAt <= now) return null;
  return {
    kind: "run",
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
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const updated = await db
    .update(processingJobs)
    .set({ leaseExpiresAt })
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.status, "running")))
    .returning({ id: processingJobs.id });
  if (updated.length > 0) return true;
  const tagging = await db
    .update(claimTaggingJobs)
    .set({ leaseExpiresAt })
    .where(and(eq(claimTaggingJobs.id, jobId), eq(claimTaggingJobs.status, "running")))
    .returning({ id: claimTaggingJobs.id });
  return tagging.length > 0;
}

/** A job only succeeds if its run really finished; otherwise the open run is abandoned. */
export async function finishProcessingJob(
  db: AppDb,
  jobId: string,
  outcome: { ok: boolean; error?: string | null },
): Promise<{ status: JobRow["status"] | null }> {
  const job = await db.query.processingJobs.findFirst({ where: eq(processingJobs.id, jobId) });
  if (!job) {
    const tagging = await db.query.claimTaggingJobs.findFirst({ where: eq(claimTaggingJobs.id, jobId) });
    return tagging ? finishTaggingJob(db, tagging, outcome) : { status: null };
  }
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

// --- Claim tagging jobs (#89) ------------------------------------------------------------------------------------

async function closeTaggingJob(
  db: AppDb,
  job: TagJobRow,
  status: "succeeded" | "failed" | "cancelled",
  error: string | null,
  taggedCount = job.taggedCount,
) {
  await db
    .update(claimTaggingJobs)
    .set({ status, error, taggedCount, tokenHash: null, leaseExpiresAt: null, finishedAt: new Date() })
    .where(and(eq(claimTaggingJobs.id, job.id), inArray(claimTaggingJobs.status, ["queued", "running"])));
  duoEventBus.emitChanged(job.duoId, "clue", job.id);
}

/**
 * Queues tagging of up to `limit` Claims from the Duo's queue (all of it without a limit), one job per
 * CLAIM_TAGGING_BATCH. A limited run is the maintainer's test before the full backfill; either way the queue is the
 * backfill, so it can stop anywhere and the next job continues where it stopped. Claims already covered by active
 * jobs aren't queued twice.
 */
export async function enqueueClaimTagging(
  db: AppDb,
  playerId: string,
  input: { duoId: string; limit?: number | null },
): Promise<{ jobs: number; claims: number }> {
  await assertPlayerInDuo(db, playerId, input.duoId);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`clue-tag:${input.duoId}`}))`);
    const active = await tx.query.claimTaggingJobs.findMany({
      where: and(eq(claimTaggingJobs.duoId, input.duoId), inArray(claimTaggingJobs.status, ["queued", "running"])),
    });
    const queue = await loadClaimTaggingQueue(tx as unknown as AppDb, input.duoId, getCurrentPromptVersion("clue-tag"));
    // A running job holds its Claims; a queued one will take the next claimLimit of the queue.
    const held = new Set(active.flatMap((j) => j.claimIds));
    const ahead = active.filter((j) => j.status === "queued").reduce((n, j) => n + j.claimLimit, 0);
    const free = queue.filter((id) => !held.has(id)).length - ahead;
    const wanted = Math.min(free, input.limit ?? Infinity);
    if (wanted <= 0) return null;
    const rows: Array<typeof claimTaggingJobs.$inferInsert> = [];
    for (let left = wanted; left > 0; left -= CLAIM_TAGGING_BATCH) {
      rows.push({
        id: uuidv7(),
        duoId: input.duoId,
        requestedByPlayerId: playerId,
        claimLimit: Math.min(left, CLAIM_TAGGING_BATCH),
      });
    }
    await tx.insert(claimTaggingJobs).values(rows);
    return { jobs: rows.length, claims: wanted };
  });
  if (!result) throw new DomainError("NOTHING_TO_TAG", "Every Claim in the queue is already tagged or being tagged.", 409);
  duoEventBus.emitChanged(input.duoId, "clue");
  return result;
}

/** Gives the worker the oldest queued Claim tagging job, with the next queue Claims no running job holds. */
async function claimNextTaggingJob(db: AppDb, now: Date): Promise<ClaimedProcessingJob | null> {
  const promptVersion = getCurrentPromptVersion("clue-tag");
  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(claimTaggingJobs)
        .where(eq(claimTaggingJobs.status, "queued"))
        .orderBy(asc(claimTaggingJobs.createdAt), asc(claimTaggingJobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      // One claim per Duo at a time, so two jobs never take the same Claims.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`clue-tag:${next.duoId}`}))`);
      const running = await tx.query.claimTaggingJobs.findMany({
        where: and(eq(claimTaggingJobs.duoId, next.duoId), eq(claimTaggingJobs.status, "running")),
        columns: { claimIds: true },
      });
      const claimIds = await loadClaimTaggingQueue(tx as unknown as AppDb, next.duoId, promptVersion, {
        limit: next.claimLimit,
        exclude: new Set(running.flatMap((j) => j.claimIds)),
      });
      if (claimIds.length === 0) return { job: next, mcpToken: null, claimIds };
      const mcpToken = `${JOB_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      await tx
        .update(claimTaggingJobs)
        .set({
          status: "running",
          claimIds,
          tokenHash: hashToken(mcpToken),
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          startedAt: now,
        })
        .where(eq(claimTaggingJobs.id, next.id));
      return { job: next, mcpToken, claimIds };
    });
    if (!claimed) return null;
    if (!claimed.mcpToken) {
      await closeTaggingJob(db, claimed.job, "cancelled", ALREADY_UP_TO_DATE);
      continue;
    }
    duoEventBus.emitChanged(claimed.job.duoId, "clue", claimed.job.id);
    return {
      jobId: claimed.job.id,
      runId: null,
      purpose: "tag-claims",
      mcpToken: claimed.mcpToken,
      claimCount: claimed.claimIds.length,
    };
  }
}

/**
 * A Claim tagging job succeeds when it tagged every Claim it took. The ones it didn't simply stay in the queue for
 * the next job.
 */
async function finishTaggingJob(
  db: AppDb,
  job: TagJobRow,
  outcome: { ok: boolean; error?: string | null },
): Promise<{ status: TagJobRow["status"] | null }> {
  if (job.status !== "running" || !job.startedAt) return { status: job.status };
  const tagged = await countJobTagged(
    db,
    { duoId: job.duoId, claimIds: job.claimIds, startedAt: job.startedAt },
    getCurrentPromptVersion("clue-tag"),
  );
  if (tagged === job.claimIds.length) {
    await closeTaggingJob(db, job, "succeeded", null, tagged);
    return { status: "succeeded" };
  }
  const why = outcome.error?.slice(0, 200) || "The model stopped before tagging every Claim.";
  const error = `Tagged ${tagged} of ${job.claimIds.length} Claims; the rest stay in the queue. ${why}`;
  await closeTaggingJob(db, job, "failed", error, tagged);
  return { status: "failed" };
}

export interface ClaimTaggingJobRow {
  id: string;
  status: TagJobRow["status"];
  claimLimit: number;
  taggedCount: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** A Duo's recent Claim tagging jobs, newest first, for the Clues page. */
export async function listClaimTaggingJobs(db: AppDb, duoId: string, limit = 20): Promise<ClaimTaggingJobRow[]> {
  const jobs = await db.query.claimTaggingJobs.findMany({
    where: eq(claimTaggingJobs.duoId, duoId),
    orderBy: [desc(claimTaggingJobs.createdAt), desc(claimTaggingJobs.id)],
    limit,
  });
  return jobs.map((j) => ({
    id: j.id,
    status: j.status,
    claimLimit: j.claimLimit,
    taggedCount: j.taggedCount,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  }));
}
