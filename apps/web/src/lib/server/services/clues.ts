import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  deriveClaimStatus,
  intervalsOverlap,
  isMissingTime,
  uuidv7,
  type ClaimStatus,
  type CluePrevalence,
  type RoundCluePolarity,
  type TimeInterval,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  claimClues,
  claimEvidence,
  claimTaggingJobs,
  claims,
  clues,
  processingRuns,
  roundClueUtterances,
  roundClues,
  rounds,
  utterances,
} from "../db/schema.js";
import { roundGuessingInterval } from "./calls.js";
import { DomainError } from "./recordings.js";
import { loadTranscriptCorrector } from "./transcript-corrections.js";
import { evidenceInDuo, roundInDuo, runInDuo, speechInDuo } from "./scope.js";

// Clues (GLOSSARY: Clue; ADR 0009, #89): the Duo's Clue records, the Claim–Clue links Claim tagging writes, and the
// Round–Clue links `clues` Processing runs write.

type ClueRow = typeof clues.$inferSelect;

/** The families and seed values of a vocabulary prompt (prompts.ts parses it). */
export interface ClueVocabulary {
  version: string;
  families: ReadonlyArray<{ family: string; seeds: readonly string[] }>;
}

export interface DuoClue {
  id: string;
  family: string;
  name: string;
  origin: "seed" | "agent";
  claimCount: number;
  roundCount: number;
}

/** A Duo's Clues by family then name, each with how many Claims and Round links use it. */
export async function listDuoClues(db: AppDb, duoId: string): Promise<DuoClue[]> {
  const [rows, claimCounts, roundCounts] = await Promise.all([
    db.query.clues.findMany({ where: eq(clues.duoId, duoId), orderBy: [asc(clues.family), asc(clues.name)] }),
    db
      .select({ clueId: claimClues.clueId, n: sql<number>`count(distinct ${claimClues.claimId})::int` })
      .from(claimClues)
      .where(eq(claimClues.duoId, duoId))
      .groupBy(claimClues.clueId),
    db
      .select({ clueId: roundClues.clueId, n: sql<number>`count(distinct ${roundClues.roundId})::int` })
      .from(roundClues)
      .where(eq(roundClues.duoId, duoId))
      .groupBy(roundClues.clueId),
  ]);
  const claimsBy = new Map(claimCounts.map((c) => [c.clueId, c.n]));
  const roundsBy = new Map(roundCounts.map((c) => [c.clueId, c.n]));
  return rows.map((c) => ({
    id: c.id,
    family: c.family,
    name: c.name,
    origin: c.origin,
    claimCount: claimsBy.get(c.id) ?? 0,
    roundCount: roundsBy.get(c.id) ?? 0,
  }));
}

/** A Duo's Clues start from the seed vocabulary: the first time it has none, every seed value is created. */
export async function seedDuoClues(db: AppDb, duoId: string, vocabulary: ClueVocabulary): Promise<number> {
  const any = await db.query.clues.findFirst({ where: eq(clues.duoId, duoId), columns: { id: true } });
  if (any) return 0;
  const rows = vocabulary.families.flatMap(({ family, seeds }) =>
    seeds.map((name) => ({ id: uuidv7(), duoId, family, name, origin: "seed" as const })),
  );
  if (rows.length === 0) return 0;
  const inserted = await db.insert(clues).values(rows).onConflictDoNothing().returning({ id: clues.id });
  return inserted.length;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Resolves the Clues a tagging pass names: by id (the Duo's own), or by family and name, reusing a Duo Clue whose
 * name matches ignoring case before creating one. A new Clue must be inside a vocabulary family, never a new family.
 * Clues it creates are remembered in `created`, so the pass can report them.
 */
export async function clueResolver(db: AppDb, duoId: string, vocabulary: ClueVocabulary) {
  const families = new Map(vocabulary.families.map((f) => [norm(f.family), f.family]));
  const existing = await db.query.clues.findMany({ where: eq(clues.duoId, duoId) });
  const byId = new Map(existing.map((c) => [c.id, c]));
  const byKey = new Map(existing.map((c) => [`${norm(c.family)}\u0000${norm(c.name)}`, c]));
  const created: ClueRow[] = [];

  async function resolve(ref: { clueId?: string; family?: string; name?: string }): Promise<ClueRow | { error: string }> {
    if (ref.clueId) return byId.get(ref.clueId) ?? { error: `Unknown or other Duo's clueId: ${ref.clueId}` };
    const family = families.get(norm(ref.family ?? ""));
    if (!family) return { error: `"${ref.family}" is not a Clue family; use one of the vocabulary's families` };
    const name = ref.name!.trim();
    const key = `${norm(family)}\u0000${norm(name)}`;
    const held = byKey.get(key);
    if (held) return held;
    const row: ClueRow = { id: uuidv7(), duoId, family, name, origin: "agent", createdAt: new Date() };
    const [inserted] = await db.insert(clues).values(row).onConflictDoNothing().returning();
    // Another pass created it a moment ago: use that one.
    const clue =
      inserted ??
      (await db.query.clues.findFirst({ where: and(eq(clues.duoId, duoId), eq(clues.family, family), eq(clues.name, name)) }))!;
    if (inserted) created.push(clue);
    byId.set(clue.id, clue);
    byKey.set(key, clue);
    return clue;
  }

  return { resolve, created };
}

/** Renames a Clue within its family. A name another Clue of the family already has is a merge, not a rename. */
export async function renameClue(db: AppDb, duoId: string, clueId: string, name: string): Promise<ClueRow> {
  const clue = await db.query.clues.findFirst({ where: and(eq(clues.id, clueId), eq(clues.duoId, duoId)) });
  if (!clue) throw new DomainError("NOT_FOUND", "Clue not found", 404);
  const trimmed = name.trim();
  if (!trimmed) throw new DomainError("INVALID_NAME", "A Clue needs a name", 400);
  const clash = await db.query.clues.findFirst({
    where: and(eq(clues.duoId, duoId), eq(clues.family, clue.family), sql`lower(${clues.name}) = ${norm(trimmed)}`),
  });
  if (clash && clash.id !== clue.id) {
    throw new DomainError("CLUE_EXISTS", `${clue.family} already has "${clash.name}"; merge the two instead`, 409);
  }
  const [updated] = await db.update(clues).set({ name: trimmed }).where(eq(clues.id, clue.id)).returning();
  return updated!;
}

/**
 * Merges `fromId` into `intoId`: every Claim and Round link moves to `intoId` and `fromId` is deleted. Where both
 * already link the same Claim and place (country, or Region of it) or the same run and Round, the link `intoId` had
 * is kept.
 */
export async function mergeClues(db: AppDb, duoId: string, fromId: string, intoId: string): Promise<{ claimLinksMoved: number; roundLinksMoved: number }> {
  if (fromId === intoId) throw new DomainError("INVALID_MERGE", "Pick two different Clues to merge", 400);
  const both = await db.query.clues.findMany({ where: and(eq(clues.duoId, duoId), inArray(clues.id, [fromId, intoId])) });
  if (both.length !== 2) throw new DomainError("NOT_FOUND", "Clue not found", 404);

  return db.transaction(async (tx) => {
    const movedClaims = await tx
      .update(claimClues)
      .set({ clueId: intoId })
      .where(
        and(
          eq(claimClues.clueId, fromId),
          sql`not exists (select 1 from ${claimClues} x where x.claim_id = ${claimClues.claimId} and x.clue_id = ${intoId} and x.country = ${claimClues.country} and x.region_code is not distinct from ${claimClues.regionCode})`,
        ),
      )
      .returning({ claimId: claimClues.claimId });
    // A Round link that clashes hands its Utterances to the kept link before it goes with the Clue.
    await tx.execute(sql`
      insert into ${roundClueUtterances} (round_clue_id, utterance_id)
      select keep.id, u.utterance_id
      from ${roundClues} gone
      join ${roundClues} keep on keep.run_id = gone.run_id and keep.round_id = gone.round_id and keep.clue_id = ${intoId}
      join ${roundClueUtterances} u on u.round_clue_id = gone.id
      where gone.clue_id = ${fromId}
      on conflict do nothing`);
    const movedRounds = await tx
      .update(roundClues)
      .set({ clueId: intoId })
      .where(
        and(
          eq(roundClues.clueId, fromId),
          sql`not exists (select 1 from ${roundClues} x where x.run_id = ${roundClues.runId} and x.round_id = ${roundClues.roundId} and x.clue_id = ${intoId})`,
        ),
      )
      .returning({ id: roundClues.id });
    await tx.delete(clues).where(eq(clues.id, fromId));
    return { claimLinksMoved: movedClaims.length, roundLinksMoved: movedRounds.length };
  });
}

// --- Claim tagging ----------------------------------------------------------------------------------------------

/** How many Claims one Claim tagging job takes from the queue: one worker run of the model. */
export const CLAIM_TAGGING_BATCH = 100;

export interface QueueClaim {
  id: string;
  createdAt: Date;
  updatedAt: Date | null;
  cluesPromptVersion: string | null;
  cluesTaggedAt: Date | null;
}

/** A Claim is in the tagging queue when it's untagged, tagged by another prompt version, or edited since. */
export function needsClueTagging(c: QueueClaim, promptVersion: string): boolean {
  if (c.cluesPromptVersion !== promptVersion || !c.cluesTaggedAt) return true;
  return c.updatedAt !== null && c.updatedAt.getTime() > c.cluesTaggedAt.getTime();
}

/**
 * The tagging queue's next Claim ids: most recently created or edited first, so new and edited Claims never wait
 * behind the backfill. `exclude` holds Claims another running job is tagging.
 */
export function claimTaggingQueue(
  all: readonly QueueClaim[],
  promptVersion: string,
  opts: { limit?: number; exclude?: ReadonlySet<string> } = {},
): string[] {
  const touched = (c: QueueClaim) => (c.updatedAt ?? c.createdAt).getTime();
  return all
    .filter((c) => needsClueTagging(c, promptVersion) && !opts.exclude?.has(c.id))
    .sort((a, b) => touched(b) - touched(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, opts.limit ?? Infinity)
    .map((c) => c.id);
}

async function queueClaims(db: AppDb, duoId: string): Promise<QueueClaim[]> {
  return db
    .select({
      id: claims.id,
      createdAt: claims.createdAt,
      updatedAt: claims.updatedAt,
      cluesPromptVersion: claims.cluesPromptVersion,
      cluesTaggedAt: claims.cluesTaggedAt,
    })
    .from(claims)
    .where(eq(claims.duoId, duoId));
}

export async function loadClaimTaggingQueue(
  db: AppDb,
  duoId: string,
  promptVersion: string,
  opts: { limit?: number; exclude?: ReadonlySet<string> } = {},
): Promise<string[]> {
  return claimTaggingQueue(await queueClaims(db, duoId), promptVersion, opts);
}

/** How far a Duo's Claims are tagged with the current prompt version. */
export async function claimTaggingProgress(db: AppDb, duoId: string, promptVersion: string) {
  const all = await queueClaims(db, duoId);
  const queued = all.filter((c) => needsClueTagging(c, promptVersion)).length;
  return { total: all.length, tagged: all.length - queued, queued };
}

/** A Claim–Clue link: a whole country, or one Region of it by geocoder code (#92). */
export interface ClaimClueLink {
  clueId: string;
  country: string;
  regionCode?: string | null;
  prevalence: CluePrevalence;
}

/**
 * Tags a Claim: replaces every Clue link it had with `links` (none at all is a tagging too) and records the
 * prompt version and when the tagger read it. Other Claims' links, and the Clue records, stay as they are.
 */
export async function replaceClaimClues(
  db: AppDb,
  duoId: string,
  claimId: string,
  links: ReadonlyArray<ClaimClueLink>,
  mark: { promptVersion: string; taggedAt: Date },
): Promise<number> {
  // One link per Clue and place (a country, or a Region of it): a later entry for the same place wins.
  const unique = new Map(links.map((l) => [`${l.clueId}:${l.country}:${l.regionCode ?? ""}`, { ...l, regionCode: l.regionCode ?? null }]));
  await db.transaction(async (tx) => {
    await tx.delete(claimClues).where(and(eq(claimClues.claimId, claimId), eq(claimClues.duoId, duoId)));
    if (unique.size > 0) {
      await tx.insert(claimClues).values([...unique.values()].map((l) => ({ claimId, duoId, ...l })));
    }
    await tx
      .update(claims)
      .set({ cluesPromptVersion: mark.promptVersion, cluesTaggedAt: mark.taggedAt })
      .where(and(eq(claims.id, claimId), eq(claims.duoId, duoId)));
  });
  return unique.size;
}

/**
 * After an agent creates or edits Claims, queue their tagging, but only once the Duo's tagging has started (some
 * Claim is tagged): before the maintainer's test run nothing is tagged on its own. The queue serves the newest
 * Claims first, so a job for `count` Claims takes these. A queued job with room just takes more.
 */
export async function queueTaggingOfChangedClaims(db: AppDb, playerId: string, duoId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const started = await db.query.claims.findFirst({
    where: and(eq(claims.duoId, duoId), isNotNull(claims.cluesTaggedAt)),
    columns: { id: true },
  });
  if (!started) return;
  const queued = await db.query.claimTaggingJobs.findFirst({
    where: and(eq(claimTaggingJobs.duoId, duoId), eq(claimTaggingJobs.status, "queued")),
    orderBy: [desc(claimTaggingJobs.createdAt)],
  });
  if (queued && queued.claimLimit + count <= CLAIM_TAGGING_BATCH) {
    await db
      .update(claimTaggingJobs)
      .set({ claimLimit: queued.claimLimit + count })
      .where(and(eq(claimTaggingJobs.id, queued.id), eq(claimTaggingJobs.status, "queued")));
    return;
  }
  await db.insert(claimTaggingJobs).values({
    id: uuidv7(),
    duoId,
    requestedByPlayerId: playerId,
    claimLimit: Math.min(count, CLAIM_TAGGING_BATCH),
  });
}

// --- Round Clues ----------------------------------------------------------------------------------------------------

/** A Round Clue to save: seen, or not seen (#93). */
export interface RoundClueToSave {
  clueId: string;
  polarity: RoundCluePolarity;
  note: string | null;
  utteranceIds: string[];
}

/**
 * Saves a `clues` run's Clues for some Rounds. Each item is all the Clues said in its Round, seen or not: it replaces
 * what this run said earlier about that Round. Earlier runs' links are left for replacement by derivation (ADR 0002).
 * A Clue listed twice for a Round keeps one link, seen if either says so.
 */
export async function insertRunRoundClues(
  db: AppDb,
  runId: string,
  duoId: string,
  items: ReadonlyArray<{ roundId: string; clues: ReadonlyArray<RoundClueToSave> }>,
): Promise<number> {
  let saved = 0;
  for (const item of items) {
    await db.delete(roundClues).where(and(eq(roundClues.runId, runId), eq(roundClues.roundId, item.roundId)));
    const byClue = new Map<string, RoundClueToSave>();
    for (const c of item.clues) {
      const held = byClue.get(c.clueId);
      if (!held || held.polarity === "not_seen" || c.polarity === "seen") byClue.set(c.clueId, c);
    }
    for (const c of byClue.values()) {
      const id = uuidv7();
      await db.insert(roundClues).values({ id, duoId, runId, roundId: item.roundId, clueId: c.clueId, polarity: c.polarity, note: c.note });
      if (c.utteranceIds.length > 0) {
        await db
          .insert(roundClueUtterances)
          .values(c.utteranceIds.map((utteranceId) => ({ roundClueId: id, utteranceId })))
          .onConflictDoNothing();
      }
      saved += 1;
    }
  }
  return saved;
}

type RunLike = Pick<typeof processingRuns.$inferSelect, "id" | "rangeStart" | "rangeEnd" | "status" | "finishedAt">;

/**
 * The `clues` run whose links a Round shows: the latest finished run whose range overlaps the Round's guessing
 * (ADR 0002). It replaces earlier runs' links for the Round even when it found no Clue there. Null when none.
 */
export function latestClueRunFor<R extends RunLike>(guessing: TimeInterval, runs: readonly R[]): R | null {
  let best: R | null = null;
  for (const r of runs) {
    if (r.status !== "finished" || !r.finishedAt) continue;
    if (!intervalsOverlap(guessing, { startedAt: r.rangeStart, endedAt: r.rangeEnd })) continue;
    const later =
      !best ||
      r.finishedAt.getTime() > best.finishedAt!.getTime() ||
      (r.finishedAt.getTime() === best.finishedAt!.getTime() && r.id > best.id);
    if (later) best = r;
  }
  return best;
}

export interface CurrentRoundClue {
  clueId: string;
  runId: string;
  polarity: RoundCluePolarity;
  note: string | null;
  utteranceIds: string[];
}

/** Each Round's Clues in effect (from its latest covering finished `clues` run), for the given Rounds of a Duo. */
export async function deriveCurrentRoundClues(
  db: AppDb,
  duoId: string,
  roundIds: readonly string[],
): Promise<Map<string, CurrentRoundClue[]>> {
  const out = new Map<string, CurrentRoundClue[]>();
  if (roundIds.length === 0) return out;
  const [roundRows, runs] = await Promise.all([
    db
      .select({ id: rounds.id, startTime: rounds.startTime, endTime: rounds.endTime })
      .from(rounds)
      .where(and(inArray(rounds.id, [...roundIds]), roundInDuo(duoId))),
    db.query.processingRuns.findMany({
      where: and(runInDuo(duoId), eq(processingRuns.purpose, "clues"), eq(processingRuns.status, "finished")),
    }),
  ]);
  const winner = new Map<string, string>();
  for (const r of roundRows) {
    if (isMissingTime(r.startTime)) continue;
    const run = latestClueRunFor(roundGuessingInterval(r), runs);
    if (run) winner.set(r.id, run.id);
  }
  if (winner.size === 0) return out;
  const links = await db
    .select()
    .from(roundClues)
    .where(
      and(
        eq(roundClues.duoId, duoId),
        inArray(roundClues.roundId, [...winner.keys()]),
        inArray(roundClues.runId, [...new Set(winner.values())]),
      ),
    )
    .orderBy(asc(roundClues.createdAt), asc(roundClues.id));
  const current = links.filter((l) => winner.get(l.roundId) === l.runId);
  const cites =
    current.length > 0
      ? await db
          .select({ roundClueId: roundClueUtterances.roundClueId, utteranceId: roundClueUtterances.utteranceId })
          .from(roundClueUtterances)
          .innerJoin(utterances, eq(utterances.id, roundClueUtterances.utteranceId))
          .where(and(inArray(roundClueUtterances.roundClueId, current.map((l) => l.id)), speechInDuo(duoId)))
      : [];
  const citesBy = new Map<string, string[]>();
  for (const c of cites) citesBy.set(c.roundClueId, [...(citesBy.get(c.roundClueId) ?? []), c.utteranceId]);
  for (const l of current) {
    out.set(l.roundId, [
      ...(out.get(l.roundId) ?? []),
      { clueId: l.clueId, runId: l.runId, polarity: l.polarity, note: l.note, utteranceIds: citesBy.get(l.id) ?? [] },
    ]);
  }
  return out;
}

// --- the Clue lens's data ----------------------------------------------------------------------------------------

/** An Utterance a Round Clue rests on, with its corrected text (#88), for the lens card to quote. */
export interface ClueQuote {
  id: string;
  playerId: string;
  text: string;
  startedAt: Date;
}

export interface ClueLensData {
  /** Each Round's Clues in effect, with the speech they rest on. */
  byRound: Map<string, Array<CurrentRoundClue & { quotes: ClueQuote[] }>>;
  /** The Clues those Rounds said. */
  clues: Array<Pick<ClueRow, "id" | "family" | "name">>;
  /** Every Claim link of those Clues, Region links (#92) included. */
  links: Array<{ claimId: string; clueId: string; country: string; regionCode: string | null; prevalence: CluePrevalence }>;
  /** The linked Claims, with derived status (ADR 0005). */
  claims: Array<{ id: string; text: string; status: ClaimStatus }>;
}

/** What the Clue lens needs for a set of Rounds: their Clues and quotes, those Clues' Claim links, and the Claims. */
export async function loadClueLens(db: AppDb, duoId: string, roundIds: readonly string[]): Promise<ClueLensData> {
  const current = await deriveCurrentRoundClues(db, duoId, roundIds);
  const clueIds = [...new Set([...current.values()].flat().map((c) => c.clueId))];
  if (clueIds.length === 0) return { byRound: new Map(), clues: [], links: [], claims: [] };
  const quoteIds = [...new Set([...current.values()].flat().flatMap((c) => c.utteranceIds))];
  const [clueRows, links, quoteRows, correct] = await Promise.all([
    db
      .select({ id: clues.id, family: clues.family, name: clues.name })
      .from(clues)
      .where(and(eq(clues.duoId, duoId), inArray(clues.id, clueIds))),
    db
      .select({
        claimId: claimClues.claimId,
        clueId: claimClues.clueId,
        country: claimClues.country,
        regionCode: claimClues.regionCode,
        prevalence: claimClues.prevalence,
      })
      .from(claimClues)
      .innerJoin(claims, eq(claims.id, claimClues.claimId))
      .where(and(eq(claimClues.duoId, duoId), eq(claims.duoId, duoId), inArray(claimClues.clueId, clueIds))),
    quoteIds.length > 0
      ? db
          .select({ id: utterances.id, playerId: utterances.playerId, text: utterances.text, startedAt: utterances.startedAt, recordingId: utterances.recordingId, words: utterances.words, startSampleMs: utterances.startSampleMs, endedAt: utterances.endedAt })
          .from(utterances)
          .where(and(inArray(utterances.id, quoteIds), speechInDuo(duoId)))
      : Promise.resolve([]),
    loadTranscriptCorrector(db, duoId),
  ]);
  const quoteById = new Map(
    quoteRows.map((u) => [u.id, { id: u.id, playerId: u.playerId, text: correct(u).text, startedAt: u.startedAt }]),
  );
  const byRound: ClueLensData["byRound"] = new Map();
  // A Round's Clues read in the order they were said.
  const firstSaid = (c: { quotes: ClueQuote[] }) => c.quotes[0]?.startedAt.getTime() ?? Infinity;
  for (const [roundId, list] of current) {
    const quoted = list.map((c) => ({
      ...c,
      quotes: c.utteranceIds
        .flatMap((id) => (quoteById.has(id) ? [quoteById.get(id)!] : []))
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
    }));
    byRound.set(roundId, quoted.sort((a, b) => firstSaid(a) - firstSaid(b)));
  }
  const claimIds = [...new Set(links.map((l) => l.claimId))];
  const [claimRows, evidence] =
    claimIds.length > 0
      ? await Promise.all([
          db.select({ id: claims.id, text: claims.text }).from(claims).where(inArray(claims.id, claimIds)),
          db
            .select({ claimId: claimEvidence.claimId, kind: claimEvidence.kind, direction: claimEvidence.direction })
            .from(claimEvidence)
            .where(and(evidenceInDuo(duoId), inArray(claimEvidence.claimId, claimIds))),
        ])
      : [[], []];
  const evidenceBy = new Map<string, typeof evidence>();
  for (const e of evidence) evidenceBy.set(e.claimId, [...(evidenceBy.get(e.claimId) ?? []), e]);
  return {
    byRound,
    clues: clueRows,
    links,
    claims: claimRows.map((c) => ({ id: c.id, text: c.text, status: deriveClaimStatus(evidenceBy.get(c.id) ?? []) })),
  };
}
