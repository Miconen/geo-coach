<script lang="ts">
  // A Game's Rounds inline with their scores (#56 2a token table: Round chips). X7: Round 0 and negative
  // numbers render as plain text, never a link.
  import type { WorkbenchRound } from "$lib/server/workbench/view-model.js";
  import EntityChip from "./EntityChip.svelte";
  import { entityHref } from "$lib/links.js";
  import { roundLabel } from "$lib/entity-titles.js";

  let { duoId, rounds }: { duoId: string; rounds: WorkbenchRound[] } = $props();
</script>

<ol class="flex flex-wrap gap-1.5" data-testid="round-strip">
  {#each rounds as r (r.id)}
    <li class="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs">
      <EntityChip
        kind="round"
        label={roundLabel(r)}
        href={entityHref({ kind: "round", duoId, id: r.id, gameId: r.gameId, roundNumber: r.roundNumber })}
      />
      <span class="mono text-[var(--muted)]">{r.duoBestScore} – {r.opponentBestScore}</span>
      {#if r.hpDelta !== 0}
        <span class="mono {r.hpDelta < 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}">{r.hpDelta > 0 ? "+" : ""}{r.hpDelta} HP</span>
      {/if}
    </li>
  {/each}
</ol>
