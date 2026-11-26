import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { intervalsOverlap, uuidv7 } from "@geo-coach/shared";
import { hashToken } from "../auth/index.js";
import type { AppDb } from "../db/index.js";
import { claimTaggingJobs, claims, learnings, processingJobs, processingRuns, recordings } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import { CLAIM_TAGGING_MODELS, isClaimTaggingModel, type ClaudeRunUsage } from "../processor/worker.js";
import { CLAIM_TAGGING_BATCH, DomainError, assertPlayerInDuo, loadClaimTaggingQueue } from "../services/index.js";
import { countJobTagged, countTrialTagged, type ClaimTaggingScope } from "./clue-tagging.js";
import { CLUE_TAG_PROMPT_VERSIONS, getCurrentPromptVersion, isClueTagPromptVersion } from "./prompts.js";
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
  | { jobId: string; runId: null; purpose: "tag-claims"; mcpToken: string; claimCount: number; model: string | null };
type TagJobRow = typeof claimTaggingJobs.$inferSelect;

/** How a worker says a job ended; a Claim tagging job also gets the model it ran and what it used (#94). */
export interface JobOutcome {
  ok: boolean;
  error?: string | null;
  model?: string | null;
  usage?: ClaudeRunUsage | null;
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
      trial: tagging.trial,
      promptVersion: tagging.promptVersion ?? getCurrentPromptVersion("clue-tag"),
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
  outcome: JobOutcome,
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
  ran: Pick<JobOutcome, "model" | "usage"> = {},
) {
  await db
    .update(claimTaggingJobs)
    .set({
      status,
      error,
      taggedCount,
      tokenHash: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
      ...(ran.model ? { model: ran.model } : {}),
      ...(ran.usage ? { usage: ran.usage, costUsd: ran.usage.costUsd } : {}),
    })
    .where(and(eq(claimTaggingJobs.id, job.id), inArray(claimTaggingJobs.status, ["queued", "running"])));
  duoEventBus.emitChanged(job.duoId, "clue", job.id);
}

/** A live job that takes its Claims from the queue, not a trial or a job for named Claims (#94). */
const takesFromQueue = (j: Pick<TagJobRow, "trial" | "requestedClaimIds">) => !j.trial && j.requestedClaimIds === null;

/** The Claims live jobs hold: a running job's, and a queued job's named Claims. Trials hold none. */
function heldByLiveJobs(active: ReadonlyArray<Pick<TagJobRow, "status" | "trial" | "claimIds" | "requestedClaimIds">>) {
  return new Set(
    active.filter((j) => !j.trial).flatMap((j) => (j.status === "running" ? j.claimIds : (j.requestedClaimIds ?? []))),
  );
}

function assertTaggingModel(model: string | null | undefined) {
  if (model && !isClaimTaggingModel(model)) {
    throw new DomainError("UNKNOWN_MODEL", `Unknown model "${model}"; use one of ${CLAIM_TAGGING_MODELS.join(", ")}.`, 400);
  }
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
  input: { duoId: string; limit?: number | null; model?: string | null },
): Promise<{ jobs: number; claims: number; jobIds: string[] }> {
  await assertPlayerInDuo(db, playerId, input.duoId);
  assertTaggingModel(input.model);
  const promptVersion = getCurrentPromptVersion("clue-tag");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`clue-tag:${input.duoId}`}))`);
    const active = await tx.query.claimTaggingJobs.findMany({
      where: and(eq(claimTaggingJobs.duoId, input.duoId), inArray(claimTaggingJobs.status, ["queued", "running"])),
    });
    const queue = await loadClaimTaggingQueue(tx as unknown as AppDb, input.duoId, promptVersion);
    // A running job holds its Claims; a queued queue job will take the next claimLimit of the queue.
    const held = heldByLiveJobs(active);
    const ahead = active.filter((j) => j.status === "queued" && takesFromQueue(j)).reduce((n, j) => n + j.claimLimit, 0);
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
        model: input.model ?? null,
        promptVersion,
      });
    }
    await tx.insert(claimTaggingJobs).values(rows);
    return { jobs: rows.length, claims: wanted, jobIds: rows.map((r) => r.id) };
  });
  if (!result) throw new DomainError("NOTHING_TO_TAG", "Every Claim in the queue is already tagged or being tagged.", 409);
  duoEventBus.emitChanged(input.duoId, "clue");
  return result;
}

/**
 * Starts one Claim tagging job for a Player's agent (#94): on named Claims or the next `limit` of the queue, with a
 * model and, for a trial, a prompt version. A trial tags into the trial store; a live job, like the Clues page's,
 * always tags with the current prompt version. A trial's Claims are fixed when it starts, so it can be rerun on the
 * same Claims.
 */
export async function startClaimTagging(
  db: AppDb,
  playerId: string,
  input: {
    duoId: string;
    claimIds?: readonly string[];
    limit?: number;
    model?: string | null;
    promptVersion?: string | null;
    trial: boolean;
  },
): Promise<{ jobId: string; trial: boolean; claimCount: number; model: string | null; promptVersion: string }> {
  await assertPlayerInDuo(db, playerId, input.duoId);
  assertTaggingModel(input.model);
  const current = getCurrentPromptVersion("clue-tag");
  const promptVersion = input.promptVersion ?? current;
  if (!isClueTagPromptVersion(promptVersion)) {
    throw new DomainError("UNKNOWN_PROMPT_VERSION", `Unknown prompt version "${promptVersion}"; use one of ${CLUE_TAG_PROMPT_VERSIONS.join(", ")}.`, 400);
  }
  if (!input.trial && promptVersion !== current) {
    throw new DomainError("TRIAL_ONLY", `Only a trial can tag with ${promptVersion}; live tagging uses ${current}.`, 400);
  }
  if (input.claimIds?.length && input.limit) {
    throw new DomainError("INVALID_INPUT", "Pass claimIds or limit, not both.", 400);
  }
  const limit = Math.min(input.limit ?? CLAIM_TAGGING_BATCH, CLAIM_TAGGING_BATCH);

  if (!input.trial && !input.claimIds?.length) {
    const res = await enqueueClaimTagging(db, playerId, { duoId: input.duoId, limit, model: input.model });
    return { jobId: res.jobIds[0]!, trial: false, claimCount: res.claims, model: input.model ?? null, promptVersion };
  }

  let claimIds: string[];
  if (input.claimIds?.length) {
    const wanted = [...new Set(input.claimIds)];
    if (wanted.length > CLAIM_TAGGING_BATCH) {
      throw new DomainError("TOO_MANY_CLAIMS", `A job tags at most ${CLAIM_TAGGING_BATCH} Claims.`, 400);
    }
    const found = await db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.duoId, input.duoId), inArray(claims.id, wanted)));
    const known = new Set(found.map((c) => c.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new DomainError("UNKNOWN_CLAIMS", `Unknown or other Duo's claimIds: ${unknown.join(", ")}`, 400);
    claimIds = wanted;
  } else {
    // A trial on the queue: the next Claims its prompt version hasn't tagged, fixed now.
    claimIds = await loadClaimTaggingQueue(db, input.duoId, promptVersion, { limit });
    if (claimIds.length === 0) throw new DomainError("NOTHING_TO_TAG", `Every Claim is already tagged with ${promptVersion}.`, 409);
  }
  const jobId = uuidv7();
  await db.insert(claimTaggingJobs).values({
    id: jobId,
    duoId: input.duoId,
    requestedByPlayerId: playerId,
    claimLimit: claimIds.length,
    requestedClaimIds: claimIds,
    model: input.model ?? null,
    promptVersion,
    trial: input.trial,
  });
  duoEventBus.emitChanged(input.duoId, "clue");
  return { jobId, trial: input.trial, claimCount: claimIds.length, model: input.model ?? null, promptVersion };
}

/**
 * Gives the worker the oldest queued Claim tagging job: with the Claims it names, or else the next queue Claims no
 * running live job holds.
 */
async function claimNextTaggingJob(db: AppDb, now: Date): Promise<ClaimedProcessingJob | null> {
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
      const promptVersion = next.promptVersion ?? getCurrentPromptVersion("clue-tag");
      // One claim per Duo at a time, so two jobs never take the same Claims.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`clue-tag:${next.duoId}`}))`);
      let claimIds: string[];
      if (next.requestedClaimIds) {
        // Named Claims (#94), less any deleted since.
        const left = next.requestedClaimIds.length
          ? await tx
              .select({ id: claims.id })
              .from(claims)
              .where(and(eq(claims.duoId, next.duoId), inArray(claims.id, next.requestedClaimIds)))
          : [];
        const alive = new Set(left.map((c) => c.id));
        claimIds = next.requestedClaimIds.filter((id) => alive.has(id));
      } else {
        const running = await tx.query.claimTaggingJobs.findMany({
          where: and(eq(claimTaggingJobs.duoId, next.duoId), eq(claimTaggingJobs.status, "running"), eq(claimTaggingJobs.trial, false)),
          columns: { claimIds: true },
        });
        claimIds = await loadClaimTaggingQueue(tx as unknown as AppDb, next.duoId, promptVersion, {
          limit: next.claimLimit,
          exclude: new Set(running.flatMap((j) => j.claimIds)),
        });
      }
      if (claimIds.length === 0) return { job: next, mcpToken: null, claimIds };
      const mcpToken = `${JOB_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      await tx
        .update(claimTaggingJobs)
        .set({
          status: "running",
          claimIds,
          promptVersion,
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
      model: claimed.job.model,
    };
  }
}

/**
 * A Claim tagging job succeeds when it tagged every Claim it took. The ones it didn't simply stay in the queue for
 * the next job. A trial counts the Claims it tagged in the trial store.
 */
async function finishTaggingJob(
  db: AppDb,
  job: TagJobRow,
  outcome: JobOutcome,
): Promise<{ status: TagJobRow["status"] | null }> {
  if (job.status !== "running" || !job.startedAt) return { status: job.status };
  const tagged = job.trial
    ? await countTrialTagged(db, job.id)
    : await countJobTagged(
        db,
        { duoId: job.duoId, claimIds: job.claimIds, startedAt: job.startedAt },
        job.promptVersion ?? getCurrentPromptVersion("clue-tag"),
      );
  const ran = { model: outcome.model, usage: outcome.usage };
  if (tagged === job.claimIds.length) {
    await closeTaggingJob(db, job, "succeeded", null, tagged, ran);
    return { status: "succeeded" };
  }
  const why = outcome.error?.slice(0, 200) || "The model stopped before tagging every Claim.";
  const rest = job.trial ? "the trial keeps what it tagged" : "the rest stay in the queue";
  const error = `Tagged ${tagged} of ${job.claimIds.length} Claims; ${rest}. ${why}`;
  await closeTaggingJob(db, job, "failed", error, tagged, ran);
  return { status: "failed" };
}

export interface ClaimTaggingJobRow {
  id: string;
  status: TagJobRow["status"];
  trial: boolean;
  claimLimit: number;
  taggedCount: number;
  error: string | null;
  /** The model the job ran with (or asked for, until it runs); null is the worker's default. */
  model: string | null;
  promptVersion: string | null;
  usage: ClaudeRunUsage | null;
  /** Claude Code's total_cost_usd: what the run would cost at API prices, not what the subscription bills. */
  apiEquivalentCostUsd: number | null;
  claimIds: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  promotedAt: string | null;
}

export function toClaimTaggingJobRow(j: TagJobRow): ClaimTaggingJobRow {
  return {
    id: j.id,
    status: j.status,
    trial: j.trial,
    claimLimit: j.claimLimit,
    taggedCount: j.taggedCount,
    error: j.error,
    model: j.model,
    promptVersion: j.promptVersion,
    usage: j.usage,
    apiEquivalentCostUsd: j.costUsd,
    // Until it runs, a job for named Claims lists those.
    claimIds: j.claimIds.length > 0 ? j.claimIds : (j.requestedClaimIds ?? []),
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    promotedAt: j.promotedAt?.toISOString() ?? null,
  };
}

/** A Duo's recent Claim tagging jobs, newest first, for the Clues page and `list_claim_tagging_jobs`. */
export async function listClaimTaggingJobs(
  db: AppDb,
  duoId: string,
  limit = 20,
  filter: { trial?: boolean } = {},
): Promise<ClaimTaggingJobRow[]> {
  const jobs = await db.query.claimTaggingJobs.findMany({
    where: and(
      eq(claimTaggingJobs.duoId, duoId),
      filter.trial === undefined ? undefined : eq(claimTaggingJobs.trial, filter.trial),
    ),
    orderBy: [desc(claimTaggingJobs.createdAt), desc(claimTaggingJobs.id)],
    limit,
  });
  return jobs.map(toClaimTaggingJobRow);
}
