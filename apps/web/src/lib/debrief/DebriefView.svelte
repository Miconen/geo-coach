<script lang="ts">
  // The debrief view (#79, variant F of #68): the shared map fills the page and the debrief floats on it. Top left,
  // the scope header with the ‹ n / N › Round stepper; top right, the stat chips; along the bottom, one bar that
  // drills from the Games into a Game's Rounds. A focused Round lives on the map (callouts at its pins, a card on
  // its answer) with its transcript in the right panel; a country opens its own view. The selection is in the URL
  // (selection.ts): focusing pushes, drawers replace, and nothing reruns the page's server load.
  import { onMount, type Snippet } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { fly, slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import LearningRow from "$lib/components/LearningRow.svelte";
  import Masked from "$lib/components/Masked.svelte";
  import { links } from "$lib/links.js";
  import { MAP_STYLE_OPTIONS } from "$lib/map/mapbox-base.js";
  import { getSharedMap, mapSlot, useMapScene } from "$lib/map/shared-map.svelte.js";
  import type { MapScene } from "$lib/map/scene.js";
  import { recall } from "$lib/recall.svelte.js";
  import Damage from "./Damage.svelte";
  import RoundCallouts from "./RoundCallouts.svelte";
  import RoundTranscript from "./RoundTranscript.svelte";
  import { anchoredRoundId, readSelection, select, type DebriefSelection } from "./selection.js";
  import type { Debrief, DebriefGame, DebriefRound, DebriefScope } from "./types.js";
  import {
    countryPopup,
    countryView,
    flag,
    kmTone,
    learningsOf,
    mapRounds,
    missedCountries,
    playerName,
    record,
    resultLetter,
    roundName,
    roundsOf,
    signed,
    stepRound,
  } from "./view.js";

  let {
    debrief,
    duoId,
    title,
    scope = { kind: "session" },
    details,
    defaultDrawer = null,
    back = null,
  }: {
    debrief: Debrief;
    duoId: string;
    /** The scope's own name, first in the header's breadcrumb ("Session 2026-11-23 18:31"). */
    title: string;
    scope?: DebriefScope;
    /** The page's own drawer (the Session's processing and full Transcript), behind a "Details" chip. */
    details?: { label: string; content: Snippet };
    /** The Game bar's back control outside a Session scope (#82): the Game's Session, or the Games list. */
    back?: { label: string; href: string } | null;
    /** The drawer a cold load opens when the URL names none (a ?run= pin opens the details). */
    defaultDrawer?: "learnings" | "details" | null;
  } = $props();

  const map = getSharedMap();
  const sel = $derived(readSelection());
  const gamesById = $derived(new Map(debrief.games.map((g) => [g.id, g])));
  const roundsById = $derived(new Map(debrief.rounds.map((r) => [r.id, r])));
  // Unknown or malformed ids in the URL are ignored.
  const round = $derived<DebriefRound | null>(
    (scope.kind === "round" ? roundsById.get(scope.roundId) : sel.round ? roundsById.get(sel.round) : undefined) ?? null,
  );
  const game = $derived<DebriefGame | null>(
    (scope.kind === "game"
      ? gamesById.get(scope.gameId)
      : scope.kind === "round"
        ? gamesById.get(round?.gameId ?? "")
        : sel.game
          ? gamesById.get(sel.game)
          : undefined) ?? null,
  );
  const country = $derived(sel.country && /^[A-Za-z]{2}$/.test(sel.country) ? countryView(debrief, sel.country) : null);
  // Once the selection lives in page.state, a closed drawer stays closed; only a cold load opens the default.
  const drawerKey = $derived(page.state.query !== undefined ? sel.drawer : (sel.drawer ?? defaultDrawer));
  const drawer = $derived(drawerKey === "learnings" || (drawerKey === "details" && details) ? drawerKey : null);

  const tally = $derived(record(debrief));
  const missed = $derived(missedCountries(debrief.rounds));
  const gameRounds = $derived(game ? roundsOf(debrief, game) : []);
  /** What the stepper walks: the country's Rounds, the Game's, or the whole evening. */
  const seq = $derived(country ? country.rounds : game ? gameRounds : debrief.rounds);
  const at = $derived(round ? seq.findIndex((r) => r.id === round.id) : -1);

  let hoverGame = $state<string | null>(null);
  let hoverRound = $state<string | null>(null);
  let hoverPlayer = $state<string | null>(null);
  let missedOpen = $state(false);
  let pop = $state<{ code: string; lng: number; lat: number; roundId: string } | null>(null);

  // Recall: the scope in view stays masked until revealed. Revealing a Game reveals its Rounds.
  let revealed = $state<Record<string, boolean>>({});
  const scopeKey = $derived(round?.id ?? (country ? `c:${country.code}` : (game?.id ?? "all")));
  const isRevealed = (...keys: string[]) => !recall.on || revealed.all === true || keys.some((k) => revealed[k] === true);
  const masked = $derived(!isRevealed(scopeKey, round?.gameId ?? ""));
  const reveal = () => (revealed = { ...revealed, [scopeKey]: true });

  const go = (patch: Partial<DebriefSelection>, opts?: { replace?: boolean }) => {
    pop = null;
    select(patch, opts);
  };
  const focusRound = (id: string) => {
    const r = roundsById.get(id);
    if (r) go({ round: id, game: country ? sel.game : r.gameId });
  };
  function step(delta: 1 | -1) {
    const id = stepRound(seq, round?.id ?? null, delta);
    if (id) focusRound(id);
  }
  /** Esc: one level up. Round → its Game or country; country or Game → the whole scope. */
  function up() {
    if (pop) pop = null;
    else if (missedOpen) missedOpen = false;
    else if (drawer) go({ drawer: null }, { replace: true });
    else if (round) go({ round: null });
    else if (country) go({ country: null });
    else if (game && scope.kind === "session") go({ game: null });
  }
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "j") step(1);
    else if (e.key === "k") step(-1);
    else if (e.key === "Escape") up();
  }

  // A Round anchor (#round-<id>) focuses that Round instead of scrolling to it. No element here carries a Round's
  // id, so the Duo layout's anchor scrolling (followHash) finds nothing and leaves the map alone.
  function focusAnchor() {
    const id = anchoredRoundId(location.hash);
    const r = id ? roundsById.get(id) : undefined;
    if (r) select({ round: r.id, game: r.gameId, country: null }, { replace: true });
  }
  // After the router is ready (a shallow replace before then throws): the cold load, and each link navigation here.
  afterNavigate(() => void setTimeout(focusAnchor, 0));
  onMount(() => {
    window.addEventListener("hashchange", focusAnchor);
    return () => window.removeEventListener("hashchange", focusAnchor);
  });

  const panelOpen = $derived(round !== null || country !== null);
  const scopeRounds = $derived(scope.kind === "session" && !country ? debrief.rounds : country ? country.rounds : gameRounds);
  useMapScene(map, (): MapScene => {
    const focus = round ? [round.id] : country ? country.rounds.map((r) => r.id) : [];
    return {
      header: "",
      chromeless: true,
      rounds: mapRounds(debrief, scopeRounds),
      focusRoundIds: focus,
      highlight: { gameIds: hoverGame && !game && !country ? [hoverGame] : [], roundId: hoverRound },
      guessPins: game ? "all" : "highlighted",
      labelPins: game !== null || country !== null,
      kmLabels: round === null,
      masked,
      onReveal: reveal,
      padding: { top: round ? 290 : 110, bottom: 120, left: 40, right: panelOpen && !drawer ? 470 : drawer ? 500 : 40 },
      onRoundClick: focusRound,
      onCountryClick: (code, lngLat) => {
        // Inside a Round a click explains the country and keeps the Round; the answer country is the Round itself.
        if (round) {
          pop = code === round.countryCode ? null : { code, ...lngLat, roundId: round.id };
          return;
        }
        if (countryView(debrief, code)) go({ country: code, round: null });
      },
    };
  });

  const popup = $derived.by(() => {
    if (!pop || !round || pop.roundId !== round.id) return null;
    void map.tick;
    const xy = map.project(pop.lng, pop.lat);
    return xy ? { ...countryPopup(debrief, round, pop.code), ...xy } : null;
  });

  const headerTitle = $derived(
    round
      ? roundName(round)
      : country
        ? `${country.name} · ${country.rounds.length} Round${country.rounds.length === 1 ? "" : "s"}`
        : game
          ? `Game ${game.number} · ${game.won ? "Win" : game.won === false ? "Loss" : "–"} ${signed(game.ratingDelta)}`
          : `${debrief.games.length} Game${debrief.games.length === 1 ? "" : "s"} tonight`,
  );
  const tone = (t: string) => (t === "ok" ? "text-[var(--ok)]" : t === "warn" ? "text-[var(--warn)]" : t === "danger" ? "text-[var(--danger)]" : "");
  const signTone = (n: number | null) => (n === null ? "" : n >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]");
  const resultTone = (won: boolean | null) => (won ? "text-[var(--ok)]" : won === false ? "text-[var(--danger)]" : "text-[var(--muted)]");
  const panel = "rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] shadow-xl backdrop-blur";
  const chipBtn = "rounded-md px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]";
</script>

<svelte:window onkeydown={onKey} />

{#snippet km(r: DebriefRound)}
  <span class={tone(kmTone(r.bestKm))}>{r.bestKm === null ? "–" : `${r.bestKm.toLocaleString("en-US")} km`}</span>
{/snippet}

{#snippet countryRounds(heading: string, rs: DebriefRound[], what: (r: DebriefRound) => string, testid: string)}
  {#if rs.length}
    <div data-testid={testid}>
      <h3 class="px-1.5 text-[11px] font-semibold uppercase text-[var(--muted)]">{heading} ({rs.length})</h3>
      <ul class="space-y-0.5 text-xs">
        {#each rs as r (r.id)}
          <li>
            <button type="button" class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--surface-hover)]" onclick={() => focusRound(r.id)}>
              <span class="font-semibold">{roundName(r)}</span>
              <Masked revealed={!masked}><span>{what(r)}</span></Masked>
              <span class="ml-auto"><Masked revealed={!masked} label="">{@render km(r)}</Masked></span>
              <span class="w-14 text-right"><Damage hp={r.hpDelta} /></span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<div class="relative h-[calc(100dvh-4.25rem)] min-h-[560px]" use:mapSlot={map} data-testid="debrief">
  {#if round}
    <RoundCallouts {map} {debrief} {round} {masked} {hoverPlayer} />
  {/if}

  {#if popup && !masked}
    <div
      class="absolute z-20 w-[280px] -translate-x-1/2 translate-y-3 rounded-xl border border-white/20 bg-black/85 p-2.5 text-xs text-white shadow-2xl backdrop-blur"
      style="left:{popup.x}px;top:{popup.y}px"
      data-testid="country-popup"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-base">{flag(popup.code)}</span>
        <span class="font-bold">{popup.name}</span>
        <button type="button" class="ml-auto text-white/60 hover:text-white" aria-label="Close" onclick={() => (pop = null)}>×</button>
      </div>
      {#each popup.guessedBy as g, i (i)}
        <p class="mt-1 text-red-300">✗ {g.isDuo ? playerName(debrief, g) : "An Opponent"} guessed here</p>
      {/each}
      {#if popup.named.length}
        <ul class="mt-1.5 space-y-1">
          {#each popup.named as l (l.id)}
            <li class="rounded-lg bg-yellow-400/10 px-2 py-1 text-yellow-100"><span class="font-semibold uppercase text-yellow-300">{l.kind}</span> {l.text}</li>
          {/each}
        </ul>
      {:else}
        <p class="mt-1 text-white/50">No Learning names {popup.name}.</p>
      {/if}
      {#if popup.hasRounds}
        <button type="button" class="mt-1.5 text-[11px] font-semibold text-sky-300 hover:underline" onclick={() => go({ country: popup.code, round: null })}>
          Every Round with {popup.name} tonight →
        </button>
      {/if}
    </div>
  {/if}

  <!-- Top: the scope header with the stepper, and the stat chips. -->
  <div class="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
    <div class="pointer-events-auto {panel} flex flex-wrap items-center gap-2 px-3 py-2" data-testid="scope-header">
      <div class="min-w-0">
        <nav class="flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]" aria-label="Debrief scope">
          <button type="button" class="hover:underline" onclick={() => go({ game: null, round: null, country: null })}>{title}</button>
          {#if game && scope.kind === "session"}<span>›</span><button type="button" class="hover:underline" onclick={() => go({ round: null, country: null })}>Game {game.number}</button>{/if}
          {#if country}<span>›</span><button type="button" class="hover:underline" onclick={() => go({ round: null })}>{country.name}</button>{/if}
        </nav>
        <p class="text-sm font-bold" data-testid="scope-title">{headerTitle}</p>
      </div>
      <div class="ml-1 flex items-center gap-1 border-l border-[var(--border)] pl-2" data-testid="stepper">
        <button type="button" class="rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-hover)]" title="Previous Round (k)" aria-label="Previous Round" onclick={() => step(-1)}>‹</button>
        <span class="w-16 text-center text-[11px] tabular-nums text-[var(--muted)]" data-testid="stepper-position">{at === -1 ? `${seq.length} Rounds` : `${at + 1} / ${seq.length}`}</span>
        <button type="button" class="rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-hover)]" title="Next Round (j)" aria-label="Next Round" onclick={() => step(1)}>›</button>
      </div>
      {#if masked}
        <button type="button" class="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white" data-testid="debrief-reveal" onclick={reveal}>Reveal</button>
      {/if}
      <div class="flex rounded-lg border border-[var(--border)] p-0.5 text-[11px]" role="group" aria-label="Map style">
        {#each MAP_STYLE_OPTIONS as o (o.value)}
          <button
            type="button"
            aria-pressed={map.style === o.value}
            class="rounded-md px-2 py-0.5 {map.style === o.value ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-soft-ink)]' : 'hover:bg-[var(--surface-hover)]'}"
            onclick={() => (map.style = o.value)}>{o.label}</button
          >
        {/each}
      </div>
    </div>

    <div class="pointer-events-auto flex flex-wrap justify-end gap-1.5" data-testid="stat-chips">
      <div class="{panel} px-3 py-1.5">
        <p class="text-[10px] uppercase text-[var(--muted)]">Record</p>
        <p class="text-lg font-bold leading-tight tabular-nums {tally.won >= tally.lost ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}">{tally.won}–{tally.lost}</p>
      </div>
      <div class="{panel} px-3 py-1.5">
        <p class="text-[10px] uppercase text-[var(--muted)]">Rating</p>
        <p class="text-lg font-bold leading-tight tabular-nums {signTone(tally.ratingDelta)}">{signed(tally.ratingDelta)}</p>
      </div>
      <div class="{panel} px-3 py-1.5">
        <p class="text-[10px] uppercase text-[var(--muted)]">Rounds</p>
        <p class="text-lg font-bold leading-tight tabular-nums">{tally.rounds}</p>
      </div>
      <div class="{panel} px-3 py-1.5">
        <p class="text-[10px] uppercase text-[var(--muted)]">Learnings</p>
        <p class="text-lg font-bold leading-tight tabular-nums">{tally.learnings}</p>
      </div>
      <div class="relative">
        <button
          type="button"
          class="{panel} px-3 py-1.5 text-left hover:bg-[var(--surface-hover)]"
          aria-expanded={missedOpen}
          data-testid="chip-wrong-country"
          onclick={() => (missedOpen = !missedOpen)}
        >
          <p class="text-[10px] uppercase text-[var(--muted)]">Wrong country ▾</p>
          <p class="text-lg font-bold leading-tight tabular-nums">{missed.reduce((n, m) => n + m.rounds.length, 0)}</p>
        </button>
        {#if missedOpen}
          <div transition:slide={{ duration: 150 }} class="absolute right-0 top-full z-30 mt-1 max-h-[50vh] w-[240px] overflow-y-auto {panel} p-1.5" data-testid="missed-list">
            {#if missed.length === 0}
              <p class="px-2 py-1 text-xs text-[var(--muted)]">No answer country missed.</p>
            {:else}
              <Masked revealed={isRevealed("all")} block>
                <ul>
                  {#each missed as m (m.code)}
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] {country?.code === m.code ? 'bg-[var(--accent-soft)]' : ''}"
                        onclick={() => {
                          missedOpen = false;
                          go({ country: m.code, round: null });
                        }}
                      >
                        <span>{flag(m.code)}</span>
                        <span class="truncate">{m.name}</span>
                        {#if m.rounds.length > 1}<span class="ml-auto text-[var(--danger)]">×{m.rounds.length}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              </Masked>
            {/if}
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="{panel} px-3 py-1.5 text-left hover:bg-[var(--surface-hover)]"
        data-testid="chip-learnings"
        aria-pressed={drawer === "learnings"}
        onclick={() => go({ drawer: drawer === "learnings" ? null : "learnings" }, { replace: true })}
      >
        <p class="text-[10px] uppercase text-[var(--muted)]">Read</p>
        <p class="text-sm font-semibold leading-tight">All Learnings</p>
      </button>
      {#if details}
        <button
          type="button"
          class="{panel} px-3 py-1.5 text-left hover:bg-[var(--surface-hover)]"
          data-testid="chip-details"
          aria-pressed={drawer === "details"}
          onclick={() => go({ drawer: drawer === "details" ? null : "details" }, { replace: true })}
        >
          <p class="text-[10px] uppercase text-[var(--muted)]">More</p>
          <p class="text-sm font-semibold leading-tight">{details.label}</p>
        </button>
      {/if}
    </div>
  </div>

  <!-- Right: the focused Round's transcript, or the country's view. -->
  {#if panelOpen && !drawer}
    <aside class="absolute bottom-[110px] right-3 top-[96px] z-10 w-[440px] max-w-[calc(100%-1.5rem)] space-y-2 overflow-y-auto {panel} p-3" data-testid="debrief-panel">
      {#if round}
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="text-sm font-bold">{roundName(round)} · transcript</h2>
            <p class="text-[11px] text-[var(--muted)]">{round.transcript.length} lines</p>
          </div>
          <button type="button" class="text-lg leading-none text-[var(--muted)] hover:text-[var(--ink)]" aria-label="Close" onclick={() => go({ round: null })}>×</button>
        </div>
        <RoundTranscript {debrief} {round} revealed={!masked} onHover={(id) => (hoverPlayer = id)} />
        <h3 class="pt-1 text-[11px] font-semibold uppercase text-[var(--muted)]">Learnings</h3>
        <ul class="space-y-1.5">
          {#each learningsOf(debrief, round.learningIds) as l (l.id)}
            <LearningRow {duoId} learning={l} revealed={!masked} />
          {:else}
            <li class="text-xs text-[var(--muted)]">No Learnings on this Round.</li>
          {/each}
        </ul>
        {@const roundHref = links.round(duoId, round.gameId, round.roundNumber)}
        {#if roundHref}<a class="inline-block text-xs font-semibold text-[var(--accent)] hover:underline" href={roundHref}>Open Round page →</a>{/if}
      {:else if country}
        <div class="flex items-start justify-between gap-2" data-testid="country-card">
          <div>
            <h2 class="text-base font-bold">{flag(country.code)} {country.name}</h2>
            <p class="text-xs text-[var(--muted)]">
              the answer {country.asAnswer.length}× ({country.missed} missed) · our guess {country.asGuess.length}× when it wasn't
            </p>
          </div>
          <button type="button" class="text-lg leading-none text-[var(--muted)] hover:text-[var(--ink)]" aria-label="Close" onclick={() => go({ country: null })}>×</button>
        </div>
        {@render countryRounds(`Answer was ${country.name}`, country.asAnswer, (r) => (r.missedAnswer ? `guessed ${flag(r.bestCountry)}` : "guessed it ✓"), "country-as-answer")}
        {@render countryRounds(`We guessed ${country.name}`, country.asGuess, (r) => `answer ${flag(r.countryCode)} ${r.countryName ?? ""}`, "country-as-guess")}
        <ul class="space-y-1.5">
          {#each country.learnings as l (l.id)}
            <LearningRow {duoId} learning={l} revealed={!masked} />
          {:else}
            <li class="rounded-lg bg-[var(--warn-bg)] px-2 py-1.5 text-xs text-[var(--warn)]">No Learning explains {country.name} yet. A Study gap.</li>
          {/each}
        </ul>
      {/if}
    </aside>
  {/if}

  <!-- Bottom: the Games tonight; a Game opens in the same bar, its Rounds sliding in. Above the map legend. -->
  <div class="absolute inset-x-3 bottom-9 z-10" data-testid="debrief-bar">
    {#if game}
      {#key game.id}
        <div role="group" aria-label="Rounds of Game" class="flex items-stretch gap-1 overflow-x-auto {panel} p-1.5" in:fly={{ y: 16, duration: 220, easing: cubicOut }} onmouseleave={() => (hoverRound = null)}>
          <div class="flex shrink-0 items-center gap-2 border-r border-[var(--border)] pr-2">
            {#if scope.kind === "session"}
              <button type="button" class={chipBtn} data-testid="games-back" onclick={() => go({ game: null, round: null })}>‹ Games</button>
            {:else if back}
              <a class={chipBtn} data-testid="games-back" href={back.href}>‹ {back.label}</a>
            {/if}
            <span class="text-sm font-bold">Game {game.number}</span>
            <span class="text-sm font-black {resultTone(game.won)}">{resultLetter(game.won)}</span>
            <span class="text-xs {signTone(game.ratingDelta)}">{signed(game.ratingDelta)}</span>
          </div>
          {#each gameRounds as r, i (r.id)}
            <button
              type="button"
              in:fly={{ x: 18, duration: 300, delay: 50 + i * 40, easing: cubicOut }}
              class="flex shrink-0 flex-col items-start rounded-lg border px-2.5 py-1 text-left text-xs {round?.id === r.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-transparent hover:bg-[var(--surface-hover)]'}"
              data-testid="round-tile"
              data-round-id={r.id}
              onmouseenter={() => (hoverRound = r.id)}
              onclick={() => focusRound(r.id)}
            >
              <span class="flex items-center gap-1.5">
                <span class="inline-block size-2 rounded-full {r.won ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'}"></span>
                <span class="text-[var(--muted)]">Round {r.roundNumber}</span>
                <Masked revealed={isRevealed(r.id, game.id)} label="?"><span>{flag(r.countryCode)}</span></Masked>
              </span>
              <span class="flex items-center gap-1.5"><Damage hp={r.hpDelta} /><Masked revealed={isRevealed(r.id, game.id)} label="">{@render km(r)}</Masked></span>
            </button>
          {/each}
        </div>
      {/key}
    {:else}
      <div role="group" aria-label="Games" class="flex gap-1.5 overflow-x-auto {panel} p-1.5" onmouseleave={() => (hoverGame = null)} in:fly={{ y: 16, duration: 220, easing: cubicOut }}>
        {#each debrief.games as g (g.id)}
          <button
            type="button"
            class="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]"
            data-testid="game-tile"
            data-game-id={g.id}
            onmouseenter={() => (hoverGame = g.id)}
            onclick={() => go({ game: g.id, round: null, country: null })}
          >
            <span class="text-xl font-black {resultTone(g.won)}">{resultLetter(g.won)}</span>
            <span class="leading-tight">
              <span class="block text-xs font-semibold">Game {g.number}</span>
              <span class="block text-[11px] text-[var(--muted)]">
                <span class={signTone(g.ratingDelta)}>{signed(g.ratingDelta)}</span>
                · {g.roundIds.length} Rounds · {g.learningCount} L
              </span>
            </span>
          </button>
        {:else}
          <p class="px-2 py-1 text-xs text-[var(--muted)]">No Games in this Session.</p>
        {/each}
      </div>
    {/if}
  </div>

  <!-- The reading drawer: every Learning by Round; or the page's own details. -->
  {#if drawer}
    <aside class="absolute bottom-3 right-3 top-[96px] z-20 w-[480px] max-w-[calc(100%-1.5rem)] space-y-3 overflow-y-auto {panel} p-4" data-testid="drawer-{drawer}">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold">{drawer === "learnings" ? "Learnings tonight" : details?.label}</h2>
        <button type="button" class="text-lg leading-none text-[var(--muted)]" aria-label="Close" onclick={() => go({ drawer: null }, { replace: true })}>×</button>
      </div>
      {#if drawer === "learnings"}
        {#each debrief.rounds.filter((r) => r.learningIds.length) as r (r.id)}
          <div>
            <button type="button" class="text-xs font-semibold hover:underline" onclick={() => go({ game: r.gameId, round: r.id, drawer: null })}>{roundName(r)}</button>
            <ul class="mt-1 space-y-1.5">
              {#each learningsOf(debrief, r.learningIds) as l (l.id)}<LearningRow {duoId} learning={l} revealed={isRevealed("all", r.id, r.gameId)} />{/each}
            </ul>
          </div>
        {/each}
        {#if debrief.sessionLearningIds.length}
          <div>
            <p class="text-xs font-semibold">Whole Session</p>
            <ul class="mt-1 space-y-1.5">
              {#each learningsOf(debrief, debrief.sessionLearningIds) as l (l.id)}<LearningRow {duoId} learning={l} revealed={isRevealed("all")} />{/each}
            </ul>
          </div>
        {/if}
        {#if tally.learnings === 0}<p class="text-xs text-[var(--muted)]">No Learnings yet.</p>{/if}
      {:else if details}
        {@render details.content()}
      {/if}
    </aside>
  {/if}
</div>
