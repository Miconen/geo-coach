<script lang="ts">
  // Home (#56 3a): the Duo's latest Games and Sessions as chips and the ways in; no Learning or Claim text, so
  // nothing here needs a Recall mask.
  import EntityChip from "$lib/components/EntityChip.svelte";
  import { gameTitle, sessionTitle } from "$lib/entity-titles.js";
  import { links } from "$lib/links.js";

  let { data } = $props();
  const duoId = $derived(data.duo.id);
  const ways = $derived([
    { label: "Review", hint: "Learnings to go over", href: links.review(duoId), testid: "home-review" },
    { label: "Knowledge", hint: "Claims and Sources", href: links.knowledge(duoId), testid: "home-knowledge" },
    { label: "Stats", hint: "Results over time", href: links.stats(duoId), testid: "home-stats" },
  ]);
</script>

<svelte:head><title>{data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[1100px] space-y-3 px-[clamp(16px,3vw,64px)] py-4">
  <header class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
    <h1 class="text-base font-bold tracking-tight">{data.duo.name}</h1>
  </header>
  {#if data.missing.length > 0}
    <p role="status" data-testid="home-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      {data.missing.includes("run") ? "That run" : "That Learning"} no longer exists.
    </p>
  {/if}

  <nav aria-label="Duo pages" class="grid gap-2 sm:grid-cols-3">
    {#each ways as w (w.label)}
      <a href={w.href} data-testid={w.testid} class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:border-[var(--accent)]">
        <span class="block text-sm font-semibold">{w.label}</span>
        <span class="text-xs text-[var(--muted)]">{w.hint}</span>
      </a>
    {/each}
  </nav>

  <section class="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="home-games">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
      Latest Games · <a class="normal-case text-[var(--accent)] hover:underline" href={links.games(duoId)}>all</a>
    </h2>
    <div class="flex flex-wrap gap-1.5">
      {#each data.home.games as g (g.id)}
        <EntityChip kind="game" label={gameTitle(g)} href={links.game(duoId, g.id)} />
      {:else}
        <span class="text-xs text-[var(--muted)]">No Games yet.</span>
      {/each}
    </div>
  </section>

  <section class="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" data-testid="home-sessions">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
      Latest Sessions · <a class="normal-case text-[var(--accent)] hover:underline" href={links.sessions(duoId)}>all</a>
    </h2>
    <div class="flex flex-wrap gap-1.5">
      {#each data.home.sessions as s (s.id)}
        <EntityChip kind="session" label={sessionTitle(s)} href={links.session(duoId, s.id)} />
      {:else}
        <span class="text-xs text-[var(--muted)]">No Sessions yet.</span>
      {/each}
    </div>
  </section>
</main>
