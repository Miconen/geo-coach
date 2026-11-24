import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { processingJobs } from "../../db/schema.js";
import { ALREADY_UP_TO_DATE } from "../../mcp/processing-jobs.js";
import { sessionWorkRangeJobs } from "../../workbench/run-timeline.js";
import { at, insertJob, insertRun, seedSessionFixture, type SessionFixture } from "../../workbench/__tests__/session-fixture.js";
import {
  decodeRunsCursor,
  encodeRunsCursor,
  loadSessionPayload,
  loadSessionRunsPage,
  parseRunsQuery,
  type SessionRunsQuery,
} from "../index.js";

// #56 2a(i): GET /sessions/[sessionId]/runs paging (SQL keyset on exact timestamp text) and the Session refresh.

describe("Session run history pages", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;
  const FULL: [Date, Date] = [at("19:00:00"), at("19:30:00")];
  const q = (over: Partial<SessionRunsQuery> = {}): SessionRunsQuery => ({
    cursor: null,
    purpose: null,
    noop: false,
    runId: null,
    ...over,
  });
  const page = (over: Partial<SessionRunsQuery> = {}) => loadSessionRunsPage(handle.db, f.duoId, f.sessionId, q(over));

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
  });
  afterEach(async () => {
    await handle.close();
  });

  it("pages newest first with unfinished rows pinned on page one only, and never skips a row", async () => {
    const finished: string[] = [];
    for (let i = 0; i < 5; i++) {
      finished.push(
        await insertRun(handle, f, {
          range: FULL,
          startedAt: at(`19:3${i}:00`),
          finishedAt: at(`19:3${i}:30`),
        }),
      );
    }
    // Two rows with the exact same key: the id breaks the tie, and microseconds are kept.
    const tieAt = new Date("2026-11-20T19:40:00.123Z");
    const tieA = await insertRun(handle, f, { range: FULL, startedAt: at("19:39:00"), finishedAt: tieAt });
    const tieB = await insertRun(handle, f, { range: FULL, startedAt: at("19:39:00"), finishedAt: tieAt });
    const open = await insertRun(handle, f, { range: FULL, startedAt: at("19:45:00") });
    const queued = await insertJob(handle, f, { range: FULL, status: "queued", createdAt: at("19:46:00") });

    const p1 = await page({ limit: 3 });
    expect(p1.rows.slice(0, 2).map((r) => r.runId ?? r.jobId)).toEqual([queued, open]);
    expect(p1.rows.slice(2).map((r) => r.runId)).toEqual([[tieA, tieB].sort().reverse()[0], [tieA, tieB].sort().reverse()[1], finished[4]]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await page({ limit: 3, cursor: decodeRunsCursor(p1.nextCursor!) });
    expect(p2.rows.every((r) => !r.pinned)).toBe(true);
    expect(p2.rows.map((r) => r.runId)).toEqual([finished[3], finished[2], finished[1]]);
    const p3 = await page({ limit: 3, cursor: decodeRunsCursor(p2.nextCursor!) });
    expect(p3.rows.map((r) => r.runId)).toEqual([finished[0]]);
    expect(p3.nextCursor).toBeNull();
    // The cursor carries exact SQL text, never a JS Date round trip.
    expect(decodeRunsCursor(p1.nextCursor!)!.key).toMatch(/^2026-11-20T19:3[0-9]:30\.000000Z$/);
  });

  it("a finished run stays pinned until its job closes, then moves once to its finished_at key", async () => {
    const older = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:33:00"), finishedAt: at("19:34:00") });
    const job = await insertJob(handle, f, { range: FULL, status: "running", runId: run, createdAt: at("19:32:30") });
    const before = await page();
    expect(before.rows[0]).toMatchObject({ runId: run, pinned: true, jobId: job });
    await handle.db.update(processingJobs).set({ status: "succeeded", finishedAt: at("19:50:00") }).where(eq(processingJobs.id, job));
    const after = await page();
    expect(after.rows.map((r) => [r.runId, r.pinned])).toEqual([
      [run, false],
      [older, false],
    ]);
    // Its key is finished_at (19:34), not the job's close (19:50): an older-keyed row can follow it.
    expect(after.rows[0]!.finishedAt).toBe(at("19:34:00").toISOString());
  });

  it("an abandoned run keeps finished_at null and sorts by started_at, like a jobless finish", async () => {
    const a = await insertRun(handle, f, { range: FULL, startedAt: at("19:40:00"), status: "abandoned" });
    const b = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:45:00") });
    const rows = (await page()).rows;
    expect(rows.map((r) => r.runId)).toEqual([b, a]);
    expect(rows[1]).toMatchObject({ status: "abandoned", finishedAt: null, pinned: false });
  });

  it("collapses no-op jobs to one row per purpose before LIMIT, listable with ?purpose=&noop=1", async () => {
    const noops: string[] = [];
    for (let i = 0; i < 4; i++) {
      noops.push(
        await insertJob(handle, f, {
          range: FULL,
          status: "cancelled",
          error: ALREADY_UP_TO_DATE,
          createdAt: at(`19:4${i}:00`),
          finishedAt: at(`19:4${i}:01`),
        }),
      );
    }
    const run = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const main = await page({ limit: 2 });
    expect(main.rows.map((r) => r.jobId ?? r.runId)).toEqual([noops[3], run]);
    expect(main.rows[0]!.noOpCount).toBe(4);
    expect(main.noOps).toEqual([expect.objectContaining({ purpose: "extract", count: 4, newestJobId: noops[3] })]);
    expect(main.nextCursor).toBeNull();
    const listed = await page({ purpose: "extract", noop: true, limit: 3 });
    expect(listed.rows.map((r) => r.jobId)).toEqual([noops[3], noops[2], noops[1]]);
    const rest = await page({ purpose: "extract", noop: true, limit: 3, cursor: decodeRunsCursor(listed.nextCursor!) });
    expect(rest.rows.map((r) => r.jobId)).toEqual([noops[0]]);
  });

  it("returns a valid pinned run off page one as pinnedRun, and drops a foreign one", async () => {
    const runs: string[] = [];
    for (let i = 0; i < 4; i++) {
      runs.push(await insertRun(handle, f, { range: FULL, startedAt: at(`19:3${i}:00`), finishedAt: at(`19:3${i}:30`) }));
    }
    const p = await page({ limit: 2, runId: runs[0]! });
    expect(p.rows.map((r) => r.runId)).toEqual([runs[3], runs[2]]);
    expect(p.pinnedRun?.runId).toBe(runs[0]);
    const cursorBefore = p.nextCursor;
    expect((await page({ limit: 2 })).nextCursor).toBe(cursorBefore);
    expect((await page({ runId: uuidv7() })).pinnedRun).toBeNull();

    // The Session refresh returns page one plus the optional pinnedRun.
    const payload = await loadSessionPayload(handle.db, f.duoId, f.mikoId, f.sessionId, runs[0]!);
    expect(payload?.runs.rows.map((r) => r.runId)).toContain(runs[0]);
    const foreign = await loadSessionPayload(handle.db, f.duoId, f.mikoId, f.sessionId, uuidv7());
    expect(foreign?.runs.pinnedRun).toBeNull();
    expect(await loadSessionPayload(handle.db, uuidv7(), f.mikoId, f.sessionId, null)).toBeNull();
  });

  it("validates cursors, purpose and noop before any query", () => {
    const bad = (s: string) => "error" in parseRunsQuery(new URLSearchParams(s));
    const good = encodeRunsCursor({ key: "2026-11-20T19:30:00.123456Z", id: uuidv7() });
    expect(bad(`cursor=${good}`)).toBe(false);
    for (const key of [
      "2026-02-30T19:30:00.000000Z",
      "2026-13-01T19:30:00.000000Z",
      "0000-01-01T00:00:00.000000Z",
      "2026-11-20T24:00:00.000000Z",
      "2026-11-20T19:60:00.000000Z",
      "2026-11-20T19:30:00Z",
      "2026-11-20 19:30:00.000000+00",
    ]) {
      expect(bad(`cursor=${encodeRunsCursor({ key, id: uuidv7() })}`), key).toBe(true);
    }
    expect(bad(`cursor=${encodeRunsCursor({ key: "2026-11-20T19:30:00.000000Z", id: "nope" })}`)).toBe(true);
    expect(bad("cursor=%%%")).toBe(true);
    expect(bad("cursor=bm90LWpzb24")).toBe(true);
    expect(bad("purpose=nope")).toBe(true);
    expect(bad("noop=1")).toBe(true);
    expect(bad("noop=yes&purpose=extract")).toBe(true);
    expect(bad("noop=1&purpose=extract")).toBe(false);
    // ?run= is a pin: dropped, never an error.
    expect(parseRunsQuery(new URLSearchParams("run=nope"))).toMatchObject({ runId: null });
  });

  it("work range jobs see a queued job outside the visible page", async () => {
    for (let i = 0; i < 3; i++) {
      await insertRun(handle, f, { range: FULL, startedAt: at(`19:3${i}:00`), finishedAt: at(`19:3${i}:30`) });
    }
    await insertJob(handle, f, { range: FULL, status: "queued", createdAt: at("19:00:30") });
    const visible = await page({ limit: 1 });
    expect(visible.rows.some((r) => r.status === "queued")).toBe(true);
    const jobs = await sessionWorkRangeJobs(handle.db, f.duoId, f.sessionId, [
      { purpose: "extract", startUtc: FULL[0].toISOString(), endUtc: FULL[1].toISOString() },
    ]);
    expect(Object.values(jobs)[0]).toMatchObject({ queued: 1 });
  });
});
