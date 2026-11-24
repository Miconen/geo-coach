import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7, type DuoSseEvent } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimEvidence, claims, processingJobs, sessions } from "../../db/schema.js";
import { createManualLearning, deriveLearningsWithStatus, insertRunCallLabels } from "../../services/index.js";
import { ALREADY_UP_TO_DATE, claimNextProcessingJob } from "../../mcp/processing-jobs.js";
import { duoEventBus } from "../../events/bus.js";
import { buildWorkbenchData } from "../view-model.js";
import { RUN_TIMELINE_LIMIT, type RunTimelineRow } from "../run-timeline.js";
import {
  addLearnings,
  addRecording,
  at,
  insertJob,
  insertRun,
  seedSessionFixture,
  type SessionFixture,
} from "./session-fixture.js";

describe("run history in the existing pane (#56 0b)", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
  });

  afterEach(async () => {
    await handle.close();
  });

  const wb = (options: { sessionId?: string | null; runId?: string | null } = {}) =>
    buildWorkbenchData(handle.db, f.duoId, f.mikoId, options);
  const rowOf = (rows: RunTimelineRow[], runId: string) => rows.find((r) => r.runId === runId)!;
  const FULL: [Date, Date] = [at("19:00:00"), at("19:30:00")];

  it("counts three runs with a zero-output superseder, cold and after an event", async () => {
    const run1 = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const [l1, l2] = await addLearnings(handle, f, run1, [
      { text: "Split Spain and Portugal", u: [f.u[0]!, f.u[1]!] },
      { text: "Toledo has dry hills", u: [f.u[3]!, f.u[4]!] },
    ]);
    const run2 = await insertRun(handle, f, {
      range: [at("19:00:00"), at("19:01:30")],
      startedAt: at("19:39:00"),
      finishedAt: at("19:40:00"),
    });
    const [l3] = await addLearnings(handle, f, run2, [{ text: "Split again", u: [f.u[0]!] }]);
    // Two disjoint superseders: run2 covers l1, run3 (no output) covers l2.
    const run3 = await insertRun(handle, f, {
      range: [at("19:02:00"), at("19:02:30")],
      startedAt: at("19:44:00"),
      finishedAt: at("19:45:00"),
    });

    const check = async () => {
      const data = await wb();
      const t = data.runTimeline!;
      expect(t.sessionId).toBe(f.sessionId);
      const finishedRows = t.rows.filter((r) => r.status === "finished").map((r) => r.runId);
      expect(finishedRows).toEqual([run3, run2, run1]);
      expect(rowOf(t.rows, run1).learnings).toEqual({ current: 0, surviving: 2 });
      expect(rowOf(t.rows, run1).supersededBy).toEqual(
        expect.arrayContaining([
          { runId: run2, displaced: 1, replacementOutputs: 1 },
          { runId: run3, displaced: 1, replacementOutputs: 0 },
        ]),
      );
      expect(rowOf(t.rows, run2).learnings).toEqual({ current: 1, surviving: 1 });
      expect(rowOf(t.rows, run3).learnings).toEqual({ current: 0, surviving: 0 });
      // Inspector links follow supersededByRunId through span overlap only.
      const byId = new Map(data.learnings.map((l) => [l.id, l]));
      expect(byId.get(l1!)!.supersededByLearningIds).toEqual([l3]);
      expect(byId.get(l3!)!.supersedesLearningIds).toEqual([l1]);
      expect(byId.get(l2!)!.supersededByLearningIds).toEqual([]);
      return data;
    };
    await check();

    // A simulated 'run' event: an external agent opens a fourth run; the refreshed payload pins it on top.
    const run4 = await insertRun(handle, f, { range: FULL, startedAt: at("19:50:00") });
    const after = await check();
    expect(after.runTimeline!.rows[0]).toMatchObject({ runId: run4, status: "open", pinned: true, draft: true });
  });

  it("maps job-only rows and collapses no-op jobs before the cap", async () => {
    const r: [Date, Date] = [at("19:00:00"), at("19:05:00")];
    await insertJob(handle, f, { range: r, status: "failed", error: "Model crashed", createdAt: at("19:50:00"), finishedAt: at("19:51:00") });
    await insertJob(handle, f, { range: r, status: "cancelled", error: ALREADY_UP_TO_DATE, createdAt: at("19:52:00"), finishedAt: at("19:52:01") });
    await insertJob(handle, f, { range: r, status: "cancelled", error: ALREADY_UP_TO_DATE, createdAt: at("19:53:00"), finishedAt: at("19:53:01") });
    await insertJob(handle, f, { range: r, status: "cancelled", error: "Stopped by the worker", createdAt: at("19:54:00"), finishedAt: at("19:54:01") });
    await insertJob(handle, f, { range: r, status: "succeeded", createdAt: at("19:55:00"), finishedAt: at("19:56:00") });
    await insertJob(handle, f, { range: r, status: "running", createdAt: at("19:57:00") });
    await insertJob(handle, f, { range: r, status: "queued", createdAt: at("19:58:00") });

    const t = (await wb()).runTimeline!;
    expect(t.rows.map((x) => [x.status, x.pinned])).toEqual([
      ["queued", true],
      ["starting", true],
      ["run-removed", false],
      ["cancelled", false],
      ["failed", false],
    ]);
    expect(t.rows.find((x) => x.status === "failed")!.error).toBe("Model crashed");
    expect(t.noOps).toEqual([expect.objectContaining({ purpose: "extract", count: 2 })]);
  });

  it("merges a job and run only when they agree, and shows a duplicate attachment once", async () => {
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    // A tips job pointing at an extract run does not merge: the job shows run-less, the run jobless.
    const mismatched = await insertJob(handle, f, {
      purpose: "tips",
      range: FULL,
      status: "succeeded",
      runId: run,
      createdAt: at("19:30:30"),
      finishedAt: at("19:33:00"),
    });
    const run2 = await insertRun(handle, f, { range: FULL, startedAt: at("19:41:00"), finishedAt: at("19:42:00") });
    const first = await insertJob(handle, f, { range: FULL, status: "succeeded", runId: run2, createdAt: at("19:40:00"), finishedAt: at("19:43:00") });
    await insertJob(handle, f, { range: FULL, status: "succeeded", runId: run2, createdAt: at("19:40:30"), finishedAt: at("19:43:00") });

    const t = (await wb()).runTimeline!;
    expect(t.rows.filter((r) => r.runId === run2)).toHaveLength(1);
    expect(rowOf(t.rows, run2).jobId).toBe(first);
    expect(rowOf(t.rows, run).jobId).toBeNull();
    expect(t.rows.find((r) => r.jobId === mismatched)).toMatchObject({ runId: null, status: "run-removed" });
    expect(t.rows).toHaveLength(3);
  });

  it("keeps a finished run pinned until its job closes", async () => {
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const job = await insertJob(handle, f, { range: FULL, status: "running", runId: run, createdAt: at("19:30:30") });
    await insertRun(handle, f, { range: FULL, startedAt: at("19:41:00"), finishedAt: at("19:42:00") });
    let t = (await wb()).runTimeline!;
    expect(t.rows[0]).toMatchObject({ runId: run, pinned: true, status: "finished" });
    await handle.db.update(processingJobs).set({ status: "succeeded", finishedAt: at("19:33:00") }).where(eq(processingJobs.id, job));
    t = (await wb()).runTimeline!;
    expect(rowOf(t.rows, run).pinned).toBe(false);
    expect(t.rows[1]!.runId).toBe(run);
  });

  it("counts Claims by run and never counts mismatched Evidence or another Duo's Claim", async () => {
    const other = await seedSessionFixture(handle, { tag: "other", teamId: "team_other" });
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const created = uuidv7();
    const existing = uuidv7();
    const viaForeignRound = uuidv7();
    const foreignClaim = uuidv7();
    await handle.db.insert(claims).values([
      { id: created, duoId: f.duoId, runId: run, text: "Created by the run" },
      { id: existing, duoId: f.duoId, runId: null, text: "Older Claim" },
      { id: viaForeignRound, duoId: f.duoId, runId: null, text: "Evidence on a foreign Round" },
      { id: foreignClaim, duoId: other.duoId, runId: run, text: "Another Duo's Claim" },
    ]);
    await handle.db.insert(claimEvidence).values([
      { id: uuidv7(), claimId: created, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[0], runId: run },
      { id: uuidv7(), claimId: existing, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[1], runId: run },
      { id: uuidv7(), claimId: viaForeignRound, duoId: f.duoId, kind: "round", direction: "for", roundId: other.roundIds[0], runId: run },
    ]);
    // An abandoned run keeps its Claims, labelled draft.
    const abandoned = await insertRun(handle, f, { range: FULL, startedAt: at("19:41:00"), status: "abandoned" });
    await handle.db.insert(claims).values({ id: uuidv7(), duoId: f.duoId, runId: abandoned, text: "Draft Claim" });

    const t = (await wb()).runTimeline!;
    expect(rowOf(t.rows, run)).toMatchObject({ claimsCreated: 1, claimsWithNewEvidence: 1 });
    expect(rowOf(t.rows, abandoned)).toMatchObject({ status: "abandoned", draft: true, claimsCreated: 1 });
  });

  it("drops a run whose Session moved to another Duo, everywhere, but keeps Manual Learnings", async () => {
    const other = await seedSessionFixture(handle, { tag: "moved", teamId: "team_moved" });
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const [fromRun] = await addLearnings(handle, f, run, [{ text: "From a moved run", u: [f.u[0]!] }]);
    const manual = await createManualLearning(handle.db, f.mikoId, {
      duoId: f.duoId,
      kind: "other",
      text: "Manual note",
      countries: [],
      regions: [],
      topics: [],
      utteranceIds: [f.u[6]!.id],
      roundIds: [],
    });
    await handle.pglite.query(`update processing_runs set session_id = $1 where id = $2`, [other.sessionId, run]);
    const data = await wb();
    expect(data.runTimeline!.rows.find((r) => r.runId === run)).toBeUndefined();
    expect(data.learnings.map((l) => l.id)).not.toContain(fromRun);
    expect(data.learnings.map((l) => l.id)).toContain(manual);
  });

  it("counts cited Manual Learnings attributed to the Session in one Manual row", async () => {
    const base = { duoId: f.duoId, kind: "other" as const, countries: [], regions: [], topics: [] };
    await createManualLearning(handle.db, f.mikoId, { ...base, text: "Speech", utteranceIds: [f.u[6]!.id], roundIds: [] });
    // Round-only keeps today's attribution: the Round's Game's first Session.
    await createManualLearning(handle.db, f.mikoId, { ...base, text: "Round", utteranceIds: [], roundIds: [f.roundIds[0]!] });
    await createManualLearning(handle.db, f.mikoId, { ...base, text: "Uncited", utteranceIds: [], roundIds: [] });
    expect((await wb()).runTimeline!.manualCurrent).toBe(2);
  });

  it("resolves a ?run= pin outside the 50-row cap, and drops a foreign or malformed one", async () => {
    const old = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    for (let i = 0; i < RUN_TIMELINE_LIMIT + 5; i++) {
      const t0 = new Date(at("20:00:00").getTime() + i * 60_000);
      await insertJob(handle, f, { range: FULL, status: "failed", error: "x", createdAt: t0, finishedAt: t0 });
    }
    let t = (await wb({ runId: old })).runTimeline!;
    expect(t.rows).toHaveLength(RUN_TIMELINE_LIMIT);
    expect(t.rows.some((r) => r.runId === old)).toBe(false);
    expect(t.pinnedRun?.runId).toBe(old);
    expect(t.selectedRunId).toBe(old);

    // A run of another Session than the pinned ?sessionId= is foreign: dropped, "no longer exists".
    const s2 = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("21:00:00"), minutes: 10 });
    const run2 = await insertRun(handle, { ...f, sessionId: s2.sessionId }, { range: [at("21:00:00"), at("21:10:00")], startedAt: at("21:11:00"), finishedAt: at("21:12:00") });
    t = (await wb({ sessionId: f.sessionId, runId: run2 })).runTimeline!;
    expect(t).toMatchObject({ sessionId: f.sessionId, pinMissing: true, selectedRunId: null, pinnedRun: null });
    t = (await wb({ runId: "not-a-uuid" })).runTimeline!;
    expect(t.pinMissing).toBe(true);
    // Without a pinned Session, ?run= selects its own Session.
    const data = await wb({ runId: run2 });
    expect(data.selectedSession).toMatchObject({ id: s2.sessionId, recordingLess: false });
    expect(data.runTimeline!.rows[0]!.runId).toBe(run2);
  });

  it("keeps a Recording-less Session selected from ?run=", async () => {
    const bare = uuidv7();
    await handle.db.insert(sessions).values({ id: bare, duoId: f.duoId });
    const run = await insertRun(handle, { ...f, sessionId: bare }, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const data = await wb({ runId: run });
    expect(data.selectedSession).toMatchObject({ id: bare, recordingLess: true });
    expect(data.sessions.some((s) => s.id === bare)).toBe(false);
    expect(data.runTimeline).toMatchObject({ sessionId: bare, selectedRunId: run });
  });

  it("maps finishedAt to null unless the run finished", async () => {
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00"), status: "abandoned" });
    await addLearnings(handle, f, run, [{ text: "Draft", u: [f.u[0]!] }]);
    const derived = await deriveLearningsWithStatus(handle.db, f.duoId);
    expect(derived[0]!.runMeta!.finishedAt).toBeNull();
    expect(rowOf((await wb()).runTimeline!.rows, run)).toMatchObject({ finishedAt: null, draft: true, sortAt: at("19:31:00").toISOString() });
  });

  it("never resurrects an older failure after a newer success, and shows a newer failure", async () => {
    let data = await wb();
    const wr = data.sessions.find((s) => s.id === f.sessionId)!.workRanges.find((w) => w.purpose === "extract")!;
    const key = `${f.sessionId}:extract:${wr.startUtc}`;
    const chunk: [Date, Date] = [new Date(wr.startUtc), new Date(wr.endUtc)];
    await insertJob(handle, f, { range: chunk, status: "failed", error: "old failure", createdAt: at("19:40:00"), finishedAt: at("19:40:30") });
    await insertJob(handle, f, { range: chunk, status: "cancelled", error: "Stopped", createdAt: at("19:41:00"), finishedAt: at("19:41:30") });
    data = await wb();
    expect(data.processing.rangeJobs[key]).toEqual({ running: 0, queued: 0, failed: null });
    await insertJob(handle, f, { range: chunk, status: "failed", error: "new failure", createdAt: at("19:42:00"), finishedAt: at("19:42:30") });
    data = await wb();
    expect(data.processing.rangeJobs[key]!.failed).toBe("new failure");
  });

  it("keeps per-Session Call-label history: another Session's later run never supersedes it", async () => {
    const s2 = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("21:00:00"), minutes: 10 });
    const f2 = { ...f, sessionId: s2.sessionId };
    const game1: [Date, Date] = [at("19:00:00"), at("19:05:00")];
    const c1 = await insertRun(handle, f, { purpose: "calls", range: game1, startedAt: at("19:39:00"), finishedAt: at("19:40:00") });
    await insertRunCallLabels(handle.db, c1, f.duoId, [{ roundId: f.roundIds[0]!, called: true, note: null, utteranceIds: [] }]);
    const c2 = await insertRun(handle, f2, { purpose: "calls", range: game1, startedAt: at("21:39:00"), finishedAt: at("21:40:00") });
    await insertRunCallLabels(handle.db, c2, f.duoId, [{ roundId: f.roundIds[0]!, called: false, note: null, utteranceIds: [] }]);
    const c3 = await insertRun(handle, f2, { purpose: "calls", range: game1, startedAt: at("21:49:00"), finishedAt: at("21:50:00") });

    const t1 = (await wb({ sessionId: f.sessionId })).runTimeline!;
    expect(rowOf(t1.rows, c1).callLabels).toEqual({ current: 1, surviving: 1 });
    const t2 = (await wb({ sessionId: s2.sessionId })).runTimeline!;
    expect(rowOf(t2.rows, c2).callLabels).toEqual({ current: 0, surviving: 1 });
    expect(rowOf(t2.rows, c2).supersededBy).toEqual([{ runId: c3, displaced: 1, replacementOutputs: 0 }]);
    expect(rowOf(t2.rows, c2).learnings).toBeNull();
  });

  it("never shows or counts a job whose Session belongs to another Duo", async () => {
    const other = await seedSessionFixture(handle, { tag: "jobs", teamId: "team_jobs" });
    const job = await insertJob(handle, f, { range: FULL, status: "failed", error: "x", createdAt: at("19:50:00"), finishedAt: at("19:50:00") });
    await handle.pglite.query(`update processing_jobs set session_id = $1 where id = $2`, [other.sessionId, job]);
    const t = (await wb()).runTimeline!;
    expect(t.rows.some((r) => r.jobId === job)).toBe(false);
  });

  it("emits 'processing' as soon as the worker claims a job, before its run exists", async () => {
    const events: DuoSseEvent[] = [];
    const stop = duoEventBus.subscribe(f.duoId, (e) => {
      events.push(e);
    });
    const data = await wb();
    const wr = data.sessions[0]!.workRanges.find((w) => w.purpose === "extract")!;
    await insertJob(handle, f, { range: [new Date(wr.startUtc), new Date(wr.endUtc)], status: "queued", createdAt: at("19:40:00") });
    const claimed = await claimNextProcessingJob(handle.db, "test-model");
    stop();
    expect(claimed).not.toBeNull();
    const processing = events.filter((e) => e.type === "changed" && e.entity === "processing");
    expect(processing.length).toBeGreaterThanOrEqual(2);
  });
});
