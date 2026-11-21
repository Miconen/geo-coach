<script lang="ts">
  import { onMount } from "svelte";
  import {
    DEFAULT_THEME_ID,
    THEMES,
    THEME_STORAGE_KEY,
    resolveThemeId,
    type ThemeId,
  } from "@geo-coach/shared";

  interface LocalState {
    companionVersion: string;
    latestCompanionVersion: string | null;
    updateAvailable: boolean;
    updateRequired: boolean;
    serverUrl: string;
    hasToken: boolean;
    hasNcfa: boolean;
    selectedDuoId: string | null;
    duos: Array<{ id: string; name: string; geoguessrTeamId: string; hotwords: string[] }>;
    recording: { recordingId: string; duoId: string; startedAt: string } | null;
    uploadOk: boolean;
    pendingOutbox: number;
    transcriptionLagSec: number;
    geoguessrAuthPaused: boolean;
    geoguessrWarning: string | null;
    syncProgress: {
      phase: "feed" | "games" | "replays";
      feedPages: number;
      newGames: number;
      gamesDone: number;
      replaysDone: number;
      replaysTotal: number;
    } | null;
    notice: string | null;
    diskBytes: number;
    recordings: Array<{
      id: string;
      startedAt: string;
      stoppedAt: string | null;
      audioFormat: string;
      durationMs: number;
      bytes: number;
    }>;
  }

  const darkThemes = THEMES.filter((t) => t.appearance === "dark");
  const lightThemes = THEMES.filter((t) => t.appearance === "light");

  let themeId = $state<ThemeId>(DEFAULT_THEME_ID);
  const activeTheme = $derived(THEMES.find((t) => t.id === themeId) ?? THEMES[0]!);

  function applyTheme(id: ThemeId, persist = true) {
    themeId = id;
    document.documentElement.dataset.theme = id;
    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id);
      } catch {
        // ignore storage errors
      }
    }
  }

  let state = $state<LocalState | null>(null);
  let serverUrl = $state("http://localhost:5173");
  // Set while the Server URL box has unsaved edits, so the 10 s state poll doesn't overwrite them
  let serverUrlEdited = $state(false);
  let companionToken = $state("");
  let ncfaCookie = $state("");
  let selectedDuoId = $state("");
  let isCapturing = $state(false);
  let reconnectedNotice = $state(false);
  let statusMessage = $state("");
  let retransSince = $state("");
  let cleanupDays = $state(90);

  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let bufferedFrames: ArrayBuffer[] = [];
  let bufferStartedAtMs: number | null = null;
  let lastRecordingId: string | null = null;
  let reconnectTimer: number | null = null;

  async function loadState() {
    const res = await fetch("/local/state");
    const data = (await res.json()) as LocalState;
    state = data;
    if (!serverUrlEdited) serverUrl = data.serverUrl;
    if (!selectedDuoId && data.selectedDuoId) selectedDuoId = data.selectedDuoId;
  }

  function connectWebSocket(isReconnect: boolean) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/audio`);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      ws = socket;
      if (isCapturing) {
        socket.send(
          JSON.stringify({
            type: "start",
            duoId: selectedDuoId,
            continuedFromRecordingId: isReconnect ? lastRecordingId : null,
            clockAnchorMs: isReconnect ? (bufferStartedAtMs ?? Date.now()) : Date.now(),
          }),
        );
      }
    };

    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        type: string;
        recordingId?: string;
        notice?: string;
        message?: string;
      };
      if (msg.type === "started" && msg.recordingId) {
        lastRecordingId = msg.recordingId;
        if (isReconnect) reconnectedNotice = true;
        // Flush any PCM frames buffered during disconnect
        for (const frame of bufferedFrames) {
          socket.send(frame);
        }
        bufferedFrames = [];
        bufferStartedAtMs = null;
        void loadState();
      } else if (msg.type === "autoStopped") {
        statusMessage = msg.notice ?? "Auto-stopped after silence.";
        void stopCapture(false);
      } else if (msg.type === "error") {
        statusMessage = msg.message ?? "Companion error";
      }
    };

    socket.onclose = () => {
      ws = null;
      if (isCapturing) {
        if (bufferStartedAtMs === null) bufferStartedAtMs = Date.now();
        reconnectTimer = window.setTimeout(() => connectWebSocket(true), 2000);
      }
    };
  }

  async function startCapture() {
    if (!selectedDuoId) {
      statusMessage = "Select a Duo before starting.";
      return;
    }
    statusMessage = "";
    reconnectedNotice = false;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule("/pcm-processor.js");
    const source = audioCtx.createMediaStreamSource(mediaStream);
    const worklet = new AudioWorkletNode(audioCtx, "pcm16-processor");
    worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(ev.data);
      } else if (isCapturing) {
        bufferedFrames.push(ev.data);
      }
    };
    source.connect(worklet);
    isCapturing = true;
    connectWebSocket(false);
  }

  async function stopCapture(sendStop: boolean = true) {
    isCapturing = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sendStop && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    ws?.close();
    ws = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    await audioCtx?.close();
    audioCtx = null;
    bufferedFrames = [];
    await loadState();
  }

  async function saveSettings(e: Event) {
    e.preventDefault();
    await fetch("/local/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl,
        companionToken: companionToken || undefined,
        ncfaCookie: ncfaCookie || undefined,
        selectedDuoId: selectedDuoId || undefined,
      }),
    });
    companionToken = "";
    ncfaCookie = "";
    serverUrlEdited = false;
    statusMessage = "Settings saved locally.";
    await loadState();
  }

  function describeSync(p: NonNullable<LocalState["syncProgress"]>): string {
    if (p.phase === "feed") {
      return `Reading GeoGuessr feed: page ${p.feedPages}, ${p.newGames} new Game(s) so far`;
    }
    if (p.phase === "games") return `Fetching Games: ${p.gamesDone}/${p.newGames}`;
    return `Fetching replays: ${p.replaysDone}/${p.replaysTotal}`;
  }

  interface SyncScan {
    feedPages: number;
    teamDuelsSeen: number;
    alreadyStored: number;
    notThisDuo: number;
    unfinished: number;
    stoppedEarly: boolean;
  }

  function describeSyncResult(games: number, replays: number, scan: SyncScan | undefined): string {
    const head = `Synced ${games} Game(s), ${replays} replay(s).`;
    if (!scan) return head;
    const pages = `${scan.feedPages} feed page(s)`;
    if (scan.teamDuelsSeen === 0) return `${head} No team duels on the ${pages} read.`;
    const parts = [
      scan.alreadyStored > 0 && `${scan.alreadyStored} already stored`,
      scan.notThisDuo > 0 && `${scan.notThisDuo} not this Duo's (other partner or unrated)`,
      scan.unfinished > 0 && `${scan.unfinished} still being played`,
    ].filter(Boolean);
    const end = scan.stoppedEarly
      ? "Stopped at a page with nothing new."
      : "Reached the end of the feed.";
    const replayNote = games === 0 ? " Replays are only fetched for new Games." : "";
    return `${head} Read ${pages}: ${scan.teamDuelsSeen} team duel(s)${parts.length ? `, ${parts.join(", ")}` : ""}. ${end}${replayNote}`;
  }

  async function syncNow(includeOlderReplays: boolean) {
    statusMessage = "Syncing GeoGuessr...";
    // Refresh faster while syncing so the progress line moves
    const progressTimer = window.setInterval(() => void loadState(), 1_000);
    const res = await fetch("/local/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeOlderReplays }),
    }).finally(() => window.clearInterval(progressTimer));
    const data = await res.json();
    statusMessage = data.warning
      ? data.warning
      : describeSyncResult(data.gamesUploaded ?? 0, data.replaysUploaded ?? 0, data.scan);
    await loadState();
  }

  async function retranscribe(recordingId?: string) {
    const res = await fetch("/local/retranscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recordingId ? { recordingId } : { sinceIso: retransSince }),
    });
    const data = await res.json();
    statusMessage = `Queued ${data.queued ?? 0} re-transcription job(s).`;
  }

  async function cleanupAudio() {
    const res = await fetch("/local/cleanup-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ olderThanDays: cleanupDays }),
    });
    const data = await res.json();
    statusMessage = `Deleted ${data.deletedFiles} file(s), freed ${(data.freedBytes / 1048576).toFixed(1)} MB.`;
    await loadState();
  }

  onMount(() => {
    try {
      applyTheme(
        resolveThemeId(
          localStorage.getItem(THEME_STORAGE_KEY) ?? document.documentElement.dataset.theme,
        ),
        false,
      );
    } catch {
      applyTheme(resolveThemeId(document.documentElement.dataset.theme), false);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        applyTheme(resolveThemeId(e.newValue), false);
      }
    };
    window.addEventListener("storage", onStorage);

    void loadState();
    const interval = window.setInterval(() => void loadState(), 10_000);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCapturing) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });
</script>

<main class="page">
  <header class="header">
    <div>
      <h1>geo-coach Companion</h1>
      <div class="subtitle">
        v{state?.companionVersion ?? "..."} · Audio stays on this PC · Use headphones
      </div>
    </div>
    <div class="header-controls">
      <label class="theme-picker" title="Color theme">
        <span
          class="theme-swatch"
          style="background: {activeTheme.swatches.accent}"
          aria-hidden="true"
        ></span>
        <select
          aria-label="Color theme"
          value={themeId}
          onchange={(e) => applyTheme(resolveThemeId(e.currentTarget.value))}
        >
          <optgroup label="Dark themes">
            {#each darkThemes as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </optgroup>
          <optgroup label="Light themes">
            {#each lightThemes as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </optgroup>
        </select>
      </label>

      {#if isCapturing}
        <span class="status-pill recording">● Recording</span>
      {:else}
        <span class="status-pill idle">Idle</span>
      {/if}
    </div>
  </header>

  {#if state?.updateAvailable || state?.updateRequired}
    <div class="banner banner-warn">
      <strong>Update available ({state.latestCompanionVersion}):</strong>
      Run <code>./update.sh</code> (or <code>./update.ps1</code>) between Sessions.
      {#if state.updateRequired}
        Uploads are paused until updated; local Recording continues safely.
      {/if}
    </div>
  {/if}

  {#if reconnectedNotice}
    <div class="banner banner-info">
      Reconnected seamlessly — buffered audio was forwarded into the same Session.
    </div>
  {/if}

  {#if state && state.transcriptionLagSec > 120}
    <div class="banner banner-warn">
      Transcription behind by {Math.round(state.transcriptionLagSec / 60)} min (audio is safe on disk).
    </div>
  {/if}

  {#if state?.geoguessrAuthPaused}
    <div class="banner banner-danger">
      {state.geoguessrWarning ?? "GeoGuessr polling paused (update _ncfa cookie)."}
    </div>
  {/if}

  {#if statusMessage}
    <p class="banner banner-neutral">{statusMessage}</p>
  {/if}
  {#if state?.syncProgress}
    <p class="banner banner-neutral">{describeSync(state.syncProgress)}</p>
  {/if}

  <section class="card">
    <div class="row">
      <label class="field-inline">
        Duo:
        <select bind:value={selectedDuoId} disabled={isCapturing}>
          {#each state?.duos ?? [] as duo}
            <option value={duo.id}>{duo.name}</option>
          {/each}
        </select>
      </label>

      {#if !isCapturing}
        <button onclick={startCapture} class="btn-primary">Start Recording</button>
      {:else}
        <button onclick={() => stopCapture(true)} class="btn-danger">Stop Recording</button>
      {/if}

      <button onclick={() => syncNow(false)}>Sync GeoGuessr now</button>
      <button onclick={() => syncNow(true)}>Backfill older replays</button>
    </div>

    <div class="meta">
      Outbox pending: {state?.pendingOutbox ?? 0} · Upload status: {state?.uploadOk ? "OK" : "Retrying"} · Local audio: {((state?.diskBytes ?? 0) / 1048576).toFixed(1)} MB
    </div>
  </section>

  <section class="card">
    <h2>Local Settings (kept only in Companion volume)</h2>
    <form onsubmit={saveSettings} class="form-grid">
      <!-- Secrets use plain text fields: browsers ignore autocomplete="off" on
           password fields and autofilled the saved _ncfa into both. -->
      <label class="field">
        Server URL
        <input
          class="input-full"
          bind:value={serverUrl}
          oninput={() => (serverUrlEdited = true)}
        />
      </label>
      <label class="field">
        Companion token ({state?.hasToken ? "configured" : "not set"})
        <input
          class="input-full"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={companionToken}
          placeholder="Paste new gc_cmp_... token"
        />
      </label>
      <label class="field">
        GeoGuessr _ncfa cookie ({state?.hasNcfa ? "configured" : "optional"})
        <input
          class="input-full"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={ncfaCookie}
          placeholder="Paste _ncfa value"
        />
      </label>
      <button type="submit" class="btn-primary btn-fit">Save Settings</button>
    </form>
  </section>

  <section class="card">
    <h2>Local Recordings & Re-transcription</h2>
    <div class="row" style="margin-bottom: 12px;">
      <input type="datetime-local" bind:value={retransSince} />
      <button onclick={() => retranscribe()}>Re-transcribe all since date</button>
      <span class="cleanup-group">
        Delete audio older than
        <input class="input-days" type="number" bind:value={cleanupDays} />
        days
        <button onclick={cleanupAudio}>Delete</button>
      </span>
    </div>

    <ul class="recordings-list">
      {#each state?.recordings ?? [] as rec}
        <li class="recording-item">
          <span>
            {new Date(rec.startedAt).toLocaleString()} · {Math.round(rec.durationMs / 1000)}s · {rec.audioFormat} ({(rec.bytes / 1048576).toFixed(1)} MB)
          </span>
          <button onclick={() => retranscribe(rec.id)} disabled={isCapturing}>Re-transcribe</button>
        </li>
      {/each}
    </ul>
  </section>
</main>
