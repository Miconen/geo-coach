import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/index.js";
import { claimTaggingJobs, claims } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import {
  DomainError,
  assertPlayerInDuo,
  clueResolver,
  compareJobLinks,
  loadLiveLinks,
  loadTrialLinks,
  replaceClaimClues,
  trialPromotionPlan,
  type ClaimClueLink,
  type JobLink,
} from "../services/index.js";
import {
  isProcessorOnline,
  listClaimTaggingJobs,
  startClaimTagging,
  toClaimTaggingJobRow,
  type ClaimTaggingJobRow,
} from "./processing-jobs.js";
import { loadClueVocabulary } from "./prompts.js";
import { resolveDuoForPlayer } from "./workflow.js";

// A Player's agent runs and compares Claim tagging jobs (#94): start a live or trial job on the worker, read a job's
// links back, compare two jobs Claim by Claim, and promote a trial's links to the live ones.

type TagJobRow = typeof claimTaggingJobs.$inferSelect;

/** A job of one of the Player's Duos. */
async function playerJob(db: AppDb, playerId: string, jobId: string): Promise<TagJobRow> {
  const job = await db.query.claimTaggingJobs.findFirst({ where: eq(claimTaggingJobs.id, jobId) });
  if (!job) throw new DomainError("NOT_FOUND", `No Claim tagging job ${jobId}`, 404);
  await assertPlayerInDuo(db, playerId, job.duoId);
  return job;
}

/**
 * A job's Claims with its links: a trial's from its trial store; a live job's are the Claims' current live links,
 * for each Claim whose tagging is still this job's (null when it isn't tagged, or a later tagging replaced it).
 */
async function jobLinks(db: AppDb, job: TagJobRow): Promise<Map<string, JobLink[] | null>> {
  const ids = toClaimTaggingJobRow(job).claimIds;
  if (job.trial) {
    const trial = await loadTrialLinks(db, job.id);
    return new Map(ids.map((id) => [id, trial.get(id) ?? null]));
  }
  const rows = ids.length
    ? await db
        .select({ id: claims.id, cluesPromptVersion: claims.cluesPromptVersion, cluesTaggedAt: claims.cluesTaggedAt })
        .from(claims)
        .where(and(eq(claims.duoId, job.duoId), inArray(claims.id, ids)))
    : [];
  // A live job marks each Claim it tags with its start time and prompt version.
  const ours = new Set(
    rows
      .filter(
        (c) =>
          job.startedAt &&
          c.cluesTaggedAt?.getTime() === job.startedAt.getTime() &&
          (job.promptVersion === null || c.cluesPromptVersion === job.promptVersion),
      )
      .map((c) => c.id),
  );
  const live = await loadLiveLinks(db, job.duoId, [...ours]);
  return new Map(ids.map((id) => [id, ours.has(id) ? (live.get(id) ?? []) : null]));
}

const linkOut = (l: JobLink) => ({
  clueId: l.clueId,
  family: l.family,
  name: l.name,
  country: l.country,
  regionCode: l.regionCode,
  prevalence: l.prevalence,
});

function jobSummary(row: ClaimTaggingJobRow) {
  const durationMs =
    row.usage?.durationMs ??
    (row.startedAt && row.finishedAt ? Date.parse(row.finishedAt) - Date.parse(row.startedAt) : null);
  return {
    jobId: row.id,
    status: row.status,
    trial: row.trial,
    model: row.model,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs,
    numTurns: row.usage?.numTurns ?? null,
    tokens: row.usage
      ? {
          input: row.usage.inputTokens,
          output: row.usage.outputTokens,
          cacheRead: row.usage.cacheReadTokens,
          cacheCreation: row.usage.cacheCreationTokens,
        }
      : null,
    modelsUsed: row.usage?.byModel ?? [],
    apiEquivalentCostUsd: row.apiEquivalentCostUsd,
    claimCount: row.claimIds.length || row.claimLimit,
    taggedCount: row.taggedCount,
    error: row.error,
    promotedAt: row.promotedAt,
    claimIds: row.claimIds,
  };
}

/** `start_claim_tagging`: queues one job for the worker, which must be online. */
export async function mcpStartClaimTagging(
  db: AppDb,
  playerId: string,
  input: { duo?: string; claimIds?: string[]; limit?: number; model?: string; promptVersion?: string; trial: boolean },
) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  if (!isProcessorOnline()) throw new DomainError("WORKER_OFFLINE", "The processing worker is offline; start the job when it's back.", 503);
  return startClaimTagging(db, playerId, {
    duoId: duo.id,
    claimIds: input.claimIds,
    limit: input.limit,
    model: input.model ?? null,
    promptVersion: input.promptVersion ?? null,
    trial: input.trial,
  });
}

/** `list_claim_tagging_jobs`: the Duo's recent jobs, newest first, with their Claim ids. */
export async function mcpListClaimTaggingJobs(db: AppDb, playerId: string, input: { duo?: string; limit?: number; trial?: boolean }) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  const jobs = await listClaimTaggingJobs(db, duo.id, input.limit ?? 20, { trial: input.trial });
  return { jobs: jobs.map(jobSummary) };
}

/** `get_claim_tagging_job`: a job's status, timings, model, prompt version and usage, and each Claim's links. */
export async function mcpGetClaimTaggingJob(db: AppDb, playerId: string, input: { jobId: string }) {
  const job = await playerJob(db, playerId, input.jobId);
  const links = await jobLinks(db, job);
  const texts = await claimTexts(db, job.duoId, [...links.keys()]);
  return {
    ...jobSummary(toClaimTaggingJobRow(job)),
    links: job.trial ? "trial" : "live",
    claims: [...links].map(([claimId, l]) => ({
      claimId,
      text: texts.get(claimId) ?? null,
      tagged: l !== null,
      links: l?.map(linkOut) ?? null,
    })),
    createdClues: job.createdClues,
  };
}

async function claimTexts(db: AppDb, duoId: string, ids: readonly string[]) {
  const rows = ids.length
    ? await db.select({ id: claims.id, text: claims.text }).from(claims).where(and(eq(claims.duoId, duoId), inArray(claims.id, [...ids])))
    : [];
  return new Map(rows.map((c) => [c.id, c.text]));
}

/**
 * `compare_claim_tagging_jobs`: two jobs' links side by side, Claim by Claim, with what changed from the first to
 * the second: links added, removed, or at another prevalence.
 */
export async function mcpCompareClaimTaggingJobs(
  db: AppDb,
  playerId: string,
  input: { jobIds: [string, string]; onlyDifferences?: boolean },
) {
  const [a, b] = await Promise.all(input.jobIds.map((id) => playerJob(db, playerId, id)));
  if (a!.duoId !== b!.duoId) throw new DomainError("INVALID_INPUT", "Compare two jobs of the same Duo.", 400);
  const tagged = (m: Map<string, JobLink[] | null>) => new Map([...m].flatMap(([id, l]) => (l ? [[id, l] as const] : [])));
  const [linksA, linksB] = await Promise.all([jobLinks(db, a!), jobLinks(db, b!)]);
  const pairs = compareJobLinks(tagged(linksA), tagged(linksB));
  const texts = await claimTexts(db, a!.duoId, pairs.map((p) => p.claimId));
  const count = (change: string) => pairs.reduce((n, p) => n + p.differences.filter((d) => d.change === change).length, 0);
  const rows = pairs
    .filter((p) => !input.onlyDifferences || p.differences.length > 0 || !p.a || !p.b)
    .map((p) => ({
      claimId: p.claimId,
      text: texts.get(p.claimId) ?? null,
      a: p.a?.map(linkOut) ?? null,
      b: p.b?.map(linkOut) ?? null,
      differences: p.differences,
    }));
  return {
    a: jobSummary(toClaimTaggingJobRow(a!)),
    b: jobSummary(toClaimTaggingJobRow(b!)),
    totals: {
      claimsInBoth: pairs.filter((p) => p.a && p.b).length,
      claimsDiffering: pairs.filter((p) => p.differences.length > 0).length,
      onlyInA: pairs.filter((p) => p.a && !p.b).length,
      onlyInB: pairs.filter((p) => !p.a && p.b).length,
      added: count("added"),
      removed: count("removed"),
      changed: count("changed"),
    },
    claims: rows,
  };
}

/**
 * `promote_claim_tagging_trial`: applies a finished trial's links as if a live job had tagged them, Clues it would
 * have created included. Untagged Claims and Claims an older prompt version tagged get the trial's links; the rest
 * are left alone unless forced.
 */
export async function mcpPromoteClaimTaggingTrial(db: AppDb, playerId: string, input: { jobId: string; force?: boolean }) {
  const job = await playerJob(db, playerId, input.jobId);
  if (!job.trial) throw new DomainError("NOT_A_TRIAL", "Only a trial job can be promoted.", 400);
  if (job.status !== "succeeded" && job.status !== "failed") {
    throw new DomainError("TRIAL_NOT_FINISHED", "Promote a trial once it has finished.", 409);
  }
  const promptVersion = job.promptVersion!;
  const trialLinks = await loadTrialLinks(db, job.id);
  const ids = [...trialLinks.keys()];
  const rows = ids.length
    ? await db
        .select({ id: claims.id, cluesPromptVersion: claims.cluesPromptVersion, cluesTaggedAt: claims.cluesTaggedAt })
        .from(claims)
        .where(and(eq(claims.duoId, job.duoId), inArray(claims.id, ids)))
    : [];
  const plan = trialPromotionPlan(rows, promptVersion, input.force ?? false);
  const resolver = await clueResolver(db, job.duoId, await loadClueVocabulary(promptVersion));
  const skipped = [...plan.skipped];
  // Tagged as the trial's run, so an edit since puts the Claim back in the queue, as after a live job.
  const taggedAt = job.startedAt ?? new Date();
  let promoted = 0;
  for (const claimId of plan.promote) {
    const links: ClaimClueLink[] = [];
    const problems: string[] = [];
    for (const l of trialLinks.get(claimId)!) {
      const clue = await resolver.resolve(l.clueId ? { clueId: l.clueId } : { family: l.family, name: l.name });
      if ("error" in clue) problems.push(clue.error);
      else links.push({ clueId: clue.id, country: l.country, regionCode: l.regionCode, prevalence: l.prevalence });
    }
    if (problems.length > 0) {
      skipped.push({ claimId, reason: problems.join("; ") });
      continue;
    }
    await replaceClaimClues(db, job.duoId, claimId, links, { promptVersion, taggedAt });
    promoted += 1;
  }
  await db.update(claimTaggingJobs).set({ promotedAt: new Date() }).where(eq(claimTaggingJobs.id, job.id));
  duoEventBus.emitChanged(job.duoId, "clue", job.id);
  return {
    jobId: job.id,
    promptVersion,
    promoted,
    skipped,
    createdClues: resolver.created.map((c) => ({ clueId: c.id, family: c.family, name: c.name })),
  };
}
