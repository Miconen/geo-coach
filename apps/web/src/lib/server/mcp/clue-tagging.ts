import { and, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_LACKS_COUNTRIES,
  claimTagItemInputSchema,
  getRegion,
  namedRegionsIn,
  resolveRegionName,
  type CluePrevalence,
  type LearningRegion,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { claimTaggingJobs, claimTaggingTrialClaims, claims } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import {
  clueResolver,
  listDuoClues,
  loadClaimTaggingQueue,
  needsClueTagging,
  replaceClaimClues,
  replaceTrialClaimClues,
  seedDuoClues,
  trialClueResolver,
  type ClaimClueLink,
  type TrialClaimClueLink,
} from "../services/index.js";
import { getCurrentPromptVersion, loadClueVocabulary } from "./prompts.js";
import { resolveDuoForPlayer } from "./workflow.js";

// Tagging Claims with Clues (#89): not a Processing run. A tagger lists the Duo's Clues, takes Claims from the
// tagging queue and writes each Claim's links, replacing what it had. A worker job's token may tag only the Claims
// its job took from the queue. A trial job (#94) tags the same way into a side store, and leaves the live links,
// the Claims' tagging marks and the Duo's Clues alone.

/** What a Claim tagging job's token may touch (processing-jobs.ts). */
export interface ClaimTaggingScope {
  jobId: string;
  duoId: string;
  claimIds: readonly string[];
  /** When the job took its Claims: an edit after it puts the Claim back in the queue. */
  startedAt: Date;
  /** A trial writes to the trial store only (#94). */
  trial: boolean;
  /** The `clue-tag` prompt version the job tags with: the current one, or an earlier one for a trial. */
  promptVersion: string;
}

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

async function taggingDuo(db: AppDb, playerId: string, duo: string | undefined, job: ClaimTaggingScope | null) {
  return job ? { id: job.duoId } : resolveDuoForPlayer(db, playerId, duo);
}

/**
 * `list_clues`: the Duo's Clues by family. A Duo with none yet starts from the seed vocabulary; a trial never
 * creates Clues, so it lists the seeds without ids instead.
 */
export async function mcpListClues(db: AppDb, playerId: string, input: { duo?: string; family?: string }, job: ClaimTaggingScope | null = null) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const vocabulary = await loadClueVocabulary(job?.promptVersion);
  if (!job?.trial) await seedDuoClues(db, duo.id, vocabulary);
  const all = await listDuoClues(db, duo.id);
  const family = input.family?.trim().toLowerCase();
  const families = vocabulary.families
    .filter((f) => !family || f.family.toLowerCase() === family)
    .map((f) => ({
      family: f.family,
      clues:
        all.length === 0
          ? f.seeds.map((name) => ({ clueId: null, name, claims: 0 }))
          : all.filter((c) => c.family === f.family).map((c) => ({ clueId: c.id, name: c.name, claims: c.claimCount })),
    }));
  return { vocabulary: vocabulary.version, families };
}

/** The job's Claims a trial has tagged so far. */
async function trialTaggedIds(db: AppDb, jobId: string): Promise<Set<string>> {
  const rows = await db
    .select({ claimId: claimTaggingTrialClaims.claimId })
    .from(claimTaggingTrialClaims)
    .where(eq(claimTaggingTrialClaims.jobId, jobId));
  return new Set(rows.map((r) => r.claimId));
}

/**
 * `list_claims_to_tag`: the next Claims of the tagging queue (untagged, edited since tagging, or tagged by an older
 * prompt version), most recently touched first. A job gets the Claims it took, until each is tagged: by this job
 * since it started, or, for a trial, in its trial store.
 */
export async function mcpListClaimsToTag(
  db: AppDb,
  playerId: string,
  input: { duo?: string; limit?: number },
  job: ClaimTaggingScope | null = null,
) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const promptVersion = job?.promptVersion ?? getCurrentPromptVersion("clue-tag");
  let ids: string[];
  let remaining: number;
  if (job) {
    const rows = job.claimIds.length
      ? await db.query.claims.findMany({ where: and(eq(claims.duoId, duo.id), inArray(claims.id, [...job.claimIds])) })
      : [];
    const done = job.trial ? await trialTaggedIds(db, job.jobId) : null;
    ids = rows
      .filter((c) =>
        done
          ? !done.has(c.id)
          : needsClueTagging(c, promptVersion) || !c.cluesTaggedAt || c.cluesTaggedAt < job.startedAt,
      )
      .map((c) => c.id);
    remaining = ids.length;
  } else {
    const busy = await db.query.claimTaggingJobs.findMany({
      where: and(eq(claimTaggingJobs.duoId, duo.id), eq(claimTaggingJobs.status, "running"), eq(claimTaggingJobs.trial, false)),
      columns: { claimIds: true },
    });
    const queue = await loadClaimTaggingQueue(db, duo.id, promptVersion, { exclude: new Set(busy.flatMap((j) => j.claimIds)) });
    remaining = queue.length;
    ids = queue.slice(0, Math.min(Math.max(1, input.limit ?? DEFAULT_BATCH), MAX_BATCH));
  }
  const rows = ids.length ? await db.query.claims.findMany({ where: and(eq(claims.duoId, duo.id), inArray(claims.id, ids)) }) : [];
  const byId = new Map(rows.map((c) => [c.id, c]));
  return {
    promptVersion,
    remaining,
    claims: ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ claimId: c.id, text: c.text, countries: c.countries, regions: claimRegions(c) }] : [];
    }),
  };
}

/**
 * The Regions a Claim names (#92), for the tagger: its own Regions, each with the geocoder code it resolves to (null
 * when it doesn't, so it can only be a country link), then Regions its text names that it doesn't list.
 */
export function claimRegions(claim: { text: string; countries: readonly string[]; regions: readonly LearningRegion[] }) {
  const own = claim.regions.map((r) => ({ country: r.country, name: r.name, code: resolveRegionName(r.country, r.name)?.code ?? null }));
  const listed = new Set(own.map((r) => r.code));
  const inText = namedRegionsIn(claim)
    .filter((code) => !listed.has(code))
    .map((code) => {
      const info = getRegion(code)!;
      return { country: info.countryCode, name: info.name, code };
    });
  return [...own, ...inText];
}

/**
 * A tag item's Region links (#92): each Region resolved to its geocoder code. A name that doesn't resolve, or a
 * Region the Claim doesn't name in its text or its Regions, is an error: a vague scope stays a country link, never a
 * guessed list of Regions.
 */
export function resolveRegionLinks(
  claim: { text: string; countries: readonly string[]; regions: readonly LearningRegion[] },
  regions: readonly LearningRegion[],
): { codes: Array<{ country: string; regionCode: string }>; problems: string[] } {
  const named = new Set(namedRegionsIn(claim));
  const codes: Array<{ country: string; regionCode: string }> = [];
  const problems: string[] = [];
  for (const r of regions) {
    const info = resolveRegionName(r.country, r.name);
    if (!info) problems.push(`${r.country}: "${r.name}" isn't a Region the geocoder knows; link the country as some instead`);
    else if (!named.has(info.code)) problems.push(`The Claim doesn't name ${info.name} (${info.code}); link only Regions it names`);
    else codes.push({ country: info.countryCode, regionCode: info.code });
  }
  return { codes, problems };
}

/** A Clue a tagging pass named, resolved: one the Duo has (id) or, in a trial, one it would create (no id). */
type ResolvedClue = { id: string | null; family: string; name: string };
type PlaceLink = { country: string; regionCode?: string | null; prevalence: CluePrevalence };

/**
 * `tag_claims`: writes each Claim's Clue links, replacing all it had (an empty list tags it as having none), and
 * marks it tagged by the job's prompt version (the current one outside a job). Clues are reused by id or by family
 * and name, and created only inside a vocabulary family; the Clues created are reported. Invalid items are reported
 * and the rest saved. A trial job writes to its trial store only, and reports the Clues it would create.
 */
export async function mcpTagClaims(
  db: AppDb,
  playerId: string,
  input: { duo?: string; items: unknown[] },
  job: ClaimTaggingScope | null = null,
) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const promptVersion = job?.promptVersion ?? getCurrentPromptVersion("clue-tag");
  const vocabulary = await loadClueVocabulary(promptVersion);
  const trial = job?.trial ? job : null;
  if (!trial) await seedDuoClues(db, duo.id, vocabulary);
  const live = trial ? null : await clueResolver(db, duo.id, vocabulary);
  const dry = trial ? await trialClueResolver(db, duo.id, vocabulary) : null;
  const resolve = async (ref: Parameters<NonNullable<typeof dry>["resolve"]>[0]): Promise<ResolvedClue | { error: string }> =>
    dry ? dry.resolve(ref) : live!.resolve(ref);

  const parsed = input.items.map((raw) => claimTagItemInputSchema.safeParse(raw));
  const wanted = parsed.flatMap((p) => (p.success ? [p.data.claimId] : []));
  const known = new Map(
    wanted.length
      ? (
          await db
            .select({ id: claims.id, text: claims.text, countries: claims.countries, regions: claims.regions })
            .from(claims)
            .where(and(eq(claims.duoId, duo.id), inArray(claims.id, wanted)))
        ).map((c) => [c.id, c])
      : [],
  );
  const allowed = job ? new Set(job.claimIds) : null;
  const taggedAt = job?.startedAt ?? new Date();

  const saved: Array<{ index: number; claimId: string; links: number }> = [];
  const errors: Array<{ index: number; message: string }> = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;
    if (!p.success) {
      errors.push({ index: i, message: p.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ") });
      continue;
    }
    const item = p.data;
    if (!known.has(item.claimId)) {
      errors.push({ index: i, message: `Unknown or other Duo's claimId: ${item.claimId}` });
      continue;
    }
    if (allowed && !allowed.has(item.claimId)) {
      errors.push({ index: i, message: `Claim ${item.claimId} isn't one of this job's Claims` });
      continue;
    }
    const lacking = new Set(item.clues.filter((c) => c.prevalence === "lacks").flatMap((c) => c.countries));
    if (lacking.size > MAX_LACKS_COUNTRIES) {
      errors.push({
        index: i,
        message: `${lacking.size} countries lack a Clue: rule out only the countries the Claim names or a scope it states, at most ${MAX_LACKS_COUNTRIES}`,
      });
      continue;
    }
    const links: Array<{ clue: ResolvedClue } & PlaceLink> = [];
    const problems: string[] = [];
    for (const c of item.clues) {
      const regions = resolveRegionLinks(known.get(item.claimId)!, c.regions);
      problems.push(...regions.problems);
      // Its Clue is not created for links that fail.
      if (regions.problems.length > 0) continue;
      const clue = await resolve(c);
      if ("error" in clue) problems.push(clue.error);
      else {
        for (const country of c.countries) links.push({ clue, country, prevalence: c.prevalence });
        for (const r of regions.codes) links.push({ clue, ...r, prevalence: c.prevalence });
      }
    }
    if (problems.length > 0) {
      errors.push({ index: i, message: problems.join("; ") });
      continue;
    }
    const n = trial
      ? await replaceTrialClaimClues(
          db,
          { jobId: trial.jobId, duoId: duo.id },
          item.claimId,
          links.map(({ clue, ...l }): TrialClaimClueLink => ({ clueId: clue.id, family: clue.family, name: clue.name, ...l })),
        )
      : await replaceClaimClues(
          db,
          duo.id,
          item.claimId,
          links.map(({ clue, ...l }): ClaimClueLink => ({ clueId: clue.id!, ...l })),
          { promptVersion, taggedAt },
        );
    saved.push({ index: i, claimId: item.claimId, links: n });
  }

  const createdClues = trial
    ? [...dry!.proposed.values()].map((c) => ({ clueId: null, family: c.family, name: c.name }))
    : live!.created.map((c) => ({ clueId: c.id as string | null, family: c.family, name: c.name }));
  if (job && saved.length > 0) await recordJobProgress(db, job, createdClues);
  if (saved.length > 0) duoEventBus.emitChanged(duo.id, "clue", job?.jobId);
  return {
    savedCount: saved.length,
    saved,
    // A trial's are the Clues it would create: none exists until the trial is promoted.
    ...(trial ? { trial: true } : {}),
    createdClues,
    errors,
  };
}

/** How many of a job's Claims are tagged by its prompt version since it took them. */
export async function countJobTagged(db: AppDb, job: Pick<ClaimTaggingScope, "duoId" | "claimIds" | "startedAt">, promptVersion: string) {
  if (job.claimIds.length === 0) return 0;
  const rows = await db
    .select({ cluesPromptVersion: claims.cluesPromptVersion, cluesTaggedAt: claims.cluesTaggedAt })
    .from(claims)
    .where(and(eq(claims.duoId, job.duoId), inArray(claims.id, [...job.claimIds])));
  return rows.filter((c) => c.cluesPromptVersion === promptVersion && c.cluesTaggedAt && c.cluesTaggedAt >= job.startedAt).length;
}

/** How many Claims a trial job has tagged in its trial store. */
export async function countTrialTagged(db: AppDb, jobId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(claimTaggingTrialClaims)
    .where(eq(claimTaggingTrialClaims.jobId, jobId));
  return row?.n ?? 0;
}

/** Records a job's progress and the Clues it created (or, a trial, would create), adding to what it had. */
async function recordJobProgress(
  db: AppDb,
  job: ClaimTaggingScope,
  created: Array<{ clueId: string | null; family: string; name: string }>,
) {
  const taggedCount = job.trial ? await countTrialTagged(db, job.jobId) : await countJobTagged(db, job, job.promptVersion);
  const row = await db.query.claimTaggingJobs.findFirst({ where: eq(claimTaggingJobs.id, job.jobId), columns: { createdClues: true } });
  const key = (c: { family: string; name: string }) => `${c.family.toLowerCase()}\u0000${c.name.toLowerCase()}`;
  const all = new Map((row?.createdClues ?? []).map((c) => [key(c), c]));
  for (const c of created) if (!all.has(key(c))) all.set(key(c), c);
  await db.update(claimTaggingJobs).set({ taggedCount, createdClues: [...all.values()] }).where(eq(claimTaggingJobs.id, job.jobId));
}
