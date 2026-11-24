<script lang="ts">
  // A Session's run history (#56 0b): what each Processing run wrote, in surviving counts. Run ids and counts
  // only, never Learning text, so it sits outside the Recall gate.
  import type { RunTimeline, RunTimelineRow } from "$lib/server/workbench/run-timeline.js";
  import { links } from "$lib/links.js";

  let {
    timeline,
    duoId,
    playerName,
    hasMore = false,
    onLoadMore,
    onRefresh,
  }: {
    timeline: RunTimeline;
    duoId: string;
    playerName: (playerId: string | null) => string;
    /** Paged history (Session page): another page exists. */
    hasMore?: boolean;
    onLoadMore?: () => void;
    /** "Refresh history": refetches page one. */
    onRefresh?: () => void;
  } = $props();

  let showOlder = $state(false);
  const VISIBLE = 8;

  const STATUS_LABEL: Record<RunTimelineRow["status"], string> = {
    queued: "queued",
    starting: "starting",
    open: "open",
    finished: "finished",
    abandoned: "abandoned",
    failed: "failed",
    cancelled: "cancelled",
    "run-removed": "succeeded, run removed",
  };

  const shortId = (id: string) => id.slice(-6);
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : "");
  const runLink = (runId: string) => links.session(duoId, timeline.sessionId, { run: runId });

  const visibleRows = $derived(showOlder ? timeline.rows : timeline.rows.slice(0, VISIBLE));

  function countText(label: string, c: { current: number; surviving: number }, draft: boolean) {
    if (draft) return `${label}: ${c.surviving} draft`;
    return `${label}: ${c.current} current of ${c.surviving} surviving`;
  }
</script>

{#snippet row(r: RunTimelineRow, pinnedLabel: string | null)}
  {#if r.noOpCount}
  <li class="text-xs text-[var(--muted)]" data-testid="noop-row" data-purpose={r.purpose}>
    {r.purpose}: {r.noOpCount} request{r.noOpCount === 1 ? "" : "s"} already up to date
  </li>
  {:else}
  <li
    id={r.runId ? `run-${r.runId}` : undefined}
    data-testid="run-row"
    data-run-id={r.runId ?? ""}
    data-status={r.status}
    data-selected={r.runId && r.runId === timeline.selectedRunId ? "1" : undefined}
    class="rounded-lg border px-3 py-2 text-xs {r.runId && r.runId === timeline.selectedRunId
      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
      : 'border-[var(--border)]'}"
  >
    <div class="flex flex-wrap items-center gap-2">
      {#if pinnedLabel}
        <span class="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-semibold">{pinnedLabel}</span>
      {/if}
      <span class="mono font-semibold">{r.purpose}</span>
      <span class="rounded-full border border-[var(--border-strong)] px-2 py-0.5" data-testid="run-status"
        >{STATUS_LABEL[r.status]}</span
      >
      {#if r.draft && (r.status === "open" || r.status === "abandoned")}
        <span class="text-[var(--muted)]">outputs are drafts</span>
      {/if}
      <span class="text-[var(--muted)]">
        {time(r.rangeStart)} – {time(r.rangeEnd)}
        {#if r.model}· {r.model}{/if}
        · {playerName(r.playerId)}
        {#if r.finishedAt}· finished {time(r.finishedAt)}{/if}
      </span>
      {#if r.runId}
        <a class="ml-auto text-[var(--accent)] underline" href={runLink(r.runId)}>run {shortId(r.runId)}</a>
      {/if}
    </div>
    {#if r.error}
      <div class="mt-1 text-[var(--warn)]" role="alert">{r.error}</div>
    {/if}
    {#if r.runId}
      <div class="mt-1 flex flex-wrap gap-x-3 text-[var(--muted)]" data-testid="run-counts">
        {#if r.learnings}<span>{countText("Learnings", r.learnings, r.draft)}</span>{/if}
        {#if r.callLabels}<span>{countText("Call labels", r.callLabels, r.draft)}</span>{/if}
        <span>Claims created: {r.claimsCreated}</span>
        <span>Existing Claims with new Evidence: {r.claimsWithNewEvidence}</span>
      </div>
      {#each r.supersededBy as s}
        <div class="mt-1 text-[var(--muted)]" data-testid="run-superseded">
          Superseded by run
          <a class="text-[var(--accent)] underline" href={runLink(s.runId)}>{shortId(s.runId)}</a>:
          {s.displaced} output{s.displaced === 1 ? "" : "s"} displaced{s.replacementOutputs === 0
            ? ", no replacement output"
            : ""}
        </div>
      {/each}
    {/if}
  </li>
  {/if}
{/snippet}

<section class="space-y-2" data-testid="run-timeline" aria-label="Run history">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Run history</h3>
    <span class="flex items-center gap-2">
      {#if timeline.manualCurrent > 0}
        <span class="text-xs text-[var(--muted)]" data-testid="manual-row">Manual: {timeline.manualCurrent} current</span>
      {/if}
      {#if onRefresh}
        <button type="button" class="text-xs text-[var(--accent)] underline" data-testid="refresh-history" onclick={onRefresh}
          >Refresh history</button
        >
      {/if}
    </span>
  </div>
  {#if timeline.pinMissing}
    <div class="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-xs" role="status">
      That run no longer exists.
    </div>
  {/if}
  <ul class="space-y-1.5">
    {#if timeline.pinnedRun}
      {@render row(timeline.pinnedRun, "Linked")}
    {/if}
    {#each visibleRows as r (r.key)}
      {@render row(r, null)}
    {/each}
  </ul>
  {#if timeline.rows.length === 0 && !timeline.pinnedRun}
    <div class="text-xs text-[var(--muted)]">No runs yet for this Session.</div>
  {/if}
  {#if timeline.rows.length > VISIBLE}
    <button
      type="button"
      class="text-xs text-[var(--accent)] underline"
      onclick={() => (showOlder = !showOlder)}
    >
      {showOlder ? "Show fewer" : `Show ${timeline.rows.length - VISIBLE} older`}
    </button>
  {/if}
  {#if hasMore && onLoadMore}
    <button type="button" class="text-xs text-[var(--accent)] underline" data-testid="load-more-runs" onclick={onLoadMore}>
      Load older runs
    </button>
  {/if}
  {#each timeline.noOps as n}
    <div class="text-xs text-[var(--muted)]" data-testid="noop-row">
      {n.purpose}: {n.count} request{n.count === 1 ? "" : "s"} already up to date
    </div>
  {/each}
</section>
