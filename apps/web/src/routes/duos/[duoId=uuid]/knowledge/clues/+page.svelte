<script lang="ts">
  // Clues (#89): the Duo's Clues by family, to rename and merge (a merge moves every Claim and Round link), and Claim
  // tagging: how much of the bank the current tagger prompt has tagged, and a control that queues the next N Claims
  // for the processing worker (100 first, as the test run before the full backfill). Clues taggers created are marked
  // "new" so a Player can review them.
  import { links } from "$lib/links.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import type { CluesPayload } from "$lib/server/entities/clues.js";

  let { data } = $props();
  const duoId = $derived(data.duo.id);
  const live = useEntityRefresh<CluesPayload>({
    base: () => data.payload,
    url: () => `/api/duos/${data.duo.id}/clues`,
    consumer: "knowledge",
  });
  const p = $derived(live.current);

  const families = $derived.by(() => {
    const by = new Map<string, CluesPayload["clues"]>();
    for (const c of p.clues) by.set(c.family, [...(by.get(c.family) ?? []), c]);
    return [...by];
  });
  const active = $derived(p.jobs.filter((j) => j.status === "queued" || j.status === "running"));

  let limit = $state(100);
  let wholeQueue = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let editing = $state<{ id: string; name: string } | null>(null);
  let merging = $state<{ id: string; into: string } | null>(null);

  async function send(url: string, method: string, body: unknown) {
    busy = true;
    error = null;
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.";
      await live.refresh();
      return res.ok;
    } finally {
      busy = false;
    }
  }
  const tag = () => send(`/api/duos/${duoId}/clues`, "POST", { limit: wholeQueue ? null : limit });
  async function rename() {
    if (editing && (await send(`/api/duos/${duoId}/clues/${editing.id}`, "PATCH", { name: editing.name }))) editing = null;
  }
  async function merge() {
    if (merging?.into && (await send(`/api/duos/${duoId}/clues/${merging.id}`, "PATCH", { mergeInto: merging.into }))) merging = null;
  }
  const jobLine = (j: CluesPayload["jobs"][number]) =>
    j.status === "running"
      ? `Tagging up to ${j.claimLimit} Claims…`
      : j.status === "queued"
        ? `Queued: up to ${j.claimLimit} Claims`
        : j.status === "succeeded"
          ? `Tagged ${j.taggedCount} Claims`
          : j.status === "cancelled"
            ? (j.error ?? "Cancelled")
            : (j.error ?? "Failed");

  // What a job ran with and used (#94): Claude Code's own numbers; the cost is what the run would cost at API prices,
  // since the worker runs on a subscription.
  const compact = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const duration = (j: CluesPayload["jobs"][number]) => {
    const ms = j.usage?.durationMs ?? (j.startedAt && j.finishedAt ? Date.parse(j.finishedAt) - Date.parse(j.startedAt) : null);
    if (ms === null) return null;
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  };
  const jobMetrics = (j: CluesPayload["jobs"][number]) => {
    const parts = [j.model ?? "default model", j.promptVersion ?? "prompt version unknown"];
    const took = duration(j);
    if (took && j.finishedAt) parts.push(took);
    if (j.usage) {
      if (j.usage.numTurns !== null) parts.push(`${j.usage.numTurns} turns`);
      parts.push(
        `${compact(j.usage.inputTokens)} in · ${compact(j.usage.outputTokens)} out · ${compact(j.usage.cacheReadTokens)} cache read · ${compact(j.usage.cacheCreationTokens)} cache write`,
      );
    }
    if (j.apiEquivalentCostUsd !== null) parts.push(`$${j.apiEquivalentCostUsd.toFixed(2)} API-equivalent`);
    return parts.join(" · ");
  };
  const tokenTitle = (j: CluesPayload["jobs"][number]) =>
    j.usage?.byModel.map((m) => `${m.model}: ${m.inputTokens} in, ${m.outputTokens} out, ${m.cacheReadTokens} cache read, ${m.cacheCreationTokens} cache write`).join("\n");
</script>

<svelte:head><title>Clues · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1000px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <header class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <a class="text-xs text-[var(--accent)] hover:underline" href={links.knowledge(duoId)}>‹ Knowledge</a>
    <h1 class="text-base font-bold tracking-tight">Clues</h1>
    <p class="mt-0.5 text-[11px] text-[var(--muted)]">
      Each Clue is one visible value in a family. Claims tie Clues to countries as typical, in some areas, or lacking it; the
      Clue lens on a Round reads them. Merging two Clues moves every link to the one you keep.
    </p>
  </header>

  <section class="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs" data-testid="claim-tagging">
    <h2 class="font-semibold uppercase tracking-wide text-[var(--muted)]">Tagging Claims</h2>
    <p data-testid="tagging-progress">
      <span class="font-semibold">{p.progress.tagged.toLocaleString("en-US")}</span> of {p.progress.total.toLocaleString("en-US")} Claims
      tagged with <span class="mono">{p.promptVersion}</span> · {p.progress.queued.toLocaleString("en-US")} in the queue
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1">
        Tag the next
        <input type="number" min="1" bind:value={limit} disabled={wholeQueue} class="w-20 rounded-md border border-[var(--border-strong)] px-1.5 py-0.5" data-testid="tagging-limit" />
        Claims
      </label>
      <label class="flex items-center gap-1"><input type="checkbox" bind:checked={wholeQueue} data-testid="tagging-all" /> the whole queue (backfill)</label>
      <button
        type="button"
        class="rounded-md bg-[var(--accent)] px-2.5 py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || !p.workerOnline || p.progress.queued === 0 || (!wholeQueue && !(limit >= 1))}
        title={!p.workerOnline ? "The processing worker is offline" : undefined}
        data-testid="tagging-start"
        onclick={tag}>{p.workerOnline ? "Queue tagging" : "Worker offline"}</button
      >
    </div>
    {#if error}<p class="text-[var(--danger)]" role="alert">{error}</p>{/if}
    {#if p.jobs.length}
      <ul class="space-y-0.5 text-[11px]" data-testid="tagging-jobs">
        {#each p.jobs.slice(0, active.length + 5) as j (j.id)}
          <li class={j.status === "failed" ? "text-[var(--danger)]" : "text-[var(--muted)]"} data-testid="tagging-job">
            {new Date(j.createdAt).toLocaleString()} ·
            {#if j.trial}<span class="rounded bg-[var(--warn-bg)] px-1 text-[10px] text-[var(--warn)]" title="Tagged into a side store; live links are unchanged until it's promoted">{j.promotedAt ? "trial, promoted" : "trial"}</span>{/if}
            {jobLine(j)}
            <span class="block pl-3 text-[10px] text-[var(--muted)]" title={tokenTitle(j)} data-testid="tagging-job-metrics">{jobMetrics(j)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#each families as [family, clues] (family)}
    <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="clue-family">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{family}</h2>
      <ul class="mt-1 divide-y divide-[var(--border)] text-xs">
        {#each clues as c (c.id)}
          <li class="flex flex-wrap items-center gap-2 py-1" data-testid="clue-row">
            {#if editing?.id === c.id}
              <input bind:value={editing.name} class="min-w-[220px] flex-1 rounded-md border border-[var(--border-strong)] px-1.5 py-0.5" data-testid="clue-name-input" />
              <button type="button" class="font-semibold text-[var(--accent)]" disabled={busy} onclick={rename}>Save</button>
              <button type="button" class="text-[var(--muted)]" onclick={() => (editing = null)}>Cancel</button>
            {:else if merging?.id === c.id}
              <span class="font-semibold">{c.name}</span> into
              <select bind:value={merging.into} class="rounded-md border border-[var(--border-strong)] px-1 py-0.5" data-testid="clue-merge-into">
                <option value="">Pick a Clue</option>
                {#each p.clues.filter((o) => o.id !== c.id) as o (o.id)}
                  <option value={o.id}>{o.family === c.family ? o.name : `${o.family}: ${o.name}`}</option>
                {/each}
              </select>
              <button type="button" class="font-semibold text-[var(--accent)]" disabled={busy || !merging.into} onclick={merge}>Merge</button>
              <button type="button" class="text-[var(--muted)]" onclick={() => (merging = null)}>Cancel</button>
            {:else}
              <span class="font-semibold">{c.name}</span>
              {#if c.origin === "agent"}<span class="rounded bg-[var(--warn-bg)] px-1 text-[10px] text-[var(--warn)]" title="Created by a tagger">new</span>{/if}
              <span class="text-[var(--muted)]">{c.claimCount} Claims · {c.roundCount} Rounds</span>
              <span class="ml-auto flex gap-2">
                <button type="button" class="text-[var(--accent)] hover:underline" onclick={() => ((editing = { id: c.id, name: c.name }), (merging = null))}>Rename</button>
                <button type="button" class="text-[var(--accent)] hover:underline" onclick={() => ((merging = { id: c.id, into: "" }), (editing = null))}>Merge…</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)]">
      No Clues yet. Tagging starts the Duo's Clues from the seed vocabulary.
    </p>
  {/each}
</main>
