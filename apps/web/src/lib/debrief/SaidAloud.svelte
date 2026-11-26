<script lang="ts">
  // Said aloud, not guessed (#80): a Player named the answer country while guessing was on, but neither Duo guess
  // landed there. Quotes those Utterances with their speaker. It gives the answer away, so it stays under Recall.
  import Masked from "$lib/components/Masked.svelte";
  import { LENS_COLORS, playerInk } from "$lib/player-color.js";
  import type { Debrief, DebriefRound } from "./types.js";
  import { clock } from "./view.js";

  let { debrief, round, revealed }: { debrief: Debrief; round: DebriefRound; revealed: boolean } = $props();

  const ink = (id: string) => playerInk(debrief.players[id]?.color ?? "#60a5fa");
</script>

{#if round.saidAloud.length}
  <Masked {revealed} block>
    <section
      class="rounded-lg border p-2 text-xs"
      style="border-color:{LENS_COLORS.saidAloud}; background:color-mix(in srgb, {LENS_COLORS.saidAloud} 10%, transparent)"
      data-testid="said-aloud"
    >
      <h3 class="mb-1 text-[11px] font-semibold uppercase" style="color:{playerInk(LENS_COLORS.saidAloud)}">Said aloud, not guessed</h3>
      <ul class="space-y-1">
        {#each round.saidAloud as l (l.id)}
          <li>
            <span class="tabular-nums text-[var(--muted)]">{clock(l.atS)}</span>
            <span class="font-semibold" style="color:{ink(l.playerId)}">{debrief.players[l.playerId]?.name ?? "Player"}</span>
            <q class="italic">{l.text}</q>
          </li>
        {/each}
      </ul>
    </section>
  </Masked>
{/if}
