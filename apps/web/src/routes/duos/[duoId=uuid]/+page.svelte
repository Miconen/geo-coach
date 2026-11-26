<script lang="ts">
  // Duo Home (#84): lookup first, on the shared map. A "What do we know about…" country search with the countries
  // we got wrong lately as chips. A picked country shows its dossier and focuses only the Rounds we missed there.
  // With nothing picked, the panel holds the latest Session card, the open Study items and the rating trend.
  // Recall hides the map's answers, but not the chips or the dossier: Home is for studying, not quizzing.
  import LatestSessionCard from "$lib/components/home/LatestSessionCard.svelte";
  import RatingSparkline from "$lib/components/home/RatingSparkline.svelte";
  import { matchCountries } from "$lib/country-search.js";
  import { getSharedMap, mapSlot, useMapScene } from "$lib/map/shared-map.svelte.js";
  import { recall } from "$lib/recall.svelte.js";
  import { formatSigned } from "$lib/stats/overview-text.js";
  import { flagEmoji } from "$lib/stats/players-text.js";
  import { pushQuery, viewParams } from "$lib/url-state.js";
  import { readParam, setParam } from "$lib/view-url.js";

  let { data } = $props();
  const home = $derived(data.home);
  const map = getSharedMap();

  // The pick is shallow view state (ADR 0007, #73): ?look=, read through viewParams so Back and reload restore it.
  const look = $derived(readParam(viewParams(), "look", (v) => /^[A-Za-z]{2}$/.test(v))?.toUpperCase() ?? null);
  const dossier = $derived(home.dossiers.find((d) => d.code === look) ?? null);

  /** Picking (or clearing) a country is a focus change: it adds a history entry, so Back undoes it. */
  function pick(code: string | null) {
    query = "";
    pushQuery((params) => setParam(params, "look", code));
  }

  let query = $state("");
  const matches = $derived(matchCountries(home.dossiers, query));
  let revealed = $state(false);
  const mistakeRoundIds = $derived(home.mistakes.flatMap((m) => m.roundIds));
  const narrow = $derived(map.size.width > 0 && map.size.width < 900);

  useMapScene(map, () => {
    const ids = new Set(dossier ? dossier.roundIds : mistakeRoundIds);
    const rounds = home.rounds.filter((r) => ids.has(r.id));
    return {
      header: dossier ? `${dossier.name} · ${dossier.roundsPlayed} Rounds` : `Wrong lately · ${ids.size} Rounds`,
      sub: dossier ? `${dossier.missedRoundIds.length} missed, in focus` : undefined,
      rounds,
      // A country's dossier focuses only the Rounds we missed there: where we went instead. The rest stay answer pins.
      focusRoundIds: dossier ? dossier.missedRoundIds : [],
      guessPins: "none",
      kmLabels: false,
      masked: recall.on && !revealed,
      onReveal: () => (revealed = true),
      padding: narrow ? { top: 150, bottom: 40, left: 20, right: 20 } : { top: 150, bottom: 40, left: 40, right: 480 },
      legend: "bottom-left",
      onCountryClick: (code) => {
        if (home.dossiers.some((d) => d.code === code)) pick(code);
      },
    };
  });

  const kindLabel: Record<string, string> = {
    clue: "Clue",
    distinguisher: "Distinguisher",
    mistake: "Mistake",
    strategy: "Strategy",
    study: "Study",
    other: "Other",
  };
  const panel = "rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] shadow-xl backdrop-blur";
</script>

<svelte:head><title>{dossier ? `${dossier.name} · ${data.duo.name}` : data.duo.name}</title></svelte:head>

<main class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] py-3">
  {#if data.missing.length > 0}
    <p role="status" data-testid="home-missing" class="mb-2 rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      {data.missing.includes("run") ? "That run" : "That Learning"} no longer exists.
    </p>
  {/if}

  <div class="relative h-[calc(100dvh-88px)] min-h-[560px] overflow-hidden rounded-xl" use:mapSlot={map} data-testid="home-map">
    <div class="absolute inset-x-3 top-14 z-20 space-y-1.5 lg:left-3 lg:right-[476px] lg:mx-auto lg:max-w-[560px]">
      <div class="relative">
        <label for="home-search" class="sr-only">What do we know about a country</label>
        <input
          id="home-search"
          bind:value={query}
          type="search"
          autocomplete="off"
          placeholder="What do we know about… (a country)"
          data-testid="home-search"
          class="w-full rounded-xl border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 py-2.5 text-base shadow-xl outline-none backdrop-blur focus:border-[var(--accent)]"
          onkeydown={(e) => {
            if (e.key === "Enter" && matches[0]) pick(matches[0].code);
            else if (e.key === "Escape") query = "";
          }}
        />
        {#if matches.length}
          <ul class="absolute inset-x-0 top-full z-30 mt-1 p-1 {panel}" data-testid="home-search-results">
            {#each matches as d (d.code)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                  onclick={() => pick(d.code)}
                >
                  {flagEmoji(d.code)}
                  {d.name}<span class="ml-auto text-xs text-[var(--muted)]">{d.roundsPlayed} Rounds · {d.learnings.length} Learnings</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if query.trim()}
          <p class="absolute inset-x-0 top-full z-30 mt-1 px-3 py-2 text-sm text-[var(--muted)] {panel}">No country we've played matches.</p>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-1" data-testid="home-wrong-lately">
        <span class="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/85">Wrong lately</span>
        {#each home.mistakes.slice(0, 10) as m (m.code)}
          <button
            type="button"
            aria-pressed={dossier?.code === m.code}
            data-testid="home-mistake"
            data-code={m.code}
            class="rounded-full px-2 py-0.5 text-xs shadow {dossier?.code === m.code
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] hover:bg-[var(--surface-hover)]'}"
            onclick={() => pick(dossier?.code === m.code ? null : m.code)}
            >{flagEmoji(m.code)} {m.name} <span class={dossier?.code === m.code ? "" : "text-[var(--danger)]"}>{m.count}×</span></button
          >
        {:else}
          <span class="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white/85">Nothing missed in the last 30 days of play.</span>
        {/each}
      </div>
    </div>

    <aside
      class="absolute inset-x-3 bottom-24 z-10 max-h-[40%] space-y-3 overflow-y-auto p-4 lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-14 lg:max-h-none lg:w-[440px] {panel}"
      data-testid="home-panel"
    >
      {#if dossier}
        <div class="flex items-start gap-2" data-testid="home-dossier" data-code={dossier.code}>
          <h1 class="text-lg font-bold">{flagEmoji(dossier.code)} {dossier.name}</h1>
          <button
            type="button"
            class="ml-auto text-lg leading-none text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Clear {dossier.name}"
            onclick={() => pick(null)}>×</button
          >
        </div>
        <dl class="grid grid-cols-4 gap-2 text-center">
          <div><dt class="text-[10px] uppercase text-[var(--muted)]">Rounds</dt><dd class="font-bold">{dossier.roundsPlayed}</dd></div>
          <div>
            <dt class="text-[10px] uppercase text-[var(--muted)]">Missed</dt>
            <dd class="font-bold {dossier.missCount > 0 ? 'text-[var(--danger)]' : ''}">{dossier.missCount}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase text-[var(--muted)]">Avg score</dt>
            <dd class="font-bold">{dossier.avgScore === null ? "–" : Math.round(dossier.avgScore).toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase text-[var(--muted)]">Net HP</dt>
            <dd class="font-bold {dossier.netHpDelta >= 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}">{formatSigned(dossier.netHpDelta)}</dd>
          </div>
        </dl>
        <section>
          <h2 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            What we know · {dossier.learnings.length} Learnings · {dossier.claimCount} Claims
          </h2>
          <ul class="space-y-1.5 text-sm">
            {#each dossier.learnings as l (l.id)}
              <li class="rounded-md bg-[var(--surface-hover)] px-2 py-1">
                <span class="mr-1 text-[10px] font-semibold uppercase text-[var(--muted)]">{kindLabel[l.kind] ?? l.kind}</span>{l.text}
              </li>
            {:else}
              <li class="text-xs text-[var(--muted)]">No Learning about {dossier.name} yet.</li>
            {/each}
          </ul>
        </section>
        <a href={dossier.reviewHref} class="block text-xs font-semibold text-[var(--accent)] hover:underline" data-testid="home-dossier-review"
          >Everything about {dossier.name} in Review →</a
        >
      {:else}
        <h1 class="sr-only">{data.duo.name}</h1>
        {#if home.latest}
          <LatestSessionCard latest={home.latest} />
        {:else}
          <p class="text-xs text-[var(--muted)]">No Sessions yet.</p>
        {/if}
        <section class="border-t border-[var(--border)] pt-3" data-testid="home-study">
          <h2 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">To study · {home.study.length}</h2>
          <ul class="space-y-1 text-sm">
            {#each home.study as s (s.id)}
              <li><a href={s.href} class="hover:underline">☐ {s.text}</a></li>
            {:else}
              <li class="text-xs text-[var(--muted)]">Nothing to study.</li>
            {/each}
          </ul>
        </section>
        <section class="border-t border-[var(--border)] pt-3"><RatingSparkline points={home.rating} /></section>
      {/if}
    </aside>
  </div>
</main>
