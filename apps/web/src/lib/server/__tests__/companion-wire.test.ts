import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7, type DuoSseEvent } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../db/test-db.js";
import { duoMemberships, duos, players, recordings } from "../db/schema.js";
import { issueApiToken } from "../auth/index.js";
import { duoEventBus } from "../events/bus.js";
import { handleCompanionRequest, type CompanionEndpoint } from "../companion-api/handler.js";
import { at, rawDuel, seedSessionFixture } from "../workbench/__tests__/session-fixture.js";
import { enqueueProcessingJobs } from "../mcp/processing-jobs.js";

// #56 2a(i): Companion write paths change only by added events. Each handler projects exactly the fields it
// returned before (wire-payload test), for v1 and headerless requests, and each producer emits X5's event shape.

const T0 = Date.parse("2026-11-20T19:00:00.000Z");

describe.each([
  ["v1 header", "1"],
  ["headerless", null],
] as const)("Companion wire payloads (%s)", (_label, version) => {
  let handle: TestDbHandle;
  let duoId: string;
  let playerId: string;
  let token: string;
  let events: DuoSseEvent[];
  let unsub: () => void;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    playerId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "D", geoguessrTeamId: "team_w" });
    await handle.db.insert(players).values({ id: playerId, discordId: "w", displayName: "W", geoguessrUserId: "gg_f1_w" });
    await handle.db.insert(duoMemberships).values({ duoId, playerId });
    token = (await issueApiToken(handle.db, playerId, "companion", "PC", 30)).rawToken;
    events = [];
    unsub = duoEventBus.subscribe(duoId, (e) => events.push(e));
  });
  afterEach(async () => {
    unsub();
    await handle.close();
  });

  async function call(endpoint: CompanionEndpoint, body: unknown, params: Record<string, string> = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (version) headers["X-GeoCoach-Api-Version"] = version;
    const res = await handleCompanionRequest(
      handle.db,
      new Request(`http://localhost/api/companion/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) }),
      endpoint,
      params,
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  const changed = () => events.filter((e): e is Extract<DuoSseEvent, { type: "changed" }> => e.type === "changed");
  const last = () => changed().at(-1)!;

  it("keeps every response's fields and emits one event per producer", async () => {
    const recordingId = uuidv7();
    const tvId = uuidv7();
    const start = await call("startRecording", {
      recordingId,
      transcriptVersionId: tvId,
      duoId,
      startedAt: new Date(T0).toISOString(),
      clockAnchorMs: T0,
      companionVersion: "0.1.0",
      model: "large-v3",
    });
    expect(start.status).toBe(201);
    expect(keys(start.body)).toEqual(["recordingId", "sessionId", "transcriptVersionId"]);
    const sessionId = start.body.sessionId as string;
    expect(last()).toMatchObject({ entity: "session", id: sessionId, sessionId, recordingId, kind: "bounds" });

    const offset = await call(
      "addOffset",
      { measuredAt: new Date(T0 + 1000).toISOString(), pcTimeMs: T0 + 1000, offsetMs: 5, rttMs: 10 },
      { id: recordingId },
    );
    expect(keys(offset.body)).toEqual(["effectiveOffsetMs", "isCalibrated"]);
    expect(last()).toMatchObject({ entity: "session", sessionId, recordingId, kind: "offset" });

    const chunk = { recordingId, chunkNo: 0, utterances: [{ text: "hi", startSampleMs: 0, endSampleMs: 900, words: [] }] };
    const up = await call("uploadChunk", chunk, { versionId: tvId });
    expect(keys(up.body)).toEqual(["duplicate", "highestContiguousChunkNo", "utteranceCount"]);
    expect(last()).toMatchObject({ entity: "session", sessionId, recordingId, kind: "chunk" });
    const before = changed().length;
    const dup = await call("uploadChunk", chunk, { versionId: tvId });
    expect(dup.body.duplicate).toBe(true);
    expect(keys(dup.body)).toEqual(["duplicate", "highestContiguousChunkNo", "utteranceCount"]);
    expect(changed().length).toBe(before);

    const done = await call("completeTranscript", { totalChunks: 1 }, { versionId: tvId });
    expect(keys(done.body)).toEqual(["duoId", "recordingId", "transcriptVersionId"]);
    expect(last()).toMatchObject({ entity: "session", id: recordingId, sessionId, recordingId, kind: "transcript" });

    const retx = await call("startRetranscription", { transcriptVersionId: uuidv7(), recordingId, model: "large-v3" });
    expect(retx.status).toBe(201);
    expect(keys(retx.body)).toEqual(["recordingId", "transcriptVersionId"]);
    expect(last()).toMatchObject({ entity: "session", sessionId, recordingId, kind: "transcript" });

    const stop = await call(
      "stopRecording",
      { stoppedAt: new Date(T0 + 60_000).toISOString(), stopReason: "stop" },
      { id: recordingId },
    );
    expect(keys(stop.body)).toEqual(["recordingId", "sessionId"]);
    expect(last()).toMatchObject({ entity: "session", sessionId, recordingId, kind: "bounds" });

    const game = await call("uploadGame", {
      duoId,
      geoguessrGameId: "w_duel",
      fetchedAt: "2026-11-20T19:20:00.000Z",
      rawDuel: rawDuel("w_duel", "team_w", ["19:01:00", "19:02:00", "19:03:00"]),
    });
    expect(keys(game.body)).toEqual(["created", "gameId", "roundCount"]);
    expect(last()).toMatchObject({ entity: "game", id: game.body.gameId });

    const replay = await call("uploadReplay", {
      duoId,
      geoguessrGameId: "w_duel",
      geoguessrPlayerId: "gg_f1_w",
      roundNumber: 1,
      fetchedAt: "2026-11-20T19:21:00.000Z",
      rawEvents: [],
    });
    expect(keys(replay.body)).toEqual(["hasEvents", "replayId"]);
    expect(last()).toMatchObject({ entity: "replay", id: game.body.gameId });
  });
});

describe("committed stop beats a cached heartbeat", () => {
  let handle: TestDbHandle;
  afterEach(async () => {
    await handle?.close();
  });

  it("a stale recording:true heartbeat after stopRecording does not block processing", async () => {
    handle = await createTestDb();
    const f = await seedSessionFixture(handle, { tag: "stop" });
    const enqueue = () =>
      enqueueProcessingJobs(handle.db, f.mikoId, {
        duoId: f.duoId,
        sessionId: f.sessionId,
        purpose: "extract",
        startUtc: at("19:00:00"),
        endUtc: at("19:30:00"),
      });
    // Still recording: no committed stop yet.
    await handle.db.update(recordings).set({ stoppedAt: null }).where(eq(recordings.id, f.recordingId));
    // The Companion's last heartbeat says recording (cached up to 90 s).
    duoEventBus.publish(f.duoId, {
      type: "heartbeat",
      playerId: f.mikoId,
      playerName: "Miko",
      recording: true,
      recordingId: f.recordingId,
      uploadOk: true,
      pendingChunks: 0,
      transcriptionLagSec: 0,
      geoguessrAuthOk: true,
      seenAt: new Date().toISOString(),
    });
    await expect(enqueue()).rejects.toMatchObject({ code: "RECORDING_IN_PROGRESS" });
    // stopRecording commits; the stale heartbeat no longer counts.
    await handle.db.update(recordings).set({ stoppedAt: at("19:30:00") }).where(eq(recordings.id, f.recordingId));
    await expect(enqueue()).resolves.toMatchObject({ queued: expect.any(Number) });
  });
});
