<script lang="ts">
  import EntityChip from "$lib/components/EntityChip.svelte";
  import { entityHref } from "$lib/links.js";
  import { gameTitle, sessionTitle } from "$lib/entity-titles.js";

  let { data } = $props();
</script>

<svelte:head><title>Sessions · {data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1400px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <h1 class="text-base font-bold tracking-tight">Sessions</h1>
  {#if data.sessions.length === 0}
    <p class="text-sm text-[var(--muted)]">No recorded Sessions yet.</p>
  {/if}
  <ul class="space-y-2">
    {#each data.sessions as { session, games } (session.id)}
      <li class="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" data-testid="sessions-index-row">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <EntityChip kind="session" label={sessionTitle(session)} href={entityHref({ kind: "session", duoId: data.duo.id, id: session.id })} />
          <span class="text-[var(--muted)]">{session.micCount} mic{session.micCount === 1 ? "" : "s"} · {session.ended ? "Ended" : "Active / recent"}</span>
          {#if session.extractWorkCount > 0}
            <span class="rounded-full bg-[var(--warn-bg)] px-2 py-0.5 text-[var(--warn)]">{session.extractWorkCount} to process</span>
          {/if}
        </div>
        {#if games.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each games as g (g.id)}
              <EntityChip kind="game" label={gameTitle(g)} href={entityHref({ kind: "game", duoId: data.duo.id, id: g.id })} />
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</main>
