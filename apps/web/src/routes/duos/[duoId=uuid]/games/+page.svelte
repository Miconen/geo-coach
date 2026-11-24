<script lang="ts">
  import EntityChip from "$lib/components/EntityChip.svelte";
  import GameScoreboard from "$lib/components/GameScoreboard.svelte";
  import RoundStrip from "$lib/components/RoundStrip.svelte";
  import { entityHref } from "$lib/links.js";
  import { gameTitle } from "$lib/entity-titles.js";

  let { data } = $props();
</script>

<svelte:head><title>Games · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <h1 class="text-base font-bold tracking-tight">Games</h1>
  {#if data.games.length === 0}
    <p class="text-sm text-[var(--muted)]">No ranked Games synced yet.</p>
  {/if}
  <ul class="space-y-2">
    {#each data.games as { game, rounds } (game.id)}
      <li class="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" data-testid="games-index-row">
        <div class="flex flex-wrap items-center gap-2">
          <EntityChip kind="game" label={gameTitle(game)} href={entityHref({ kind: "game", duoId: data.duo.id, id: game.id })} />
          <GameScoreboard {game} />
        </div>
        <RoundStrip duoId={data.duo.id} {rounds} />
      </li>
    {/each}
  </ul>
</main>
