<script lang="ts">
  import {
    EMPTY_STATS_FILTER,
    DEFAULT_SMOOTHING,
    GAME_MODES,
    SMOOTHING_LEVELS,
    SMOOTHING_PARAM,
    STATS_FILTER_PARAMS,
    applyFilter,
    getCountryName,
    parseSmoothing,
    parseStatsFilter,
    serializeStatsFilter,
    type GameMode,
    type SmoothingLevel,
    type StatsFilter,
  } from "@geo-coach/shared";
  import OverviewSection from "$lib/stats/OverviewSection.svelte";
  import RankingsSection from "$lib/stats/RankingsSection.svelte";
  import PlayersSection from "$lib/stats/PlayersSection.svelte";
  import SpeedSection from "$lib/stats/SpeedSection.svelte";
  import EffectsSection from "$lib/stats/EffectsSection.svelte";
  import VersusSection from "$lib/stats/VersusSection.svelte";
  import MapViewSection from "$lib/stats/map/MapViewSection.svelte";
  import { RANK_PARAM } from "$lib/stats/map/view-state.js";
  import { pushQuery, updateQuery, viewParams } from "$lib/url-state.js";
  import { readParam, setParam } from "$lib/view-url.js";
  import { useEntityRefresh } from "$lib/live/entity-refresh.svelte.js";
  import type { StatsPayload } from "@geo-coach/shared";

  let { data } = $props();

  // Live refresh (#56 2b): the server load is the Back baseline; X5 Stats events refetch the same payload,
  // single-flight with a short debounce, and a response for a replaced load is dropped.
  const live = useEntityRefresh<StatsPayload>({
    base: () => data.stats,
    url: () => `/api/duos/${data.duo.id}/stats`,
    consumer: "stats",
    debounceMs: 300,
  });
  const stats = $derived(live.current);

  let mapView = $state<MapViewSection>();

  // The selected Rankings row is a focus, in the URL (#73): selecting one adds a history entry, so Back closes it,
  // and a reload or a shared link reopens it. The Map view keeps its own focus params the same way.
  const rankingSelected = $derived(readParam(viewParams(), RANK_PARAM, (v) => /^[A-Z]{2}$/.test(v)));
  function selectRanking(code: string | null) {
    pushQuery((params) => setParam(params, RANK_PARAM, code));
  }

  // The filter lives in the URL so a view can be bookmarked; changing it never reloads
  // the payload, since every panel is computed here in the browser (ADR 0003). It's read
  // back from the URL (#73), so Back to an earlier focus shows the filter it had; keyed by
  // its serialized form, so a focus change alone never refilters.
  const filterKey = $derived(serializeStatsFilter(parseStatsFilter(viewParams())).toString());
  const filter = $derived<StatsFilter>(parseStatsFilter(new URLSearchParams(filterKey)));

  const filtered = $derived(applyFilter(stats, filter));

  // How much the time-series charts are smoothed. Not part of the filter (it never
  // narrows the Rounds), but kept in the URL next to it so a view can be bookmarked.
  const smoothing = $derived<SmoothingLevel>(parseSmoothing(viewParams()));

  const SMOOTHING_LABELS: Record<SmoothingLevel, string> = {
    off: "Off",
    light: "Light",
    medium: "Medium",
    heavy: "Heavy",
  };

  function setSmoothing(next: SmoothingLevel) {
    updateQuery((params) => {
      if (next === DEFAULT_SMOOTHING) params.delete(SMOOTHING_PARAM);
      else params.set(SMOOTHING_PARAM, next);
    });
  }

  const MODE_LABELS: Record<GameMode, string> = { moving: "Moving", nm: "NM", nmpz: "NMPZ" };

  const mapNames = $derived(
    [...new Set(stats.games.map((g) => g.mapName).filter((n): n is string => !!n))].sort(),
  );
  // Most-played first, so the countries worth filtering on are at the top.
  const countries = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of stats.rounds) {
      if (r.countryCode) counts.set(r.countryCode, (counts.get(r.countryCode) ?? 0) + 1);
    }
    return [...counts]
      .map(([code, rounds]) => ({ code, rounds }))
      .sort((a, b) => b.rounds - a.rounds || getCountryName(a.code).localeCompare(getCountryName(b.code)));
  });
  const sessionsNewestFirst = $derived([...stats.sessions].reverse());

  const isFiltered = $derived(serializeStatsFilter(filter).toString() !== "");

  function setFilter(next: StatsFilter) {
    updateQuery((params) => {
      for (const key of STATS_FILTER_PARAMS) params.delete(key);
      for (const [key, value] of serializeStatsFilter(next)) params.append(key, value);
    });
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function selectedValues(event: Event): string[] {
    return [...(event.currentTarget as HTMLSelectElement).selectedOptions].map((o) => o.value);
  }

  function ratingValue(event: Event): number | null {
    const raw = (event.currentTarget as HTMLInputElement).value;
    return /^\d+$/.test(raw) ? Number(raw) : null;
  }

  function sessionLabel(startedAtMs: number): string {
    return new Date(startedAtMs).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const SECTIONS = [
    { id: "overview", title: "Overview & rating" },
    { id: "rankings", title: "Rankings" },
    { id: "versus", title: "Versus Opponents" },
    { id: "speed", title: "Speed" },
    { id: "effects", title: "What happens when…" },
    { id: "map-view", title: "Map view" },
    { id: "players", title: "Players" },
  ];

  const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]";
  const inputClass =
    "rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--ink)]";
</script>

<svelte:head>
  <title>Stats · {data.duo.name}</title>
</svelte:head>

<div class="mx-auto max-w-[2320px] px-[clamp(16px,3vw,64px)] py-4 space-y-3">
  <header class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-xs">
    <h1 class="text-base font-bold tracking-tight text-[var(--ink)]">Stats</h1>
  </header>

  <!-- One filter for the whole page: it narrows the Rounds, then every section computes on them. -->
  <form
    class="sticky top-0 z-10 flex flex-wrap items-end gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-xs"
    onsubmit={(e) => e.preventDefault()}
  >
    <label class="flex flex-col gap-1">
      <span class={labelClass}>From</span>
      <input
        type="date"
        class={inputClass}
        value={filter.from ?? ""}
        onchange={(e) => setFilter({ ...filter, from: e.currentTarget.value || null })}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class={labelClass}>To</span>
      <input
        type="date"
        class={inputClass}
        value={filter.to ?? ""}
        onchange={(e) => setFilter({ ...filter, to: e.currentTarget.value || null })}
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class={labelClass}>Sessions</span>
      <select
        multiple
        size="3"
        class="{inputClass} min-w-44"
        onchange={(e) => setFilter({ ...filter, sessionIds: selectedValues(e) })}
      >
        {#each sessionsNewestFirst as s (s.id)}
          <option value={s.id} selected={filter.sessionIds.includes(s.id)}>{sessionLabel(s.startedAtMs)}</option>
        {/each}
      </select>
    </label>

    <fieldset class="flex flex-col gap-1">
      <legend class={labelClass}>Map</legend>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {#each mapNames as name (name)}
          <label class="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={filter.mapNames.includes(name)}
              onchange={() => setFilter({ ...filter, mapNames: toggle(filter.mapNames, name) })}
            />
            {name}
          </label>
        {:else}
          <span class="text-[var(--muted)]">No Games yet</span>
        {/each}
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-1">
      <legend class={labelClass}>Mode</legend>
      <div class="flex gap-3 text-xs">
        {#each GAME_MODES as mode (mode)}
          <label class="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={filter.modes.includes(mode)}
              onchange={() => setFilter({ ...filter, modes: toggle(filter.modes, mode) })}
            />
            {MODE_LABELS[mode]}
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-1">
      <legend class={labelClass}>Opponents' rating</legend>
      <div class="flex items-center gap-1 text-xs">
        <input
          type="number"
          min="0"
          placeholder="min"
          class="{inputClass} w-20"
          value={filter.opponentRatingMin ?? ""}
          onchange={(e) => setFilter({ ...filter, opponentRatingMin: ratingValue(e) })}
        />
        –
        <input
          type="number"
          min="0"
          placeholder="max"
          class="{inputClass} w-20"
          value={filter.opponentRatingMax ?? ""}
          onchange={(e) => setFilter({ ...filter, opponentRatingMax: ratingValue(e) })}
        />
      </div>
    </fieldset>

    <label class="flex flex-col gap-1">
      <span class={labelClass}>Country</span>
      <select
        multiple
        size="3"
        class="{inputClass} min-w-44"
        onchange={(e) => setFilter({ ...filter, countryCodes: selectedValues(e) })}
      >
        {#each countries as { code, rounds } (code)}
          <option value={code} selected={filter.countryCodes.includes(code)}>
            {getCountryName(code)} · {rounds}
          </option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1" title="Rolling window for the charts over time: Games for the rating line, Rounds for the trends">
      <span class={labelClass}>Smoothing</span>
      <select
        class={inputClass}
        value={smoothing}
        onchange={(e) => setSmoothing(e.currentTarget.value as SmoothingLevel)}
      >
        {#each SMOOTHING_LEVELS as level (level)}
          <option value={level}>{SMOOTHING_LABELS[level]}</option>
        {/each}
      </select>
    </label>

    {#if isFiltered}
      <button
        type="button"
        class="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
        onclick={() => setFilter({ ...EMPTY_STATS_FILTER })}
      >
        Clear filter
      </button>
    {/if}
  </form>

  {#each SECTIONS as section (section.id)}
    <section
      id={section.id}
      class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-bold text-[var(--ink)]">{section.title}</h2>
        <span class="mono text-xs text-[var(--muted)]">
          {filtered.games.length} Games · {filtered.rounds.length} Rounds
        </span>
      </div>
      {#if section.id === "overview"}
        <div class="mt-3">
          <OverviewSection payload={stats} {filter} {smoothing} />
        </div>
      {:else if section.id === "rankings"}
        <div class="mt-3">
          <RankingsSection duoId={data.duo.id} payload={stats} {filter} bind:selected={() => rankingSelected, selectRanking} />
        </div>
      {:else if section.id === "versus"}
        <div class="mt-3">
          <VersusSection payload={stats} {filter} {smoothing} />
        </div>
      {:else if section.id === "speed"}
        <div class="mt-3">
          <SpeedSection payload={stats} {filter} {smoothing} />
        </div>
      {:else if section.id === "effects"}
        <div class="mt-3">
          <EffectsSection payload={stats} {filter} />
        </div>
      {:else if section.id === "players"}
        <div class="mt-3">
          <PlayersSection payload={stats} {filter} {smoothing} onOpenRound={(id) => mapView?.showRound(id)} />
        </div>
      {:else if section.id === "map-view"}
        <div class="mt-3"><MapViewSection bind:this={mapView} duoId={data.duo.id} payload={stats} rounds={filtered.rounds} /></div>
      {/if}
    </section>
  {/each}
</div>
