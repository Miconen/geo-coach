<script lang="ts">
  // Session page (#56 2a(ii)): h1 date; parent Sessions; inline Game chips (the reciprocal of the Game page's
  // Session chips), TranscriptTimeline and RunTimeline; disclosure older and no-op runs and the Manual row.
  import { onMount, tick, untrack } from "svelte";
  import EntityChip from "$lib/components/EntityChip.svelte";
  import ManualLearningModal, { type ManualPrefill } from "$lib/components/ManualLearningModal.svelte";
  import RunTimelineView from "$lib/components/RunTimeline.svelte";
  import TranscriptTimeline from "$lib/components/TranscriptTimeline.svelte";
  import { entityHref, links } from "$lib/links.js";
  import { gameTitle, sessionTitle } from "$lib/entity-titles.js";
  import { getDuoStream } from "$lib/live/context.js";
  import { heartbeats, needsRefresh } from "$lib/live/dependencies.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import { getPendingWork } from "$lib/live/pending-work.svelte.js";
  import type { SessionPayload, SessionRunsPage } from "$lib/server/entities/index.js";
  import type { RunTimeline, RunTimelineRow } from "$lib/server/workbench/run-timeline.js";

  let { data } = $props();
  const duoId = $derived(data.duo.id);
  const live = useEntityRefresh<SessionPayload>({
    base: () => data.payload,
    url: () => {
      const q = new URLSearchParams();
      if (data.selectedRunId) q.set("run", data.selectedRunId);
      return `/api/duos/${data.duo.id}/sessions/${data.payload.session.id}/refresh${q.size ? `?${q}` : ""}`;
    },
    consumer: "session",
  });
  const p = $derived(live.current);
  const stream = getDuoStream();
  const pendingWork = getPendingWork();

  // Paged run history: page one comes with the payload; older pages load on demand and are dropped on reset.
  let older = $state.raw<{ base: SessionRunsPage; rows: RunTimelineRow[]; nextCursor: string | null } | null>(null);
  let generation = 0;
  const runsPage = $derived(p.runs);
  const runRows = $derived(older && older.base === runsPage ? [...runsPage.rows, ...older.rows] : runsPage.rows);
  const nextCursor = $derived(older && older.base === runsPage ? older.nextCursor : runsPage.nextCursor);
  const manualCurrent = $derived(
    p.wb.learnings.filter(
      (l) =>
        l.origin === "manual" &&
        l.status === "current" &&
        l.sessionIds.includes(p.session.id) &&
        (l.utteranceIds.length > 0 || l.roundIds.length > 0),
    ).length,
  );
  const timeline = $derived<RunTimeline>({
    sessionId: p.session.id,
    rows: runRows,
    noOps: [],
    manualCurrent,
    pinnedRun: runsPage.pinnedRun,
    selectedRunId: data.selectedRunId,
    pinMissing: data.pinMissing,
  });

  async function loadMore() {
    if (!nextCursor) return;
    const gen = generation;
    const base = runsPage;
    const res = await fetch(`/api/duos/${duoId}/sessions/${p.session.id}/runs?cursor=${encodeURIComponent(nextCursor)}`);
    if (!res.ok || gen !== generation || base !== runsPage) return;
    const page = (await res.json()) as SessionRunsPage;
    older = { base, rows: [...(older && older.base === base ? older.rows : []), ...page.rows], nextCursor: page.nextCursor };
  }
  function resetRuns() {
    generation += 1;
    older = null;
  }

  // Live statuses: heartbeats, with a committed stop winning over cached heartbeats.
  let liveStatuses = $state(untrack(() => data.payload.wb.liveStatuses));
  const stopped = $derived(new Set(p.session.stoppedRecordingIds));
  const recording = $derived(
    liveStatuses.some((s) => s.recording && s.recordingId && !stopped.has(s.recordingId) && p.session.recordingIds.includes(s.recordingId)),
  );
  const workerOnline = $derived(pendingWork?.workerOnline ?? p.wb.processing.workerOnline);

  let sessionRevealed = $state(false);
  let revealedLearningIds = $state<Record<string, boolean>>({});
  let manualOpen = $state(false);
  let manualPrefill = $state<ManualPrefill>({});
  let fixing = $state<string | null>(null);
  let fixError = $state<string | null>(null);

  async function fix(wr: SessionPayload["session"]["workRanges"][number]) {
    const key = `${wr.purpose}:${wr.startUtc}`;
    fixing = key;
    fixError = null;
    try {
      const res = await fetch(`/api/duos/${duoId}/processing-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: p.session.id, purpose: wr.purpose, startUtc: wr.startUtc, endUtc: wr.endUtc }),
      });
      if (!res.ok) {
        if (res.status === 503) void pendingWork?.refresh();
        fixError = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not queue this range.";
      }
      await live.refresh();
    } finally {
      fixing = null;
    }
  }

  onMount(() => {
    const stopPoll = pendingWork?.watchWorker();
    const off = stream?.subscribe((batch) => {
      for (const hb of heartbeats(batch)) liveStatuses = [...liveStatuses.filter((s) => s.playerId !== hb.playerId), hb];
      if (needsRefresh("session-runs", batch)) resetRuns();
    });
    if (data.selectedRunId) {
      void tick().then(() => document.getElementById(`run-${data.selectedRunId}`)?.scrollIntoView({ block: "center" }));
    }
    return () => {
      off?.();
      stopPoll?.();
    };
  });
</script>

<svelte:head><title>{sessionTitle(p.session)} · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <a href={links.sessions(duoId)} data-testid="back-link" class="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">← Sessions</a>
  <header class="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">{sessionTitle(p.session)}</h1>
    <div class="flex flex-wrap items-center gap-1.5 text-xs" data-testid="session-games">
      <span class="text-[var(--muted)]">{p.session.micCount} mic{p.session.micCount === 1 ? "" : "s"} · {p.session.ended ? "Ended" : "Active / recent"}</span>
      {#if recording}<span class="rounded-full bg-[var(--ok-bg)] px-2 py-0.5 text-[var(--ok)]">recording</span>{/if}
      {#each p.games as g (g.id)}
        <EntityChip kind="game" label={gameTitle(g)} href={entityHref({ kind: "game", duoId, id: g.id })} />
      {/each}
      {#if p.relatedGames.length > 0}
        <span class="ml-2 font-semibold text-[var(--muted)]">Related by citation:</span>
        {#each p.relatedGames as g (g.id)}
          <EntityChip kind="game" label={gameTitle(g)} href={entityHref({ kind: "game", duoId, id: g.id })} />
        {/each}
      {/if}
    </div>
  </header>
  {#if live.missing}
    <p role="status" data-testid="entity-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Session no longer exists.
    </p>
  {/if}

  {#each p.session.workRanges as wr (`${wr.purpose}:${wr.startUtc}`)}
    {@const key = `${wr.purpose}:${wr.startUtc}`}
    {@const jobs = p.wb.processing.rangeJobs[`${p.session.id}:${wr.purpose}:${wr.startUtc}`] ?? { running: 0, queued: 0, failed: null }}
    {@const active = jobs.running > 0 || jobs.queued > 0}
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--warn-bg)] px-3 py-1.5 text-xs text-[var(--warn)]" data-testid="work-range">
      <span>{wr.purpose}: {new Date(wr.startUtc).toLocaleTimeString()} – {new Date(wr.endUtc).toLocaleTimeString()} ({wr.reason})</span>
      <button
        type="button"
        data-testid="work-range-action"
        class="rounded-md bg-[var(--warn)] px-2.5 py-1 font-semibold text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={active || recording || fixing === key || !workerOnline}
        title={!workerOnline ? "The processing worker is offline" : recording ? "Stop recording before processing this Session" : undefined}
        onclick={() => fix(wr)}
      >
        {#if jobs.running > 0}Processing…{:else if jobs.queued > 0}Queued{:else if !workerOnline}Worker offline{:else if jobs.failed}Retry{:else if wr.reason === "stale"}Fix{:else}Process{/if}
      </button>
    </div>
  {/each}
  {#if fixError}<p class="text-xs text-[var(--danger)]" role="alert">{fixError}</p>{/if}

  <div class="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
    <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <TranscriptTimeline
        wb={p.wb}
        session={p.session}
        revealed={sessionRevealed}
        {revealedLearningIds}
        onReveal={() => (sessionRevealed = true)}
        onSaved={live.refresh}
        onAddLearning={(prefill) => {
          manualPrefill = prefill;
          manualOpen = true;
        }}
      />
    </div>
    <div class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <RunTimelineView
        {timeline}
        {duoId}
        playerName={(id) => (id ? (p.wb.players[id]?.displayName ?? "Player") : "Player")}
        hasMore={nextCursor !== null}
        onLoadMore={loadMore}
        onRefresh={() => {
          resetRuns();
          void live.refresh();
        }}
      />
    </div>
  </div>

  <ManualLearningModal
    bind:open={manualOpen}
    {duoId}
    games={p.session.gameIds.flatMap((id) => (p.wb.gamesById[id] ? [p.wb.gamesById[id]!] : []))}
    roundsById={p.wb.roundsById}
    prefill={manualPrefill}
    onSaved={live.refresh}
  />
</main>
