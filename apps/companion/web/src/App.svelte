<script lang="ts">
  import { onMount } from "svelte";

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

  async function syncNow(includeOlderReplays: boolean) {
    statusMessage = "Syncing GeoGuessr...";
    const res = await fetch("/local/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeOlderReplays }),
    });
    const data = await res.json();
    statusMessage = data.warning
      ? data.warning
      : `Synced ${data.gamesUploaded ?? 0} Games, ${data.replaysUploaded ?? 0} replays.`;
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
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });
</script>

<main style="max-width: 780px; margin: 24px auto; padding: 0 16px; font-family: system-ui, sans-serif; color: #0f172a;">
  <header style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
    <div>
      <h1 style="margin:0; font-size:20px;">geo-coach Companion</h1>
      <div style="font-size:12px; color:#556275;">
        v{state?.companionVersion ?? "..."} · Audio stays on this PC · Use headphones
      </div>
    </div>
    <div style="font-size:12px;">
      {#if isCapturing}
        <span style="background:#dcfce7; color:#15803d; padding:4px 10px; border-radius:999px; font-weight:600;">
          ● Recording
        </span>
      {:else}
        <span style="background:#e2e8f0; color:#475569; padding:4px 10px; border-radius:999px;">
          Idle
        </span>
      {/if}
    </div>
  </header>

  {#if state?.updateAvailable || state?.updateRequired}
    <div style="background:#fef3c7; border:1px solid #f59e0b; padding:10px 12px; border-radius:8px; margin-bottom:12px;">
      <strong>Update available ({state.latestCompanionVersion}):</strong>
      Run <code>./update.sh</code> (or <code>./update.ps1</code>) between Sessions.
      {#if state.updateRequired}
        Uploads are paused until updated; local Recording continues safely.
      {/if}
    </div>
  {/if}

  {#if reconnectedNotice}
    <div style="background:#dbeafe; border:1px solid #3b82f6; padding:8px 12px; border-radius:8px; margin-bottom:12px;">
      Reconnected seamlessly — buffered audio was forwarded into the same Session.
    </div>
  {/if}

  {#if state && state.transcriptionLagSec > 120}
    <div style="background:#fef3c7; padding:8px 12px; border-radius:8px; margin-bottom:12px;">
      Transcription behind by {Math.round(state.transcriptionLagSec / 60)} min (audio is safe on disk).
    </div>
  {/if}

  {#if state?.geoguessrAuthPaused}
    <div style="background:#ffe4e6; border:1px solid #be123c; padding:8px 12px; border-radius:8px; margin-bottom:12px;">
      {state.geoguessrWarning ?? "GeoGuessr polling paused (update _ncfa cookie)."}
    </div>
  {/if}

  {#if statusMessage}
    <p style="background:#f1f5f9; padding:8px 12px; border-radius:8px;">{statusMessage}</p>
  {/if}

  <section style="background:#fff; border:1px solid #dde3ea; border-radius:10px; padding:16px; margin-bottom:16px;">
    <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
      <label style="font-size:13px;">
        Duo:
        <select bind:value={selectedDuoId} disabled={isCapturing} style="margin-left:6px; padding:6px;">
          {#each state?.duos ?? [] as duo}
            <option value={duo.id}>{duo.name}</option>
          {/each}
        </select>
      </label>

      {#if !isCapturing}
        <button onclick={startCapture} style="background:#0f766e; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-weight:600; cursor:pointer;">
          Start Recording
        </button>
      {:else}
        <button onclick={() => stopCapture(true)} style="background:#be123c; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-weight:600; cursor:pointer;">
          Stop Recording
        </button>
      {/if}

      <button onclick={() => syncNow(false)} style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; cursor:pointer;">
        Sync GeoGuessr now
      </button>
      <button onclick={() => syncNow(true)} style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; cursor:pointer;">
        Backfill older replays
      </button>
    </div>

    <div style="margin-top:10px; font-size:12px; color:#556275;">
      Outbox pending: {state?.pendingOutbox ?? 0} · Upload status: {state?.uploadOk ? "OK" : "Retrying"} · Local audio: {((state?.diskBytes ?? 0) / 1048576).toFixed(1)} MB
    </div>
  </section>

  <section style="background:#fff; border:1px solid #dde3ea; border-radius:10px; padding:16px; margin-bottom:16px;">
    <h2 style="margin-top:0; font-size:15px;">Local Settings (kept only in Companion volume)</h2>
    <form onsubmit={saveSettings} style="display:grid; gap:8px;">
      <!-- Secrets use plain text fields: browsers ignore autocomplete="off" on
           password fields and autofilled the saved _ncfa into both. -->
      <label>Server URL <input bind:value={serverUrl} oninput={() => (serverUrlEdited = true)} style="width:100%; padding:6px;" /></label>
      <label>
        Companion token ({state?.hasToken ? "configured" : "not set"})
        <input type="text" autocomplete="off" spellcheck="false" bind:value={companionToken} placeholder="Paste new gc_cmp_... token" style="width:100%; padding:6px;" />
      </label>
      <label>
        GeoGuessr _ncfa cookie ({state?.hasNcfa ? "configured" : "optional"})
        <input type="text" autocomplete="off" spellcheck="false" bind:value={ncfaCookie} placeholder="Paste _ncfa value" style="width:100%; padding:6px;" />
      </label>
      <button type="submit" style="width:fit-content; padding:6px 14px;">Save Settings</button>
    </form>
  </section>

  <section style="background:#fff; border:1px solid #dde3ea; border-radius:10px; padding:16px;">
    <h2 style="margin-top:0; font-size:15px;">Local Recordings & Re-transcription</h2>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
      <input type="datetime-local" bind:value={retransSince} />
      <button onclick={() => retranscribe()}>Re-transcribe all since date</button>
      <span style="margin-left:auto;">
        Delete audio older than <input type="number" bind:value={cleanupDays} style="width:60px;" /> days
        <button onclick={cleanupAudio}>Delete</button>
      </span>
    </div>

    <ul style="list-style:none; padding:0; margin:0; display:grid; gap:6px;">
      {#each state?.recordings ?? [] as rec}
        <li style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#f8fafc; border-radius:6px; font-size:13px;">
          <span>
            {new Date(rec.startedAt).toLocaleString()} · {Math.round(rec.durationMs / 1000)}s · {rec.audioFormat} ({(rec.bytes / 1048576).toFixed(1)} MB)
          </span>
          <button onclick={() => retranscribe(rec.id)} disabled={isCapturing}>Re-transcribe</button>
        </li>
      {/each}
    </ul>
  </section>
</main>
