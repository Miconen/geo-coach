import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { DuoSseEvent } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { processingJobs, recordings } from "../../db/schema.js";
import { duoEventBus } from "../../events/bus.js";
import { addRecording, at, seedSessionFixture, type SessionFixture } from "../../workbench/__tests__/session-fixture.js";
import { enqueueAllRoundTagging, enqueueProcessingJobs } from "../processing-jobs.js";
import { mcpFinishRun, mcpListWork, mcpStartRun } from "../workflow.js";

// #95: Round tagging (clues runs) is queued with extract, and the Clues page backfills it for every Session.
describe("Round tagging jobs (#95)", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle, { tag: "rt" });
  });
  afterEach(async () => handle.close());

  const jobsOf = (purpose: "extract" | "clues", sessionId = f.sessionId) =>
    handle.db.query.processingJobs.findMany({
      where: and(eq(processingJobs.sessionId, sessionId), eq(processingJobs.purpose, purpose)),
      orderBy: [asc(processingJobs.rangeStart)],
    });
  const extract = (sessionId = f.sessionId, start = at("19:00:00"), end = at("19:30:00")) =>
    enqueueProcessingJobs(handle.db, f.mikoId, { duoId: f.duoId, sessionId, purpose: "extract", startUtc: start, endUtc: end });

  /** Tags every clues range of the Session, so clues is up to date there. */
  async function tagAllRounds(sessionId = f.sessionId) {
    const { ranges } = await mcpListWork(handle.db, f.mikoId, { purpose: "clues", duo: f.duoId });
    for (const r of ranges.filter((x) => x.sessionId === sessionId)) {
      const run = await mcpStartRun(handle.db, f.mikoId, { ...r, purpose: "clues", agent: "test", model: "test", duo: f.duoId });
      await mcpFinishRun(handle.db, f.mikoId, run.runId);
    }
  }

  it("queueing extract also queues clues for the overlapping clues ranges, once", async () => {
    const { ranges } = await mcpListWork(handle.db, f.mikoId, { purpose: "clues", duo: f.duoId });
    const cluesRanges = ranges.filter((r) => r.sessionId === f.sessionId);
    expect(cluesRanges.length).toBeGreaterThan(0);

    const first = await extract();
    expect(first).toMatchObject({ queued: 1, alreadyActive: 0, rounds: { queued: cluesRanges.length, alreadyActive: 0 } });
    const clues = await jobsOf("clues");
    expect(clues.map((j) => [j.rangeStart.toISOString(), j.rangeEnd.toISOString()])).toEqual(
      cluesRanges.map((r) => [r.startUtc, r.endUtc]),
    );
    expect(clues.every((j) => j.status === "queued" && j.requestedByPlayerId === f.mikoId)).toBe(true);

    const again = await extract();
    expect(again).toMatchObject({ queued: 0, alreadyActive: 1, rounds: { queued: 0, alreadyActive: cluesRanges.length } });
    expect(await jobsOf("clues")).toHaveLength(cluesRanges.length);
    expect(await jobsOf("extract")).toHaveLength(1);
  });

  it("queues clues only for clues ranges overlapping the queued part", async () => {
    const other = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("21:00:00"), minutes: 30 });
    await extract(other.sessionId, at("21:00:00"), at("21:30:00"));
    expect(await jobsOf("clues", other.sessionId)).toHaveLength(1);
    expect(await jobsOf("clues")).toHaveLength(0);
  });

  it("extract still queues when clues is up to date for the range, and nothing fails", async () => {
    await tagAllRounds();
    const res = await extract();
    expect(res).toMatchObject({ queued: 1, alreadyActive: 0, rounds: { queued: 0, alreadyActive: 0 } });
    expect(await jobsOf("extract")).toHaveLength(1);
    expect(await jobsOf("clues")).toHaveLength(0);
  });

  it("queueing clues or tips queues nothing extra", async () => {
    const res = await enqueueProcessingJobs(handle.db, f.mikoId, {
      duoId: f.duoId,
      sessionId: f.sessionId,
      purpose: "tips",
      startUtc: at("19:00:00"),
      endUtc: at("19:30:00"),
    });
    expect(res).toEqual({ queued: 1, alreadyActive: 0 });
    expect(await jobsOf("clues")).toHaveLength(0);
  });

  describe("the backfill", () => {
    it("queues one job per unprocessed clues range across Sessions, skipping recording Sessions and active jobs", async () => {
      // Session B: clues already up to date. Session C: one range already queued. Session D: still recording.
      const b = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("21:00:00"), minutes: 30 });
      await tagAllRounds(b.sessionId);
      const c = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("22:30:00"), minutes: 30 });
      await enqueueProcessingJobs(handle.db, f.mikoId, {
        duoId: f.duoId,
        sessionId: c.sessionId,
        purpose: "clues",
        startUtc: at("22:30:00"),
        endUtc: at("23:00:00"),
      });
      const d = await addRecording(handle, { duoId: f.duoId, playerId: f.soraId, start: at("00:00:00", "2026-11-21"), minutes: 30 });
      await handle.db.update(recordings).set({ stoppedAt: null }).where(eq(recordings.id, d.recordingId));
      duoEventBus.publish(f.duoId, {
        type: "heartbeat",
        playerId: f.soraId,
        playerName: "Sora",
        recording: true,
        recordingId: d.recordingId,
        uploadOk: true,
        pendingChunks: 0,
        transcriptionLagSec: 0,
        geoguessrAuthOk: true,
        seenAt: new Date().toISOString(),
      });

      const events: DuoSseEvent[] = [];
      const off = duoEventBus.subscribe(f.duoId, (ev) => events.push(ev));
      const res = await enqueueAllRoundTagging(handle.db, f.mikoId, f.duoId);
      off();

      expect(res).toEqual({ queued: 1, alreadyActive: 1, sessions: 1, skippedRecording: 1 });
      expect(await jobsOf("clues")).toHaveLength(1);
      expect(await jobsOf("clues", b.sessionId)).toHaveLength(0);
      expect(await jobsOf("clues", c.sessionId)).toHaveLength(1);
      expect(await jobsOf("clues", d.sessionId)).toHaveLength(0);
      expect(events).toContainEqual(expect.objectContaining({ type: "changed", entity: "processing", id: f.sessionId }));
      expect(events).toContainEqual(expect.objectContaining({ type: "changed", entity: "clue" }));

      // Again: everything is queued already.
      expect(await enqueueAllRoundTagging(handle.db, f.mikoId, f.duoId)).toEqual({
        queued: 0,
        alreadyActive: 2,
        sessions: 0,
        skippedRecording: 1,
      });
    });

    it("is a Duo member's action only", async () => {
      const other = await seedSessionFixture(handle, { tag: "rt2" });
      await expect(enqueueAllRoundTagging(handle.db, other.mikoId, f.duoId)).rejects.toMatchObject({ status: 403 });
    });
  });
});
