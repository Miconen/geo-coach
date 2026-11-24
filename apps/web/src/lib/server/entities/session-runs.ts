import { and, eq, inArray, sql } from "drizzle-orm";
import { processingRunPurposeSchema, type ProcessingRunPurpose } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { processingJobs, processingRuns } from "../db/schema.js";
import { ALREADY_UP_TO_DATE } from "../mcp/processing-jobs.js";
import { deriveCallLabelHistory, deriveLearningsWithStatus, runInDuo } from "../services/index.js";
import { isUuid } from "../../uuid.js";
import {
  jobInDuo,
  jobRow,
  outputCounts,
  runRow,
  type RunTimelineNoOp,
  type RunTimelineRow,
} from "../workbench/run-timeline.js";

export const RUNS_PAGE_SIZE = 50;

/** Raw SQL results: postgres-js returns the rows, PGlite (tests) { rows }. */
async function query<T>(db: AppDb, q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown;
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

/** GET /sessions/[sessionId]/runs (#56 2a(i)): one page of a Session's run history. */
export interface SessionRunsPage {
  rows: RunTimelineRow[];
  /** Opaque; null on the last page. */
  nextCursor: string | null;
  /** A valid ?run= pin of this Session that is not on this page (page one only), so the cursor never moves. */
  pinnedRun: RunTimelineRow | null;
  /** One group per purpose with no-op ("Already up to date.") jobs (page one of the main list only). */
  noOps: RunTimelineNoOp[];
}

export interface SessionRunsQuery {
  cursor: RunsCursor | null;
  /** With noop: list that purpose's no-op jobs. */
  purpose: ProcessingRunPurpose | null;
  noop: boolean;
  runId: string | null;
  limit?: number;
}

/** Exact SQL timestamp text (UTC, microseconds) plus the row id; never round-trips through a JS Date. */
export interface RunsCursor {
  key: string;
  id: string;
}

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;

export function encodeRunsCursor(c: RunsCursor): string {
  return Buffer.from(JSON.stringify([c.key, c.id]), "utf8").toString("base64url");
}

/** Null when the text is not a cursor this API issued: calendar, year and time fields are checked (no 22007/22008). */
export function decodeRunsCursor(raw: string): RunsCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [key, id] = parsed;
  if (typeof key !== "string" || typeof id !== "string" || !isUuid(id)) return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) return null;
  return { key, id };
}

export type RunsQueryError = { error: string };

/** Parses ?cursor=, ?purpose=, ?noop= and ?run= (X1: bad cursor or purpose is 400; a bad ?run= is dropped). */
export function parseRunsQuery(params: URLSearchParams): SessionRunsQuery | RunsQueryError {
  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeRunsCursor(rawCursor);
  if (rawCursor !== null && !cursor) return { error: "Invalid cursor" };
  const rawPurpose = params.get("purpose");
  const purposeParse = rawPurpose === null ? null : processingRunPurposeSchema.safeParse(rawPurpose);
  if (purposeParse && !purposeParse.success) return { error: "Invalid purpose" };
  const noop = params.get("noop") === "1";
  if (params.has("noop") && params.get("noop") !== "1") return { error: "Invalid noop" };
  if (noop && !purposeParse) return { error: "noop=1 needs a purpose" };
  const run = params.get("run");
  return { cursor, purpose: purposeParse?.data ?? null, noop, runId: run !== null && isUuid(run) ? run : null };
}

const SORT_KEY_TEXT = (expr: ReturnType<typeof sql>) =>
  sql`to_char((${expr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * One page of the Session's history, newest first: run-backed rows keyed by finished_at when finished, else
 * started_at; job-only rows by finished_at, else created_at; tie-breaker the row id. Active rows (an active job,
 * or a jobless open run) are pinned on page one only. No-op jobs collapse in SQL to one per purpose (its newest)
 * before LIMIT; ?purpose=&noop=1 lists them.
 */
export async function loadSessionRunsPage(
  db: AppDb,
  duoId: string,
  sessionId: string,
  q: SessionRunsQuery,
): Promise<SessionRunsPage> {
  const limit = q.limit ?? RUNS_PAGE_SIZE;
  const noopMsg = ALREADY_UP_TO_DATE;
  const unified = sql`
    with first_job as (
      select distinct on (j.run_id) j.run_id, j.id, j.status
      from processing_jobs j
      join processing_runs r on r.id = j.run_id
      where j.duo_id = ${duoId} and j.session_id = ${sessionId}
        and r.duo_id = j.duo_id and r.session_id = j.session_id and r.purpose = j.purpose
      order by j.run_id, j.created_at, j.id
    ),
    unified as (
      select 'run'::text as kind, r.id, r.purpose::text as purpose,
        coalesce(case when r.status = 'finished' then r.finished_at end, r.started_at) as sort_key,
        case when fj.id is not null then fj.status in ('queued', 'running') else r.status = 'open' end as active,
        false as noop
      from processing_runs r
      left join first_job fj on fj.run_id = r.id
      where r.duo_id = ${duoId} and r.session_id = ${sessionId}
        and exists (select 1 from sessions s where s.id = r.session_id and s.duo_id = ${duoId})
      union all
      select 'job'::text, j.id, j.purpose::text,
        coalesce(j.finished_at, j.created_at),
        j.status in ('queued', 'running'),
        (j.status = 'cancelled' and j.error = ${noopMsg})
      from processing_jobs j
      where j.duo_id = ${duoId} and j.session_id = ${sessionId}
        and exists (select 1 from sessions s where s.id = j.session_id and s.duo_id = ${duoId})
        and not exists (
          select 1 from processing_runs r
          where r.id = j.run_id and r.duo_id = j.duo_id and r.session_id = j.session_id and r.purpose = j.purpose
        )
    ),
    ranked as (
      select u.*, row_number() over (partition by u.noop, u.purpose order by u.sort_key desc, u.id desc) as noop_rank
      from unified u
    )`;

  const after = q.cursor
    ? sql`and (sort_key, id) < ((${q.cursor.key}::text)::timestamptz, ${q.cursor.id}::uuid)`
    : sql``;
  const filter = q.noop
    ? sql`noop and purpose = ${q.purpose}`
    : sql`not active and (not noop or noop_rank = 1)${q.purpose ? sql` and purpose = ${q.purpose}` : sql``}`;
  const pageRows = await query<{ kind: string; id: string; sort_key_text: string }>(db, sql`
    ${unified}
    select kind, id, ${SORT_KEY_TEXT(sql`sort_key`)} as sort_key_text
    from ranked
    where ${filter} ${after}
    order by sort_key desc, id desc
    limit ${limit + 1}`);
  const page = pageRows.slice(0, limit);
  const hasMore = pageRows.length > limit;

  const firstPage = q.cursor === null && !q.noop;
  const pinnedRows = firstPage
    ? [
        ...(await query<{ kind: string; id: string }>(db, sql`
          ${unified}
          select kind, id from ranked where active${q.purpose ? sql` and purpose = ${q.purpose}` : sql``}
          order by sort_key desc, id desc`)),
      ]
    : [];

  // No-op groups for the main list's first page; the newest no-op of each purpose is the listed row.
  let noOps: RunTimelineNoOp[] = [];
  if (firstPage) {
    const groups = await query<{ purpose: "extract" | "tips"; n: number; newest_id: string; newest_at: string }>(db, sql`
      ${unified}
      select purpose, count(*)::int as n,
        (array_agg(id order by sort_key desc, id desc))[1] as newest_id,
        ${SORT_KEY_TEXT(sql`max(sort_key)`)} as newest_at
      from ranked where noop group by purpose order by purpose`);
    noOps = groups.map((g) => ({ purpose: g.purpose, count: g.n, newestJobId: g.newest_id, newestAt: g.newest_at }));
  }

  const wanted = [...pinnedRows, ...page];
  const rows = await buildRunRows(db, duoId, wanted);
  // A collapsed no-op row stands for its purpose group (identity: purpose + newest no-op job id).
  if (!q.noop) {
    for (const row of rows) {
      if (row.status !== "cancelled" || row.error !== noopMsg) continue;
      const group = noOps.find((g) => g.purpose === row.purpose);
      row.noOpCount =
        group?.count ??
        Number(
          (
            await query<{ n: number }>(db, sql`${unified} select count(*)::int as n from ranked where noop and purpose = ${row.purpose}`)
          )[0]?.n ?? 1,
        );
    }
  }

  let pinnedRun: RunTimelineRow | null = null;
  if (firstPage && q.runId && !rows.some((r) => r.runId === q.runId)) {
    const [pin] = await db
      .select({ id: processingRuns.id })
      .from(processingRuns)
      .where(and(runInDuo(duoId), eq(processingRuns.sessionId, sessionId), eq(processingRuns.id, q.runId)));
    if (pin) pinnedRun = (await buildRunRows(db, duoId, [{ kind: "run", id: pin.id }]))[0] ?? null;
  }

  const last = page.at(-1);
  return {
    rows,
    nextCursor: hasMore && last ? encodeRunsCursor({ key: last.sort_key_text, id: last.id }) : null,
    pinnedRun,
    noOps,
  };
}

/**
 * Full RunTimelineRow objects for the given run and job ids, in the given order (run-wide counts from the Duo-wide
 * derivation). A job merges into its run only when Duo, Session and purpose agree, under the earliest such job.
 */
export async function buildRunRows(
  db: AppDb,
  duoId: string,
  wanted: Array<{ kind: string; id: string }>,
): Promise<RunTimelineRow[]> {
  if (wanted.length === 0) return [];
  const runIds = wanted.filter((w) => w.kind === "run").map((w) => w.id);
  const jobIds = wanted.filter((w) => w.kind === "job").map((w) => w.id);
  const [runs, jobsOfRuns, jobs, learnings, callLabelHistory] = await Promise.all([
    runIds.length
      ? db.select().from(processingRuns).where(and(runInDuo(duoId), inArray(processingRuns.id, runIds)))
      : Promise.resolve([]),
    runIds.length
      ? db
          .select()
          .from(processingJobs)
          .where(and(jobInDuo(duoId), inArray(processingJobs.runId, runIds)))
          .orderBy(processingJobs.createdAt, processingJobs.id)
      : Promise.resolve([]),
    jobIds.length
      ? db.select().from(processingJobs).where(and(jobInDuo(duoId), inArray(processingJobs.id, jobIds)))
      : Promise.resolve([]),
    deriveLearningsWithStatus(db, duoId),
    deriveCallLabelHistory(db, duoId),
  ]);
  const firstJob = new Map<string, (typeof jobsOfRuns)[number]>();
  for (const j of jobsOfRuns) {
    const run = runs.find((r) => r.id === j.runId);
    if (run && run.purpose === j.purpose && run.sessionId === j.sessionId && !firstJob.has(run.id)) firstJob.set(run.id, j);
  }
  const counts = await outputCounts(db, duoId, runs, learnings, callLabelHistory);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const out: RunTimelineRow[] = [];
  for (const w of wanted) {
    if (w.kind === "run") {
      const run = runById.get(w.id);
      if (run) out.push(runRow(run, firstJob.get(run.id) ?? null, counts));
    } else {
      const job = jobById.get(w.id);
      if (job) out.push(jobRow(job));
    }
  }
  return out;
}
