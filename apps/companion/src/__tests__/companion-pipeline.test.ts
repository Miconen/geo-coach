import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanionStore } from "../store.js";
import { PriorityTranscriptionQueue } from "../queue.js";
import { OutboxUploader, computeBackoffMs } from "../uploader.js";
import { GeoguessrPoller } from "../geoguessr.js";
import { SilenceWatcher } from "../silence.js";

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
  });
});
