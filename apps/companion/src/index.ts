import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CURRENT_API_VERSION,
  uuidv7,
  type ChunkUtterance,
  type StopReason,
} from "@geo-coach/shared";
import { CompanionStore } from "./store.js";
import { PriorityTranscriptionQueue } from "./queue.js";
import { OutboxUploader, type SendOutboxResult } from "./uploader.js";
import { GeoguessrPoller } from "./geoguessr.js";
import { SilenceWatcher } from "./silence.js";
import { TranscriberClient, type TranscriberHealth } from "./transcriber.js";
import { TranscriptJobTracker } from "./jobs.js";
import { recoverUnfinishedRecordings } from "./recovery.js";
import {
  computeAudioDiskUsageBytes,
  computePcmRms,
  convertPcmToFlac,
  deleteAudioOlderThan,
} from "./audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION_VERSION = process.env.COMPANION_VERSION ?? "0.1.0";
const PORT = Number(process.env.COMPANION_PORT ?? 4173);
const HOST = process.env.COMPANION_HOST ?? "127.0.0.1";
const DATA_DIR = process.env.COMPANION_DATA_DIR ?? path.resolve(process.cwd(), "data/companion");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const CHUNKS_DIR = path.join(DATA_DIR, "chunks");
const PUBLIC_DIR = path.resolve(__dirname, "../dist/public");

const MAX_CHUNK_BYTES = 16000 * 2 * 30; // 30 s of 16 kHz mono Int16 PCM
const PAUSE_CUT_MIN_BYTES = 16000 * 2 * 6; // cut after >= 6 s if silence pause detected
const SPEECH_RMS_THRESHOLD = 0.012;

interface ActiveRecording {
  recordingId: string;
  transcriptVersionId: string;
  duoId: string;
  duoTeamId: string | null;
  hotwords: string[];
  clockAnchorMs: number;
  pcmPath: string;
  totalBytes: number;
  chunkNo: number;
  chunkOffsetMs: number;
  chunkBuffers: Buffer[];
  chunkBytes: number;
  silenceWatcher: SilenceWatcher;
  ws: WebSocket | null;
}

interface CachedDuo {
  id: string;
  name: string;
  geoguessrTeamId: string;
  hotwords: string[];
}

async function main() {
  await mkdir(AUDIO_DIR, { recursive: true });
  await mkdir(CHUNKS_DIR, { recursive: true });

  const store = new CompanionStore(path.join(DATA_DIR, "companion.sqlite"));
  const transcriber = new TranscriberClient();
  const jobs = new TranscriptJobTracker();
  let transcriberHealth: TranscriberHealth = "offline";

  async function refreshTranscriberHealth(): Promise<void> {
    transcriberHealth = await transcriber.health();
  }

  let activeRec: ActiveRecording | null = null;
  let latestServerCompanionVersion: string | null = null;
  let lastNotice: string | null = null;
  let lastBootstrapAtMs = 0;

  function getServerUrl(): string {
    return (
      store.getSetting("serverUrl") ??
      process.env.GEOCOACH_SERVER_URL ??
      "http://localhost:5173"
    ).replace(/\/$/, "");
  }

  function getCompanionToken(): string {
    return store.getSetting("companionToken") ?? process.env.COMPANION_TOKEN ?? "";
  }

  function getNcfaCookie(): string {
    // Accept a pasted "_ncfa=<value>" too: the fetch adds the name itself
    return (store.getSetting("ncfaCookie") ?? "").replace(/^_ncfa=/, "");
  }

  function getCachedDuos(): CachedDuo[] {
    try {
      const raw = store.getSetting("cachedDuos");
      return raw ? (JSON.parse(raw) as CachedDuo[]) : [];
    } catch {
      return [];
    }
  }

  async function serverFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
    const token = getCompanionToken();
    const res = await fetch(`${getServerUrl()}${apiPath}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "X-GeoCoach-Api-Version": String(CURRENT_API_VERSION),
      },
    });
    const latestHeader = res.headers.get("x-geocoach-latest-companion-version");
    if (latestHeader) latestServerCompanionVersion = latestHeader;
    return res;
  }

  async function sendOutboxItem(item: { kind: string; payloadJson: string }): Promise<SendOutboxResult> {
    if (!getCompanionToken()) return { ok: false };
    const payload = JSON.parse(item.payloadJson) as Record<string, unknown>;
    let res: Response;

    switch (item.kind) {
      case "startRecording":
        res = await serverFetch("/api/companion/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      case "stopRecording":
        res = await serverFetch(`/api/companion/recordings/${payload.recordingId}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stoppedAt: payload.stoppedAt,
            stopReason: payload.stopReason,
          }),
        });
        break;
      case "offset":
        res = await serverFetch(`/api/companion/recordings/${payload.recordingId}/offsets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            measuredAt: payload.measuredAt,
            pcTimeMs: payload.pcTimeMs,
            offsetMs: payload.offsetMs,
            rttMs: payload.rttMs,
          }),
        });
        break;
      case "startRetranscription":
        res = await serverFetch("/api/companion/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      case "chunk":
        res = await serverFetch(`/api/companion/transcripts/${payload.transcriptVersionId}/chunks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordingId: payload.recordingId,
            chunkNo: payload.chunkNo,
            utterances: payload.utterances,
          }),
        });
        break;
      case "completeTranscript":
        res = await serverFetch(`/api/companion/transcripts/${payload.transcriptVersionId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalChunks: payload.totalChunks }),
        });
        break;
      case "game":
        res = await serverFetch("/api/companion/geoguessr/games", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      case "replay":
        res = await serverFetch("/api/companion/geoguessr/replays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        break;
      default:
        return { ok: true };
    }

    if (res.status === 426) {
      return { ok: false, updateRequired: true };
    }
    if (!res.ok && res.status !== 409) {
      return { ok: false };
    }
    if (item.kind === "chunk" && res.ok) {
      const json = (await res.json()) as { highestContiguousChunkNo?: number };
      return { ok: true, highestContiguousChunkNo: json.highestContiguousChunkNo };
    }
    return { ok: true };
  }

  const uploader = new OutboxUploader(store, sendOutboxItem);

  const queue = new PriorityTranscriptionQueue(async (job) => {
    let result: Awaited<ReturnType<typeof transcriber.transcribePcmChunk>>;
    try {
      result = await transcriber.transcribePcmChunk({
        pcmPath: job.pcmPath,
        chunkOffsetMs: job.offsetMs,
        hotwords: job.hotwords,
      });
    } catch (err) {
      jobs.chunkFailed(job.transcriptVersionId, err);
      throw err;
    }
    jobs.chunkDone(job.transcriptVersionId);
    store.enqueueOutbox("chunk", `${job.transcriptVersionId}:${job.chunkNo}`, {
      transcriptVersionId: job.transcriptVersionId,
      recordingId: job.recordingId,
      chunkNo: job.chunkNo,
      utterances: result.utterances as ChunkUtterance[],
    });
    if (job.completeAfter) {
      store.enqueueOutbox("completeTranscript", `complete:${job.transcriptVersionId}`, {
        transcriptVersionId: job.transcriptVersionId,
        totalChunks: job.completeAfter.totalChunks,
      });
    }
    void uploader.drainOnce();
  });

  const poller = new GeoguessrPoller({
    delayBetweenRequestsMs: 750,
    fetchGeoguessr: (url, cookie) =>
      fetch(url, {
        headers: {
          Cookie: `_ncfa=${cookie}`,
          Accept: "application/json",
        },
      }),
    checkMissing: async (gameIds, replayCandidates, includeStoredReplayBackfill = false) => {
      const duoId = store.getSetting("selectedDuoId") ?? getCachedDuos()[0]?.id;
      if (!duoId || !getCompanionToken()) {
        return { missingGameIds: [], missingReplays: [] };
      }
      const res = await serverFetch("/api/companion/geoguessr/missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duoId,
          gameIds,
          replayCandidates,
          includeStoredReplayBackfill,
        }),
      });
      if (!res.ok) return { missingGameIds: [], missingReplays: [] };
      return (await res.json()) as {
        missingGameIds: string[];
        missingReplays: typeof replayCandidates;
      };
    },
    uploadGame: async (gameId, rawDuel) => {
      const duoId = store.getSetting("selectedDuoId") ?? getCachedDuos()[0]?.id;
      if (!duoId) return;
      store.enqueueOutbox("game", `game:${duoId}:${gameId}`, {
        duoId,
        geoguessrGameId: gameId,
        fetchedAt: new Date().toISOString(),
        rawDuel,
      });
      await uploader.drainOnce();
    },
    loadSkippedGameIds: (duoTeamId) => {
      try {
        return new Set(JSON.parse(store.getSetting(`skippedGames:${duoTeamId}`) ?? "[]") as string[]);
      } catch {
        return new Set();
      }
    },
    saveSkippedGameIds: (duoTeamId, ids) => {
      store.setSetting(`skippedGames:${duoTeamId}`, JSON.stringify([...ids]));
    },
    uploadReplay: async (gameId, playerId, roundNumber, rawEvents) => {
      const duoId = store.getSetting("selectedDuoId") ?? getCachedDuos()[0]?.id;
      if (!duoId) return;
      store.enqueueOutbox("replay", `replay:${duoId}:${gameId}:${playerId}:${roundNumber}`, {
        duoId,
        geoguessrGameId: gameId,
        geoguessrPlayerId: playerId,
        roundNumber,
        fetchedAt: new Date().toISOString(),
        rawEvents,
      });
      await uploader.drainOnce();
    },
  });

  async function refreshBootstrap(): Promise<CachedDuo[]> {
    if (!getCompanionToken()) return getCachedDuos();
    try {
      const res = await serverFetch("/api/companion/bootstrap");
      if (!res.ok) return getCachedDuos();
      const data = (await res.json()) as { duos: CachedDuo[] };
      store.setSetting("cachedDuos", JSON.stringify(data.duos));
      if (!store.getSetting("selectedDuoId") && data.duos.length === 1) {
        store.setSetting("selectedDuoId", data.duos[0]!.id);
      }
      return data.duos;
    } catch {
      return getCachedDuos();
    }
  }

  async function measureClockOffset(recordingId: string): Promise<void> {
    if (!getCompanionToken()) return;
    try {
      const t0 = Date.now();
      const res = await serverFetch("/api/companion/time");
      const t1 = Date.now();
      if (!res.ok) return;
      const { serverTimeMs } = (await res.json()) as { serverTimeMs: number };
      const rttMs = Math.max(0, t1 - t0);
      const midpoint = Math.round((t0 + t1) / 2);
      const offsetMs = serverTimeMs - midpoint;
      store.enqueueOutbox("offset", `offset:${recordingId}:${t0}`, {
        recordingId,
        measuredAt: new Date(t1).toISOString(),
        pcTimeMs: midpoint,
        offsetMs,
        rttMs,
      });
      void uploader.drainOnce();
    } catch {
      // Retry on next measurement tick
    }
  }

  async function flushCurrentChunk(
    rec: ActiveRecording,
    completeOnFinish: boolean = false,
  ): Promise<boolean> {
    if (rec.chunkBytes === 0) return false;
    const pcm = Buffer.concat(rec.chunkBuffers);
    const chunkNo = rec.chunkNo;
    const chunkOffsetMs = rec.chunkOffsetMs;
    rec.chunkNo += 1;
    rec.chunkOffsetMs += Math.round((pcm.byteLength / 2 / 16000) * 1000);
    rec.chunkBuffers = [];
    rec.chunkBytes = 0;

    const chunkPath = path.join(CHUNKS_DIR, `${rec.transcriptVersionId}-${chunkNo}.pcm`);
    await writeFile(chunkPath, pcm);

    jobs.chunkQueued(rec.transcriptVersionId, rec.recordingId, "live");
    queue.enqueue({
      id: `${rec.transcriptVersionId}:${chunkNo}`,
      priority: "live",
      recordingId: rec.recordingId,
      transcriptVersionId: rec.transcriptVersionId,
      chunkNo,
      pcmPath: chunkPath,
      hotwords: rec.hotwords,
      offsetMs: chunkOffsetMs,
      completeAfter: completeOnFinish ? { totalChunks: rec.chunkNo } : undefined,
    });
    void queue.drainAvailable();
    return true;
  }

  async function stopActiveRecording(reason: StopReason, stoppedAtMs?: number): Promise<void> {
    if (!activeRec) return;
    const rec = activeRec;
    activeRec = null;

    const flushedFinalChunk = await flushCurrentChunk(rec, true);
    const stopIso = new Date(stoppedAtMs ?? Date.now()).toISOString();

    store.enqueueOutbox("stopRecording", `stop:${rec.recordingId}`, {
      recordingId: rec.recordingId,
      stoppedAt: stopIso,
      stopReason: reason,
    });

    // Wait for all live transcription jobs for this Recording to finish before sending completeTranscript
    await queue.drainAvailable();
    if (!flushedFinalChunk) {
      store.enqueueOutbox("completeTranscript", `complete:${rec.transcriptVersionId}`, {
        transcriptVersionId: rec.transcriptVersionId,
        totalChunks: rec.chunkNo,
      });
    }

    queue.setLiveRecordingActive(false);
    void queue.drainAvailable();
    void uploader.drainOnce();

    // Convert raw PCM to lossless FLAC after Stop
    const flacPath = await convertPcmToFlac(rec.pcmPath);
    const finalPath = flacPath ?? rec.pcmPath;
    const finalStat = await stat(finalPath).catch(() => null);
    store.saveLocalRecording({
      id: rec.recordingId,
      duoId: rec.duoId,
      transcriptVersionId: rec.transcriptVersionId,
      startedAt: new Date(rec.clockAnchorMs).toISOString(),
      stoppedAt: stopIso,
      stopReason: reason,
      clockAnchorMs: rec.clockAnchorMs,
      audioPath: finalPath,
      audioFormat: flacPath ? "flac" : "pcm",
      durationMs: Math.round((rec.totalBytes / 2 / 16000) * 1000),
      bytes: finalStat?.size ?? rec.totalBytes,
    });

    // Trigger GeoGuessr poll on Stop
    const ncfa = getNcfaCookie();
    if (ncfa && rec.duoTeamId) {
      void poller.syncOnce({ duoTeamId: rec.duoTeamId, ncfaCookie: ncfa });
    }
  }

  // Periodic background timers: outbox & transcription retry drain + Transcriber health (5 s), heartbeat (30 s), clock offset & silence check (15 s), GeoGuessr poll during Session (2.5 min)
  setInterval(() => {
    void queue.drainAvailable();
    void uploader.drainOnce();
    void refreshTranscriberHealth();
  }, 5_000);
  void refreshTranscriberHealth();

  setInterval(async () => {
    const duoId = activeRec?.duoId ?? store.getSetting("selectedDuoId") ?? getCachedDuos()[0]?.id;
    if (!duoId || !getCompanionToken()) return;
    try {
      await serverFetch("/api/companion/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duoId,
          recordingId: activeRec?.recordingId ?? null,
          recording: activeRec !== null,
          uploadOk: uploader.lastUploadOk,
          pendingChunks: store.countPendingOutbox(),
          transcriptionLagSec: queue.getLagSeconds(),
          companionVersion: COMPANION_VERSION,
          geoguessrAuthOk: !poller.authPaused,
        }),
      });
    } catch {
      // Offline
    }
  }, 30_000);

  setInterval(() => {
    if (!activeRec) return;
    void measureClockOffset(activeRec.recordingId);
    const autoStopAt = activeRec.silenceWatcher.checkAutoStop();
    if (autoStopAt !== null) {
      lastNotice = "Auto-stopped Recording after 30 min of silence (trimmed to last speech).";
      if (activeRec.ws?.readyState === 1) {
        activeRec.ws.send(JSON.stringify({ type: "autoStopped", notice: lastNotice }));
      }
      void stopActiveRecording("silence", autoStopAt);
    }
  }, 15_000);

  setInterval(() => {
    if (!activeRec?.duoTeamId) return;
    const ncfa = getNcfaCookie();
    if (!ncfa || poller.authPaused) return;
    void poller.syncOnce({ duoTeamId: activeRec.duoTeamId, ncfaCookie: ncfa });
  }, 150_000);

  async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (url.pathname === "/local/state" && req.method === "GET") {
      // The page polls every 2 s while busy; refresh Duos from the server at most once a minute
      let duos = getCachedDuos();
      if (Date.now() - lastBootstrapAtMs > 60_000) {
        lastBootstrapAtMs = Date.now();
        duos = await refreshBootstrap();
      }
      const diskBytes = await computeAudioDiskUsageBytes(AUDIO_DIR);
      const pendingUploads = (tv: string) => store.countPendingOutboxForTranscript(tv);
      return sendJson(res, 200, {
        companionVersion: COMPANION_VERSION,
        latestCompanionVersion: latestServerCompanionVersion,
        updateAvailable:
          latestServerCompanionVersion !== null &&
          latestServerCompanionVersion !== COMPANION_VERSION,
        updateRequired: uploader.updateRequired,
        serverUrl: getServerUrl(),
        hasToken: Boolean(getCompanionToken()),
        hasNcfa: Boolean(getNcfaCookie()),
        selectedDuoId: store.getSetting("selectedDuoId") ?? duos[0]?.id ?? null,
        duos,
        recording: activeRec
          ? {
              recordingId: activeRec.recordingId,
              duoId: activeRec.duoId,
              startedAt: new Date(activeRec.clockAnchorMs).toISOString(),
              audioMs: Math.round((activeRec.totalBytes / 2 / 16000) * 1000),
            }
          : null,
        transcriber: transcriberHealth,
        transcribing: jobs.isBusy(),
        uploadOk: uploader.lastUploadOk,
        pendingOutbox: store.countPendingOutbox(),
        transcriptionLagSec: queue.getLagSeconds(),
        geoguessrAuthPaused: poller.authPaused,
        geoguessrWarning: poller.lastWarning,
        syncProgress: poller.progress,
        notice: lastNotice,
        diskBytes,
        recordings: store.listLocalRecordings().map((r) => ({
          ...r,
          status: jobs.statusOf(r.id, { isActive: activeRec?.recordingId === r.id, pendingUploads }),
        })),
      });
    }

    if (url.pathname === "/local/warm" && req.method === "POST") {
      // Page opened: start the cold model load now rather than at the first chunk
      if (transcriberHealth === "idle") {
        transcriberHealth = "loading";
        void transcriber.warmLoad();
      }
      return sendJson(res, 200, { transcriber: transcriberHealth });
    }

    if (url.pathname === "/local/settings" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (typeof body.serverUrl === "string" && body.serverUrl.trim()) {
        store.setSetting("serverUrl", body.serverUrl.trim());
      }
      if (typeof body.companionToken === "string" && body.companionToken.trim()) {
        store.setSetting("companionToken", body.companionToken.trim());
      }
      if (typeof body.ncfaCookie === "string") {
        store.setSetting("ncfaCookie", body.ncfaCookie.trim());
      }
      if (typeof body.selectedDuoId === "string" && body.selectedDuoId.trim()) {
        store.setSetting("selectedDuoId", body.selectedDuoId.trim());
      }
      const duos = await refreshBootstrap();
      return sendJson(res, 200, { ok: true, duos });
    }

    if (url.pathname === "/local/sync" && req.method === "POST") {
      const body = await readJsonBody(req);
      const ncfa = getNcfaCookie();
      const duos = getCachedDuos();
      const selectedId = store.getSetting("selectedDuoId") ?? duos[0]?.id;
      const duo = duos.find((d) => d.id === selectedId);
      if (!ncfa || !duo) {
        return sendJson(res, 400, { error: "Configure Duo and _ncfa cookie first" });
      }
      const summary = await poller.syncOnce({
        duoTeamId: duo.geoguessrTeamId,
        ncfaCookie: ncfa,
        includeOlderReplays: Boolean(body.includeOlderReplays),
      });
      return sendJson(res, 200, summary);
    }

    if (url.pathname === "/local/retranscribe" && req.method === "POST") {
      const body = await readJsonBody(req);
      const allRecs = store.listLocalRecordings();
      const targetRecs =
        typeof body.recordingId === "string"
          ? allRecs.filter((r) => r.id === body.recordingId)
          : typeof body.sinceIso === "string"
            ? allRecs.filter((r) => Date.parse(r.startedAt) >= Date.parse(body.sinceIso as string))
            : [];

      const duos = await refreshBootstrap();
      let queued = 0;
      for (const r of targetRecs) {
        if (r.audioFormat === "deleted" || !existsSync(r.audioPath)) continue;
        const duo = duos.find((d) => d.id === r.duoId);
        const newVersionId = uuidv7();
        store.enqueueOutbox("startRetranscription", `retrans:${newVersionId}`, {
          transcriptVersionId: newVersionId,
          recordingId: r.id,
          model: process.env.WHISPER_MODEL ?? "large-v3",
          transcriberSettings: { computeType: "int8_float16", vadFilter: true },
          hotwordsUsed: duo?.hotwords ?? [],
        });
        jobs.chunkQueued(newVersionId, r.id, "retranscribe");
        queue.enqueue({
          id: `${newVersionId}:0`,
          priority: "retranscribe",
          recordingId: r.id,
          transcriptVersionId: newVersionId,
          chunkNo: 0,
          pcmPath: r.audioPath,
          hotwords: duo?.hotwords ?? [],
          offsetMs: 0,
          completeAfter: { totalChunks: 1 },
        });
        queued += 1;
      }
      void queue.drainAvailable();
      void uploader.drainOnce();
      return sendJson(res, 200, { ok: true, queued });
    }

    if (url.pathname === "/local/cleanup-audio" && req.method === "POST") {
      const body = await readJsonBody(req);
      const days = Math.max(1, Number(body.olderThanDays ?? 90));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await deleteAudioOlderThan(AUDIO_DIR, cutoff);
      return sendJson(res, 200, result);
    }

    // Serve built Svelte recording page from dist/public
    const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const safePath = path.resolve(PUBLIC_DIR, requested);
    if (safePath.startsWith(PUBLIC_DIR) && existsSync(safePath)) {
      const content = await readFile(safePath);
      const ext = path.extname(safePath);
      const mime =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".css"
              ? "text/css; charset=utf-8"
              : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/audio" });
  wss.on("connection", (ws) => {
    ws.on("message", async (raw, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(raw.toString("utf8")) as {
          type: string;
          duoId?: string;
          continuedFromRecordingId?: string | null;
          clockAnchorMs?: number;
        };

        if (msg.type === "start") {
          if (activeRec) {
            if (msg.continuedFromRecordingId && msg.continuedFromRecordingId === activeRec.recordingId) {
              await stopActiveRecording("reconnect");
            } else {
              ws.send(JSON.stringify({ type: "error", message: "Recording already active" }));
              return;
            }
          }
          const duos = await refreshBootstrap();
          const duoId = msg.duoId ?? store.getSetting("selectedDuoId") ?? duos[0]?.id;
          if (!duoId) {
            ws.send(JSON.stringify({ type: "error", message: "Select a Duo first" }));
            return;
          }
          store.setSetting("selectedDuoId", duoId);
          const duo = duos.find((d) => d.id === duoId);

          const clockAnchorMs =
            typeof msg.clockAnchorMs === "number" && Number.isFinite(msg.clockAnchorMs)
              ? Math.round(msg.clockAnchorMs)
              : Date.now();
          const recordingId = uuidv7(clockAnchorMs);
          const transcriptVersionId = uuidv7(clockAnchorMs);
          const pcmPath = path.join(AUDIO_DIR, `${recordingId}.pcm`);
          await writeFile(pcmPath, Buffer.alloc(0));

          const silenceMin = Number(store.getSetting("silenceTimeoutMin") ?? 30);
          activeRec = {
            recordingId,
            transcriptVersionId,
            duoId,
            duoTeamId: duo?.geoguessrTeamId ?? null,
            hotwords: duo?.hotwords ?? [],
            clockAnchorMs,
            pcmPath,
            totalBytes: 0,
            chunkNo: 0,
            chunkOffsetMs: 0,
            chunkBuffers: [],
            chunkBytes: 0,
            silenceWatcher: new SilenceWatcher(silenceMin * 60 * 1000, clockAnchorMs),
            ws,
          };

          queue.setLiveRecordingActive(true);
          void transcriber.warmLoad();

          store.saveLocalRecording({
            id: recordingId,
            duoId,
            transcriptVersionId,
            startedAt: new Date(clockAnchorMs).toISOString(),
            stoppedAt: null,
            stopReason: null,
            clockAnchorMs,
            audioPath: pcmPath,
            audioFormat: "pcm",
            durationMs: 0,
            bytes: 0,
          });

          store.enqueueOutbox("startRecording", `start:${recordingId}`, {
            recordingId,
            transcriptVersionId,
            duoId,
            startedAt: new Date(clockAnchorMs).toISOString(),
            clockAnchorMs,
            continuedFromRecordingId: msg.continuedFromRecordingId ?? null,
            companionVersion: COMPANION_VERSION,
            model: process.env.WHISPER_MODEL ?? "large-v3",
            transcriberSettings: { computeType: "int8_float16", vadFilter: true },
            hotwordsUsed: duo?.hotwords ?? [],
          });
          void uploader.drainOnce();
          void measureClockOffset(recordingId);
          lastNotice = null;
          ws.send(JSON.stringify({ type: "started", recordingId, transcriptVersionId }));
        } else if (msg.type === "stop") {
          await stopActiveRecording("stop");
          ws.send(JSON.stringify({ type: "stopped" }));
        }
        return;
      }

      // Binary 16 kHz Int16 PCM frame from browser AudioWorklet
      if (!activeRec) return;
      const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      await appendFile(activeRec.pcmPath, pcm);
      activeRec.totalBytes += pcm.byteLength;
      activeRec.chunkBuffers.push(pcm);
      activeRec.chunkBytes += pcm.byteLength;

      const rms = computePcmRms(pcm);
      const isSpeech = rms >= SPEECH_RMS_THRESHOLD;
      if (isSpeech) {
        activeRec.silenceWatcher.recordSpeech();
      }

      // Pause-cut at >= 6 s silence or hard cap at 30 s
      if (
        activeRec.chunkBytes >= MAX_CHUNK_BYTES ||
        (!isSpeech && activeRec.chunkBytes >= PAUSE_CUT_MIN_BYTES)
      ) {
        await flushCurrentChunk(activeRec);
      }
    });

    ws.on("close", () => {
      if (activeRec && activeRec.ws === ws) {
        activeRec.ws = null;
        void stopActiveRecording("reconnect");
      }
    });
  });

  const recovered = await recoverUnfinishedRecordings(store, convertPcmToFlac).catch((err: unknown) => {
    console.error("Recovering unfinished Recordings failed:", err);
    return 0;
  });
  if (recovered > 0) {
    console.log(`Recovered ${recovered} Recording(s) left unfinished by a crash`);
    void uploader.drainOnce();
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`geo-coach Companion listening on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Companion fatal error:", err);
  process.exit(1);
});
