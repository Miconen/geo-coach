import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanionStore } from "../store.js";
import { PriorityTranscriptionQueue } from "../queue.js";
import { OutboxUploader, computeBackoffMs } from "../uploader.js";
import { GeoguessrPoller } from "../geoguessr.js";
import { SilenceWatcher } from "../silence.js";
import { TranscriptJobTracker } from "../jobs.js";
import { recoverUnfinishedRecordings } from "../recovery.js";

describe("Seam 5: Companion SQLite outbox, priority queue, silence auto-stop, and GeoGuessr poller", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "geo-coach-cmp-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists outbox across restarts, refills gaps from highestContiguousChunkNo, and caps backoff at 5 min", async () => {
    const dbPath = path.join(tmpDir, "companion.sqlite");
    const store1 = new CompanionStore(dbPath);
    store1.enqueueOutbox("chunk", "tv1:0", {
      transcriptVersionId: "tv1",
      recordingId: "rec1",
      chunkNo: 0,
      utterances: [{ text: "first", startSampleMs: 0, endSampleMs: 1000, words: [] }],
    });
    store1.enqueueOutbox("chunk", "tv1:1", {
      transcriptVersionId: "tv1",
      recordingId: "rec1",
      chunkNo: 1,
      utterances: [{ text: "second", startSampleMs: 1000, endSampleMs: 2000, words: [] }],
    });
    store1.close();

    // Reopen after simulated restart
    const store2 = new CompanionStore(dbPath);
    expect(store2.listPendingOutbox()).toHaveLength(2);

    const sentChunks: number[] = [];
    let gapSimulated = false;
    const uploader = new OutboxUploader(store2, async (item) => {
      const payload = JSON.parse(item.payloadJson);
      sentChunks.push(payload.chunkNo);
      if (payload.chunkNo === 1 && !gapSimulated) {
        gapSimulated = true;
        // Server says it only has contiguous up to -1 (chunk 0 missing!) -> triggers refill of chunk 0
        return { ok: true, highestContiguousChunkNo: -1 };
      }
      return { ok: true, highestContiguousChunkNo: payload.chunkNo };
    });

    await uploader.drainOnce();
    expect(sentChunks).toEqual([0, 1]);
    // Gap refill re-queued chunk 0
    expect(store2.listPendingOutbox().map((i) => i.dedupeKey)).toEqual(["tv1:0"]);
    await uploader.drainOnce();
    expect(store2.listPendingOutbox()).toHaveLength(0);
    store2.close();

    // Backoff caps at 5 min (300_000 ms)
    expect(computeBackoffMs(1)).toBeLessThan(computeBackoffMs(5));
    expect(computeBackoffMs(20)).toBe(300_000);
  });

  it("runs live chunks strictly ahead of re-transcription and pauses re-transcription while recording is live", async () => {
    const order: string[] = [];
    const queue = new PriorityTranscriptionQueue(async (job) => {
      order.push(`${job.priority}:${job.id}`);
    });

    queue.setLiveRecordingActive(true);
    queue.enqueue({ id: "retrans-1", priority: "retranscribe", pcmPath: "a", chunkNo: 0, recordingId: "r0", transcriptVersionId: "tv0", hotwords: [], offsetMs: 0 });
    queue.enqueue({ id: "live-1", priority: "live", pcmPath: "b", chunkNo: 0, recordingId: "r1", transcriptVersionId: "tv1", hotwords: [], offsetMs: 0 });
    queue.enqueue({ id: "live-2", priority: "live", pcmPath: "c", chunkNo: 1, recordingId: "r1", transcriptVersionId: "tv1", hotwords: [], offsetMs: 0 });

    await queue.drainAvailable();
    // Re-transcription must NOT run while live recording is active
    expect(order).toEqual(["live:live-1", "live:live-2"]);

    queue.setLiveRecordingActive(false);
    await queue.drainAvailable();
    expect(order).toEqual(["live:live-1", "live:live-2", "retranscribe:retrans-1"]);
  });

  it("keeps a failed transcription job at the front of the queue and retries it on the next drain", async () => {
    const order: string[] = [];
    let transcriberUp = false;
    const queue = new PriorityTranscriptionQueue(async (job) => {
      if (!transcriberUp) throw new TypeError("fetch failed");
      order.push(job.id);
    });
    queue.enqueue({ id: "live-1", priority: "live", pcmPath: "a", chunkNo: 0, recordingId: "r1", transcriptVersionId: "tv1", hotwords: [], offsetMs: 0 });
    queue.enqueue({ id: "live-2", priority: "live", pcmPath: "b", chunkNo: 1, recordingId: "r1", transcriptVersionId: "tv1", hotwords: [], offsetMs: 0 });

    await expect(queue.drainAvailable()).resolves.toBe(0);
    expect(queue.getDepth().live).toBe(2);

    transcriberUp = true;
    await queue.drainAvailable();
    expect(order).toEqual(["live-1", "live-2"]);
  });

  it("reports each Recording as recording, transcribing, uploading, then done", () => {
    const store = new CompanionStore(path.join(tmpDir, "companion.sqlite"));
    const jobs = new TranscriptJobTracker();
    const pendingUploads = (tv: string) => store.countPendingOutboxForTranscript(tv);

    expect(jobs.statusOf("rec1", { isActive: false, pendingUploads })).toBeNull();

    jobs.chunkQueued("tv1", "rec1", "live");
    jobs.chunkQueued("tv1", "rec1", "live");
    jobs.chunkDone("tv1");
    expect(jobs.statusOf("rec1", { isActive: true, pendingUploads })).toEqual({
      state: "recording",
      chunksQueued: 2,
      chunksDone: 1,
      error: null,
    });

    jobs.chunkFailed("tv1", new TypeError("fetch failed"));
    expect(jobs.statusOf("rec1", { isActive: false, pendingUploads })).toMatchObject({
      state: "transcribing",
      chunksDone: 1,
      error: "fetch failed",
    });
    expect(jobs.isBusy()).toBe(true);

    jobs.chunkDone("tv1");
    store.enqueueOutbox("chunk", "tv1:1", { chunkNo: 1 });
    store.enqueueOutbox("completeTranscript", "complete:tv1", {});
    store.enqueueOutbox("chunk", "tv10:0", { chunkNo: 0 }); // another version, not counted
    expect(jobs.statusOf("rec1", { isActive: false, pendingUploads })).toEqual({
      state: "uploading",
      kind: "live",
      pendingUploads: 2,
    });

    for (const item of store.listPendingOutbox(Date.now())) {
      if (item.dedupeKey !== "tv10:0") store.markOutboxSent(item.id);
    }
    expect(jobs.statusOf("rec1", { isActive: false, pendingUploads })).toEqual({ state: "done", kind: "live" });

    // A later re-transcription becomes the Recording's status
    jobs.chunkQueued("tv2", "rec1", "retranscribe");
    expect(jobs.statusOf("rec1", { isActive: false, pendingUploads })).toMatchObject({
      state: "transcribing",
      kind: "retranscribe",
    });
    store.close();
  });

  it("finishes Recordings a crash left unstopped, using the audio on disk for their length", async () => {
    const store = new CompanionStore(path.join(tmpDir, "companion.sqlite"));
    const base = {
      duoId: "duo1",
      startedAt: new Date(1_000_000).toISOString(),
      clockAnchorMs: 1_000_000,
      audioFormat: "pcm" as const,
      durationMs: 0,
      bytes: 0,
    };
    const crashedPath = path.join(tmpDir, "crashed.pcm");
    writeFileSync(crashedPath, Buffer.alloc(16000 * 2 * 5)); // 5 s of audio
    store.saveLocalRecording({ ...base, id: "crashed", transcriptVersionId: "tv1", stoppedAt: null, stopReason: null, audioPath: crashedPath });
    store.saveLocalRecording({ ...base, id: "live", transcriptVersionId: "tv2", stoppedAt: null, stopReason: null, audioPath: path.join(tmpDir, "live.pcm") });
    store.saveLocalRecording({ ...base, id: "fine", transcriptVersionId: "tv3", stoppedAt: base.startedAt, stopReason: "stop", audioPath: path.join(tmpDir, "fine.flac"), audioFormat: "flac" });

    const converted: string[] = [];
    const recovered = await recoverUnfinishedRecordings(
      store,
      async (pcmPath) => {
        converted.push(pcmPath);
        return null; // ffmpeg unavailable: keep the PCM
      },
      "live",
    );

    expect(recovered).toBe(1);
    expect(converted).toEqual([crashedPath]);
    const crashed = store.listLocalRecordings().find((r) => r.id === "crashed")!;
    expect(crashed).toMatchObject({
      durationMs: 5_000,
      bytes: 16000 * 2 * 5,
      stopReason: "reconnect",
      stoppedAt: new Date(1_005_000).toISOString(),
      audioFormat: "pcm",
    });
    expect(store.listLocalRecordings().find((r) => r.id === "live")!.stoppedAt).toBeNull();
    expect(store.listPendingOutbox(Date.now()).map((i) => i.dedupeKey)).toEqual(["stop:crashed"]);
    store.close();
  });

  it("auto-stops after sustained silence and cuts the stop timestamp back to last speech", () => {
    const watcher = new SilenceWatcher(10_000, 1_000_000);
    watcher.recordSpeech(1_003_000);
    expect(watcher.checkAutoStop(1_012_000)).toBeNull();
    const stopAt = watcher.checkAutoStop(1_013_000);
    expect(stopAt).toBe(1_003_000);
  });

  it("polls GeoGuessr sequentially, deduplicates via server missing-check, stores empty replays, and pauses on 401", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const uploadedGames: string[] = [];
    const uploadedReplays: Array<{ gameId: string; playerId: string; round: number; count: number }> = [];

    const recentTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const poller = new GeoguessrPoller({
      delayBetweenRequestsMs: 0,
      fetchGeoguessr: async (url) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          if (url.includes("/api/v4/feed/private")) {
            return new Response(
              JSON.stringify({
                entries: [
                  {
                    // Grouped feed entries carry a JSON string of an array
                    payload: JSON.stringify([
                      { type: 6, payload: { gameMode: "TeamDuels", gameId: "gg_g1" } },
                    ]),
                  },
                ],
              }),
              { status: 200 },
            );
          }
          if (url.includes("/api/duels/gg_g1")) {
            return new Response(
              JSON.stringify({
                gameId: "gg_g1",
                status: "Finished",
                options: { isTeamDuels: true, isRated: true },
                // Duel team ids are per Game, unlike the Duo's ranked teamId
                teams: [
                  { id: "game_team_red", players: [{ playerId: "p1" }, { playerId: "p2" }] },
                  { id: "game_team_blue", players: [{ playerId: "o1" }, { playerId: "o2" }] },
                ],
                rounds: [{ roundNumber: 1, startTime: recentTime, endTime: recentTime }],
              }),
              { status: 200 },
            );
          }
          if (url.includes("/api/replays/")) {
            // Return empty [] for one player to verify "no replay" storage
            return new Response(JSON.stringify(url.includes("/o2/") ? [] : [{ t: 1 }]), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        } finally {
          inFlight -= 1;
        }
      },
      checkMissing: async (gameIds, replayCandidates) => ({
        missingGameIds: gameIds,
        missingReplays: replayCandidates,
      }),
      uploadGame: async (gameId) => {
        uploadedGames.push(gameId);
      },
      uploadReplay: async (gameId, playerId, round, events) => {
        uploadedReplays.push({ gameId, playerId, round, count: events.length });
      },
    });

    const summary = await poller.syncOnce({ duoTeamId: "p2-p1", ncfaCookie: "cookie_val" });
    expect(maxInFlight).toBe(1);
    expect(summary.authPaused).toBe(false);
    expect(uploadedGames).toEqual(["gg_g1"]);
    expect(uploadedReplays).toHaveLength(4);
    expect(uploadedReplays.find((r) => r.playerId === "o2")?.count).toBe(0);

    // Paginated feed + stored replay backfill flag
    let backfillFlagSeen = false;
    let pageCalls = 0;
    const paginatedPoller = new GeoguessrPoller({
      delayBetweenRequestsMs: 0,
      fetchGeoguessr: async (url) => {
        if (url.includes("/api/v4/feed/private")) {
          pageCalls += 1;
          if (!url.includes("paginationToken=p2")) {
            return new Response(
              JSON.stringify({
                entries: [{ payload: JSON.stringify({ gameMode: "TeamDuels", gameId: "gg_page1" }) }],
                paginationToken: "p2",
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              entries: [{ payload: JSON.stringify({ gameMode: "TeamDuels", gameId: "gg_page2" }) }],
              paginationToken: null,
            }),
            { status: 200 },
          );
        }
        return new Response("[]", { status: 200 });
      },
      checkMissing: async (_gameIds, _replayCandidates, includeBackfill) => {
        if (includeBackfill) backfillFlagSeen = true;
        return { missingGameIds: [], missingReplays: [] };
      },
      uploadGame: async () => {},
      uploadReplay: async () => {},
    });
    await paginatedPoller.syncOnce({
      duoTeamId: "team_duo",
      ncfaCookie: "cookie",
      includeOlderReplays: true,
    });
    expect(pageCalls).toBe(2);
    expect(backfillFlagSeen).toBe(true);

    // On 401 -> pauses cleanly without throwing
    const authFailPoller = new GeoguessrPoller({
      delayBetweenRequestsMs: 0,
      fetchGeoguessr: async () => new Response("unauthorized", { status: 401 }),
      checkMissing: async () => ({ missingGameIds: [], missingReplays: [] }),
      uploadGame: async () => {},
      uploadReplay: async () => {},
    });
    const paused = await authFailPoller.syncOnce({ duoTeamId: "team_duo", ncfaCookie: "bad" });
    expect(paused.authPaused).toBe(true);

    // On a network failure -> resolves with a warning instead of rejecting (callers fire and forget)
    const offlinePoller = new GeoguessrPoller({
      delayBetweenRequestsMs: 0,
      fetchGeoguessr: async () => new Response(JSON.stringify({ entries: [{ gameMode: "TeamDuels", gameId: "g1" }] })),
      checkMissing: async () => {
        throw new TypeError("fetch failed");
      },
      uploadGame: async () => {},
      uploadReplay: async () => {},
    });
    const offline = await offlinePoller.syncOnce({ duoTeamId: "team_duo", ncfaCookie: "cookie" });
    expect(offline.authPaused).toBe(false);
    expect(offline.warning).toMatch(/fetch failed/);
    expect(offlinePoller.progress).toBeNull();
  });

  it("stops paging at a page with nothing new, fetches oldest first, and never refetches other teams' Games", async () => {
    const finished = (teamPlayers: string[]) => ({
      status: "Finished",
      options: { isTeamDuels: true, isRated: true },
      teams: [
        { id: "game_team_a", players: teamPlayers.map((playerId) => ({ playerId })) },
        { id: "game_team_b", players: [{ playerId: "o1" }, { playerId: "o2" }] },
      ],
      rounds: [],
    });
    // Feed is newest first: page 1 = new Games, page 2 = an already stored Game, page 3 never read
    const pages: Record<string, { ids: string[]; next: string | null }> = {
      first: { ids: ["g_new2", "g_other", "g_new1"], next: "p2" },
      p2: { ids: ["g_stored"], next: "p3" },
      p3: { ids: ["g_old"], next: null },
    };
    const stored = new Set(["g_stored", "g_old"]);
    const pagesRead: string[] = [];
    const duelsFetched: string[] = [];
    const uploaded: string[] = [];
    let skippedStore = new Set<string>();

    const poller = new GeoguessrPoller({
      delayBetweenRequestsMs: 0,
      fetchGeoguessr: async (url) => {
        if (url.includes("/api/v4/feed/private")) {
          const key = url.match(/paginationToken=(\w+)/)?.[1] ?? "first";
          pagesRead.push(key);
          const page = pages[key]!;
          return new Response(
            JSON.stringify({
              entries: page.ids.map((gameId) => ({ payload: JSON.stringify({ gameMode: "TeamDuels", gameId }) })),
              paginationToken: page.next,
            }),
            { status: 200 },
          );
        }
        const duelId = url.match(/\/api\/duels\/(\w+)/)?.[1];
        if (duelId) {
          duelsFetched.push(duelId);
          return new Response(JSON.stringify(finished(duelId === "g_other" ? ["p1", "x9"] : ["p1", "p2"])), {
            status: 200,
          });
        }
        return new Response("[]", { status: 200 });
      },
      checkMissing: async (gameIds) => ({
        missingGameIds: gameIds.filter((id) => !stored.has(id)),
        missingReplays: [],
      }),
      uploadGame: async (gameId) => {
        uploaded.push(gameId);
        stored.add(gameId);
      },
      uploadReplay: async () => {},
      loadSkippedGameIds: () => new Set(skippedStore),
      saveSkippedGameIds: (_duo, ids) => {
        skippedStore = new Set(ids);
      },
    });

    const first = await poller.syncOnce({ duoTeamId: "p1-p2", ncfaCookie: "c" });
    expect(pagesRead).toEqual(["first", "p2"]);
    expect(duelsFetched).toEqual(["g_new1", "g_other", "g_new2"]);
    expect(uploaded).toEqual(["g_new1", "g_new2"]);
    expect(first.gamesUploaded).toBe(2);
    expect(first.scan).toEqual({
      feedPages: 2,
      teamDuelsSeen: 4,
      alreadyStored: 1,
      notThisDuo: 1,
      unfinished: 0,
      stoppedEarly: true,
    });
    expect(poller.progress).toBeNull();

    // Second sync: everything on page 1 is stored or known not to be ours, so no Game is fetched
    pagesRead.length = 0;
    duelsFetched.length = 0;
    const second = await poller.syncOnce({ duoTeamId: "p1-p2", ncfaCookie: "c" });
    expect(pagesRead).toEqual(["first"]);
    expect(duelsFetched).toEqual([]);
    expect(second.gamesUploaded).toBe(0);
    expect(second.scan).toMatchObject({ teamDuelsSeen: 3, alreadyStored: 2, notThisDuo: 1, stoppedEarly: true });
  });
});
