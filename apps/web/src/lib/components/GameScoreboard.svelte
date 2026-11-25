<script lang="ts">
  // A Game's result line (#56 2a token table: status badges, never chips).
  import type { WorkbenchGame } from "$lib/server/workbench/view-model.js";

  let { game }: { game: Omit<WorkbenchGame, "roundIds" | "sessionIds"> } = $props();
</script>

<div class="flex flex-wrap items-center gap-2 text-xs" data-testid="game-scoreboard">
  {#if game.won !== null}
    <span
      class="rounded-full px-2.5 py-0.5 font-semibold {game.won
        ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
        : 'bg-[var(--danger-bg)] text-[var(--danger)]'}">{game.won ? "Win" : "Loss"}</span
    >
  {/if}
  {#if game.duoFinalHealth !== null || game.opponentFinalHealth !== null}
    <span class="mono text-[var(--muted)]">HP {game.duoFinalHealth ?? "?"} – {game.opponentFinalHealth ?? "?"}</span>
  {/if}
  {#if game.duoRatingBefore !== null || game.duoRatingAfter !== null}
    <span class="mono text-[var(--muted)]">
      {game.duoRatingBefore ?? "?"} → {game.duoRatingAfter ?? "?"}{#if game.ratingDelta !== null}
        ({game.ratingDelta >= 0 ? "+" : ""}{game.ratingDelta}){/if}
    </span>
  {/if}
  <span class="text-[var(--muted)]">{game.roundCount} Rounds · {game.micCount} mic{game.micCount === 1 ? "" : "s"}</span>
</div>
