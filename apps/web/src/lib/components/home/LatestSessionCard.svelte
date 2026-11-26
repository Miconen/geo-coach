<script lang="ts">
  // Duo Home (#84): the latest Session in one glance, linking into its debrief.
  import type { HomeLatest } from "$lib/server/home.js";
  import { formatSigned } from "$lib/stats/overview-text.js";
  import { flagEmoji } from "$lib/stats/players-text.js";

  let { latest }: { latest: HomeLatest } = $props();
  // UTC, so the server and the browser render the same text (as entity-titles does).
  const when = $derived(
    `${new Date(latest.startedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${latest.startedAt.slice(11, 16)}`,
  );
</script>

<a href={latest.href} class="group block space-y-1.5" data-testid="home-latest-session">
  <p class="flex items-baseline gap-2">
    <span class="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Last Session</span>
    <span class="text-xs text-[var(--muted)]">{when}</span>
  </p>
  <p class="flex flex-wrap items-baseline gap-x-3">
    <span class="text-2xl font-black tabular-nums"
      ><span class="text-[var(--ok)]">{latest.won}</span>–<span class="text-[var(--danger)]">{latest.lost}</span></span
    >
    <span class="text-lg font-bold tabular-nums {latest.ratingDelta >= 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}"
      >{formatSigned(latest.ratingDelta)}</span
    >
    <span class="text-xs text-[var(--muted)]">{latest.rounds} Rounds · {latest.learnings} Learnings</span>
  </p>
  {#if latest.missed.length}
    <p class="flex flex-wrap items-center gap-1 text-xs">
      <span class="text-[var(--muted)]">Missed</span>
      {#each latest.missed.slice(0, 8) as m (m.code)}
        <span class="rounded bg-[var(--surface-hover)] px-1" title={m.name}>{flagEmoji(m.code)}{m.count > 1 ? ` ×${m.count}` : ""}</span>
      {/each}
      {#if latest.missed.length > 8}<span class="text-[var(--muted)]">+{latest.missed.length - 8}</span>{/if}
    </p>
  {/if}
  <p class="text-xs font-semibold text-[var(--accent)] group-hover:underline">Open the debrief →</p>
</a>
