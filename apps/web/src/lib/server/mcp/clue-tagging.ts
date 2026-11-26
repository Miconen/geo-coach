import { and, eq, inArray } from "drizzle-orm";
import {
  MAX_LACKS_COUNTRIES,
  claimTagItemInputSchema,
  getRegion,
  namedRegionsIn,
  resolveRegionName,
  type LearningRegion,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { claimTaggingJobs, claims } from "../db/schema.js";
import { duoEventBus } from "../events/bus.js";
import {
  clueResolver,
  listDuoClues,
  loadClaimTaggingQueue,
  needsClueTagging,
  replaceClaimClues,
  seedDuoClues,
  type ClaimClueLink,
} from "../services/index.js";
import { getCurrentPromptVersion, loadClueVocabulary } from "./prompts.js";
import { resolveDuoForPlayer } from "./workflow.js";

// Tagging Claims with Clues (#89): not a Processing run. A tagger lists the Duo's Clues, takes Claims from the
// tagging queue and writes each Claim's links, replacing what it had. A worker job's token may tag only the Claims
// its job took from the queue.

/** What a Claim tagging job's token may touch (processing-jobs.ts). */
export interface ClaimTaggingScope {
  jobId: string;
  duoId: string;
  claimIds: readonly string[];
  /** When the job took its Claims: an edit after it puts the Claim back in the queue. */
  startedAt: Date;
}

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

async function taggingDuo(db: AppDb, playerId: string, duo: string | undefined, job: ClaimTaggingScope | null) {
  return job ? { id: job.duoId } : resolveDuoForPlayer(db, playerId, duo);
}

/** `list_clues`: the Duo's Clues by family. A Duo with none yet starts from the seed vocabulary. */
export async function mcpListClues(db: AppDb, playerId: string, input: { duo?: string; family?: string }, job: ClaimTaggingScope | null = null) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const vocabulary = await loadClueVocabulary();
  await seedDuoClues(db, duo.id, vocabulary);
  const all = await listDuoClues(db, duo.id);
  const family = input.family?.trim().toLowerCase();
  const families = vocabulary.families
    .filter((f) => !family || f.family.toLowerCase() === family)
    .map((f) => ({
      family: f.family,
      clues: all
        .filter((c) => c.family === f.family)
        .map((c) => ({ clueId: c.id, name: c.name, claims: c.claimCount })),
    }));
  return { vocabulary: vocabulary.version, families };
}

/**
 * `list_claims_to_tag`: the next Claims of the tagging queue (untagged, edited since tagging, or tagged by an older
 * prompt version), most recently touched first. A job gets the Claims it took, until each is tagged.
 */
export async function mcpListClaimsToTag(
  db: AppDb,
  playerId: string,
  input: { duo?: string; limit?: number },
  job: ClaimTaggingScope | null = null,
) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const promptVersion = getCurrentPromptVersion("clue-tag");
  let ids: string[];
  let remaining: number;
  if (job) {
    const rows = job.claimIds.length
      ? await db.query.claims.findMany({ where: and(eq(claims.duoId, duo.id), inArray(claims.id, [...job.claimIds])) })
      : [];
    ids = rows.filter((c) => needsClueTagging(c, promptVersion)).map((c) => c.id);
    remaining = ids.length;
  } else {
    const busy = await db.query.claimTaggingJobs.findMany({
      where: and(eq(claimTaggingJobs.duoId, duo.id), eq(claimTaggingJobs.status, "running")),
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

/**
 * `tag_claims`: writes each Claim's Clue links, replacing all it had (an empty list tags it as having none), and
 * marks it tagged by the current prompt version. Clues are reused by id or by family and name, and created only
 * inside a vocabulary family; the Clues created are reported. Invalid items are reported and the rest saved.
 */
export async function mcpTagClaims(
  db: AppDb,
  playerId: string,
  input: { duo?: string; items: unknown[] },
  job: ClaimTaggingScope | null = null,
) {
  const duo = await taggingDuo(db, playerId, input.duo, job);
  const promptVersion = getCurrentPromptVersion("clue-tag");
  const vocabulary = await loadClueVocabulary();
  await seedDuoClues(db, duo.id, vocabulary);
  const resolver = await clueResolver(db, duo.id, vocabulary);
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
    const links: ClaimClueLink[] = [];
    const problems: string[] = [];
    for (const c of item.clues) {
      const regions = resolveRegionLinks(known.get(item.claimId)!, c.regions);
      problems.push(...regions.problems);
      // Its Clue is not created for links that fail.
      if (regions.problems.length > 0) continue;
      const clue = await resolver.resolve(c);
      if ("error" in clue) problems.push(clue.error);
      else {
        for (const country of c.countries) links.push({ clueId: clue.id, country, prevalence: c.prevalence });
        for (const r of regions.codes) links.push({ clueId: clue.id, ...r, prevalence: c.prevalence });
      }
    }
    if (problems.length > 0) {
      errors.push({ index: i, message: problems.join("; ") });
      continue;
    }
    const n = await replaceClaimClues(db, duo.id, item.claimId, links, { promptVersion, taggedAt });
    saved.push({ index: i, claimId: item.claimId, links: n });
  }

  if (job && saved.length > 0) await recordJobProgress(db, job, promptVersion);
  if (saved.length > 0) duoEventBus.emitChanged(duo.id, "clue");
  return {
    savedCount: saved.length,
    saved,
    createdClues: resolver.created.map((c) => ({ clueId: c.id, family: c.family, name: c.name })),
    errors,
  };
}

/** How many of a job's Claims are tagged by the current version since it took them. */
export async function countJobTagged(db: AppDb, job: Pick<ClaimTaggingScope, "duoId" | "claimIds" | "startedAt">, promptVersion: string) {
  if (job.claimIds.length === 0) return 0;
  const rows = await db
    .select({ cluesPromptVersion: claims.cluesPromptVersion, cluesTaggedAt: claims.cluesTaggedAt })
    .from(claims)
    .where(and(eq(claims.duoId, job.duoId), inArray(claims.id, [...job.claimIds])));
  return rows.filter((c) => c.cluesPromptVersion === promptVersion && c.cluesTaggedAt && c.cluesTaggedAt >= job.startedAt).length;
}

async function recordJobProgress(db: AppDb, job: ClaimTaggingScope, promptVersion: string) {
  const taggedCount = await countJobTagged(db, job, promptVersion);
  await db.update(claimTaggingJobs).set({ taggedCount }).where(eq(claimTaggingJobs.id, job.jobId));
}

