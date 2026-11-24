import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { isUuid } from "$lib/uuid.js";
import type { AppDb } from "../db/index.js";
import {
  claimEvidence,
  claims,
  games,
  processingRuns,
  recordings,
  rounds,
  sessions,
  sourceImages,
  sourceVersions,
  sources,
  transcriptVersions,
  utterances,
} from "../db/schema.js";

/*
 * Duo-agreement predicates (plan #56 step 0a). The schema stores duo_id on every row and relates rows through
 * independent foreign keys, so a row can point at another Duo's parent. Each predicate below checks the whole
 * chain for one entity; every reader of that entity uses it.
 */

/** Speech check: the Utterance, its Transcript version, its Recording and that Recording's Session share one Duo,
 * and the version belongs to the Utterance's Recording. */
export function speechInDuo(duoId: string): SQL {
  return and(
    eq(utterances.duoId, duoId),
    sql`exists (select 1 from ${transcriptVersions} tv
      join ${recordings} r on r.id = tv.recording_id
      join ${sessions} s on s.id = r.session_id
      where tv.id = ${utterances.transcriptVersionId}
        and tv.recording_id = ${utterances.recordingId}
        and tv.duo_id = ${duoId} and r.duo_id = ${duoId} and s.duo_id = ${duoId})`,
  )!;
}

/** Version check: the Transcript version, its Recording and that Recording's Session share one Duo. */
export function versionInDuo(duoId: string): SQL {
  return and(
    eq(transcriptVersions.duoId, duoId),
    sql`exists (select 1 from ${recordings} r
      join ${sessions} s on s.id = r.session_id
      where r.id = ${transcriptVersions.recordingId} and r.duo_id = ${duoId} and s.duo_id = ${duoId})`,
  )!;
}

/** Recording-to-Session check: the Recording's Session belongs to the Recording's Duo. */
export function recordingInDuo(duoId: string): SQL {
  return and(
    eq(recordings.duoId, duoId),
    sql`exists (select 1 from ${sessions} s where s.id = ${recordings.sessionId} and s.duo_id = ${duoId})`,
  )!;
}

/** Run-to-Session check: the run's Session belongs to the run's Duo. */
export function runInDuo(duoId: string): SQL {
  return and(
    eq(processingRuns.duoId, duoId),
    sql`exists (select 1 from ${sessions} s where s.id = ${processingRuns.sessionId} and s.duo_id = ${duoId})`,
  )!;
}

/** Round/Game check (X7): rounds.duoId, its Game's duoId and the requested Duo agree. */
export function roundInDuo(duoId: string): SQL {
  return and(
    eq(rounds.duoId, duoId),
    sql`exists (select 1 from ${games} g where g.id = ${rounds.gameId} and g.duo_id = ${duoId})`,
  )!;
}

/** Ids of runs that pass the run-to-Session check. */
export async function validRunIds(db: AppDb, duoId: string): Promise<Set<string>> {
  const rows = await db.select({ id: processingRuns.id }).from(processingRuns).where(runInDuo(duoId));
  return new Set(rows.map((r) => r.id));
}

/** Loads one run only when it passes the run-to-Session check (else null). */
export async function findRunInDuo(db: AppDb, duoId: string, runId: string) {
  const [row] = await db
    .select()
    .from(processingRuns)
    .where(and(eq(processingRuns.id, runId), runInDuo(duoId)))
    .limit(1);
  return row ?? null;
}

/** Of `ids`, the Utterance ids that pass the speech check. */
export async function scopedUtteranceIds(db: AppDb, duoId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: utterances.id })
    .from(utterances)
    .where(and(inArray(utterances.id, ids), speechInDuo(duoId)));
  return new Set(rows.map((r) => r.id));
}

/** Of `ids`, the Round ids that pass the Round/Game check. */
export async function scopedRoundIds(db: AppDb, duoId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: rounds.id }).from(rounds).where(and(inArray(rounds.id, ids), roundInDuo(duoId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * The one Evidence scoping function (X6): claim_evidence.duoId matches and every present reference is the same
 * Duo: the Claim; the Round and its Game; the Source version and its Source; the run and its Session. Absent
 * references (run-less, Round-less, Player Evidence) stay valid. claimEvidenceFacts deliberately stays outside it.
 */
export function evidenceInDuo(duoId: string): SQL {
  return and(
    eq(claimEvidence.duoId, duoId),
    sql`exists (select 1 from ${claims} c where c.id = ${claimEvidence.claimId} and c.duo_id = ${duoId})`,
    sql`(${claimEvidence.roundId} is null or exists (select 1 from ${rounds} r join ${games} g on g.id = r.game_id
      where r.id = ${claimEvidence.roundId} and r.duo_id = ${duoId} and g.duo_id = ${duoId}))`,
    sql`(${claimEvidence.sourceVersionId} is null or exists (select 1 from ${sourceVersions} v
      join ${sources} so on so.id = v.source_id
      where v.id = ${claimEvidence.sourceVersionId} and v.duo_id = ${duoId} and so.duo_id = ${duoId}))`,
    sql`(${claimEvidence.runId} is null or exists (select 1 from ${processingRuns} pr join ${sessions} s on s.id = pr.session_id
      where pr.id = ${claimEvidence.runId} and pr.duo_id = ${duoId} and s.duo_id = ${duoId}))`,
  )!;
}

/** A Source image passes when the image, its version and the version's Source share the Duo. */
export function sourceImageInDuo(duoId: string): SQL {
  return and(
    eq(sourceImages.duoId, duoId),
    sql`exists (select 1 from ${sourceVersions} v join ${sources} so on so.id = v.source_id
      where v.id = ${sourceImages.sourceVersionId} and v.duo_id = ${duoId} and so.duo_id = ${duoId})`,
  )!;
}

/** A Source version passes when it and its Source share the Duo. */
export function sourceVersionInDuo(duoId: string): SQL {
  return and(
    eq(sourceVersions.duoId, duoId),
    sql`exists (select 1 from ${sources} so where so.id = ${sourceVersions.sourceId} and so.duo_id = ${duoId})`,
  )!;
}

/** Loads a run by id only when its Session belongs to the run's Duo (else null). Used before the caller
 * knows the Duo, e.g. MCP tools that take a runId. */
export async function findScopedRun(db: AppDb, runId: string) {
  if (!isUuid(runId)) return null;
  const [row] = await db
    .select()
    .from(processingRuns)
    .where(
      and(
        eq(processingRuns.id, runId),
        sql`exists (select 1 from ${sessions} s where s.id = ${processingRuns.sessionId} and s.duo_id = ${processingRuns.duoId})`,
      ),
    )
    .limit(1);
  return row ?? null;
}
