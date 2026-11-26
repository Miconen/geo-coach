<script lang="ts">
  // Games list (#81): the shared map fills the page, with one floating column of compact Game rows grouped by
  // Session (or, with no one recording, by day), newest first. The map has an answer pin for every listed Game's
  // Rounds; hovering a row lights that Game's Rounds and shows its guesses, hovering a group header lights the
  // whole group. Hovering never moves the camera. Rows are plain links to the Game page.
  import { goto } from "$app/navigation";
  import { getSharedMap, mapSlot, useMapScene } from "$lib/map/shared-map.svelte.js";
  import { recall } from "$lib/recall.svelte.js";
  import { dayLabel, ratingTone, resultLetter, resultTone, sessionLabel, signed } from "$lib/games-list-format.js";

  let { data } = $props();
  const list = $derived(data.list);
  const map = getSharedMap();
  let lit = $state<string[] | null>(null);
  let revealed = $state(false);

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  useMapScene(map, () => ({
    header: `${plural(list.gameCount, "Game")} · ${plural(list.sessionCount, "Session")}`,
    sub: list.unrecordedDays > 0 ? `All time · ${plural(list.unrecordedDays, "more day")} not recorded` : "All time",
    rounds: list.rounds,
    focusRoundIds: [],
    highlight: lit ? { gameIds: lit } : null,
    guessPins: "highlighted",
    masked: recall.on && !revealed,
    onReveal: () => (revealed = true),
    onRoundClick: (id) => {
      const href = list.roundHrefs[id];
      if (href) void goto(href);
    },
    padding: { top: 72, bottom: 48, left: 400, right: 48 },
    legend: "bottom-right",
  }));
</script>

<svelte:head><title>Games · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] py-3">
  <h1 class="sr-only">Games</h1>
  <div class="h-[calc(100dvh-76px)] min-h-[480px] overflow-hidden rounded-xl" use:mapSlot={map} data-testid="games-map">
    <nav
      class="absolute bottom-12 left-3 top-[4.5rem] z-10 w-[min(340px,calc(100%-24px))] overflow-y-auto rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] p-1.5 shadow-xl backdrop-blur"
      aria-label="Games"
      onmouseleave={() => (lit = null)}
      data-testid="games-list"
    >
      {#if list.groups.length === 0}
        <p class="p-2 text-sm text-[var(--muted)]">No ranked Games synced yet.</p>
      {/if}
      {#each list.groups as group (group.key)}
        <section class="mb-1.5" data-testid="games-group" data-group-key={group.key}>
          <header
            class="sticky top-0 z-[1] flex items-center gap-2 rounded-md bg-[var(--surface)] px-2 py-1 text-[11px]"
            role="group"
            aria-label={group.href ? "Session" : "Day not recorded"}
            onmouseenter={() => (lit = group.games.map((g) => g.id))}
            data-testid="games-group-header"
          >
            {#if group.href}
              <a href={group.href} class="font-semibold hover:underline">{sessionLabel(group.startedAt)}</a>
            {:else}
              <span class="font-semibold">{dayLabel(group.startedAt)} <span class="font-normal text-[var(--muted)]">· not recorded</span></span>
            {/if}
            <span class="ml-auto font-semibold tabular-nums">
              <span class="text-[var(--ok)]">{group.won}</span>–<span class="text-[var(--danger)]">{group.lost}</span>
            </span>
            <span class="w-12 text-right tabular-nums {ratingTone(group.ratingDelta)}">{signed(group.ratingDelta)}</span>
          </header>
          <ul>
            {#each group.games as g (g.id)}
              <li>
                <a
                  href={g.href}
                  class="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-[var(--surface-hover)]"
                  onmouseenter={() => (lit = [g.id])}
                  onfocus={() => (lit = [g.id])}
                  data-testid="games-index-row"
                  data-game-id={g.id}
                >
                  <span class="w-3 font-black {resultTone(g.won)}">{resultLetter(g.won)}</span>
                  <span class="w-14 font-medium">Game {g.number}</span>
                  <span class="text-[var(--muted)]">{plural(g.rounds, "Round")}</span>
                  {#if g.learnings}<span class="text-[var(--muted)]">· {g.learnings} L</span>{/if}
                  <span class="ml-auto w-12 text-right tabular-nums {ratingTone(g.ratingDelta)}">{signed(g.ratingDelta)}</span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </nav>
  </div>
</main>
