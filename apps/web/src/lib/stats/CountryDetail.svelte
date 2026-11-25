<script lang="ts">
  // One country's detail pane in the Rankings section: its adjusted and raw
  // numbers, every Round over time, where the confusion goes both ways, far
  // guesses by Region, and who guessed best. Further blocks (such as hedge
  // quality, #41) go in through the `extra` snippet at the end.
  import * as Plot from "@observablehq/plot";
  import type { Snippet } from "svelte";
  import {
    MISTAKE_CLASSES,
    farGuessRegions,
    getCountryName,
    isSplit,
    mistakeClass,
    regionName,
    scoreGap,
    type ConfusionPair,
    type CountryRow,
    type StatsPlayer,
    type StatsRound,
  } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import {
    MISTAKE_CLASS_COLORS,
    MISTAKE_CLASS_LABELS,
    formatNumber,
    formatPercent,
    formatSigned,
    unitLabel,
  } from "./overview-text.js";
  import { countAndDamage, learningTakeaway, placeName, regionLabel } from "./rankings-text.js";
  import { playerInk } from "$lib/player-color.js";

  let {
    row,
    rounds,
    outgoing,
    incoming,
    players,
    onclose,
    onselect,
    canSelect,
    extra,
  }: {
    row: CountryRow;
    /** The country's filtered Rounds. */
    rounds: readonly StatsRound[];
    /** Pairs from this country's Rounds: where we guessed instead. */
    outgoing: readonly ConfusionPair[];
    /** Pairs from other countries' Rounds that guessed this one. */
    incoming: readonly ConfusionPair[];
    players: readonly StatsPlayer[];
    onclose: () => void;
    /** Opens another place's detail, when it has a row. */
    onselect: (place: string) => void;
    /** Whether a place has a row to open. */
    canSelect: (place: string) => boolean;
    /** Extra blocks rendered at the end of the pane, given the row. */
    extra?: Snippet<[CountryRow]>;
  } = $props();

  const name = $derived(getCountryName(row.countryCode));
  const farRegions = $derived(farGuessRegions(rounds));

  const TIP = { lineWidth: 32 } as const;
  const dateLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

  function roundTitle(r: StatsRound): string {
    const cls = mistakeClass(r);
    const region = regionName(r.regionCode);
    return [
      `${dateLabel(r.startedAtMs)}${region ? ` · ${region}` : ""}`,
      `${formatNumber(r.duoBestScore)} vs ${formatNumber(r.opponentBestScore)} (${formatSigned(scoreGap(r))})`,
      `${cls ? MISTAKE_CLASS_LABELS[cls] : "No best guess"}${isSplit(r) ? " · Split" : ""}`,
    ].join("\n");
  }

  function timelineChart(width: number): SVGSVGElement | HTMLElement {
    const first = row.firstLearningAtMs;
    return Plot.plot({
      width,
      height: 180,
      marginLeft: 48,
      x: { type: "time", label: null, inset: 8 },
      y: { label: "Score gap", grid: true, nice: true, inset: 6 },
      marks: [
        Plot.ruleY([0], { stroke: "var(--border-strong)" }),
        ...(first !== null
          ? [Plot.ruleX([new Date(first)], { stroke: "var(--accent)", strokeDasharray: "4,3" })]
          : []),
        Plot.dot(rounds, {
          x: (r: StatsRound) => new Date(r.startedAtMs),
          y: scoreGap,
          r: (r: StatsRound) => (isSplit(r) ? 5 : 3.5),
          fill: (r: StatsRound) => {
            const cls = mistakeClass(r);
            return cls ? MISTAKE_CLASS_COLORS[cls] : "var(--muted)";
          },
          fillOpacity: 0.8,
          stroke: (r: StatsRound) => (isSplit(r) ? "var(--ink)" : "none"),
          strokeWidth: 1.5,
          tip: TIP,
          title: roundTitle,
        }),
      ],
    });
  }

  const statLabel = "text-[11px] uppercase tracking-wide text-[var(--muted)]";
  const statValue = "text-lg font-bold text-[var(--ink)] mono";
  const listHeading = "mb-1 text-xs font-semibold text-[var(--ink)]";
  const pairButton = "flex w-full justify-between gap-2 rounded px-1 text-left enabled:hover:bg-[var(--surface-hover)]";
</script>

<div class="space-y-4 p-3">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <h3 class="text-base font-bold text-[var(--ink)]">{name}</h3>
    <span class="text-xs text-[var(--muted)]">{unitLabel("rounds", row.rounds)}</span>
    <button
      type="button"
      class="ml-auto rounded-md px-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
      onclick={onclose}
    >
      Close ✕
    </button>
  </div>

  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <div title="Pulled toward our mean gap; raw in brackets">
      <div class={statLabel}>Gap vs Opponents</div>
      <div class={statValue} style:color={row.gap >= 0 ? "var(--ok)" : "var(--danger)"}>
        {formatSigned(row.gap)}
        <span class="text-xs font-normal text-[var(--muted)]">raw {formatSigned(row.rawGap)}</span>
      </div>
    </div>
    <div title="Pulled toward our mean score; favours small countries">
      <div class={statLabel}>Avg score</div>
      <div class={statValue}>
        {formatNumber(row.avgScore)}
        <span class="text-xs font-normal text-[var(--muted)]">raw {formatNumber(row.rawAvgScore)}</span>
      </div>
    </div>
    <div title="Damage dealt minus Damage taken per Round, pulled toward our mean">
      <div class={statLabel}>Net damage / Round</div>
      <div class={statValue}>
        {formatSigned(row.netDamage)}
        <span class="text-xs font-normal text-[var(--muted)]">raw {formatSigned(row.rawNetDamage)}</span>
      </div>
    </div>
    <div>
      <div class={statLabel}>Median km off</div>
      <div class={statValue}>{formatNumber(row.medianKm)}</div>
    </div>
    <div title="Splits where one of our guesses was in the right country">
      <div class={statLabel}>Splits caught</div>
      <div class={statValue}>{row.splits ? `${row.splitsCaught}/${row.splits}` : "–"}</div>
    </div>
    <div>
      <div class={statLabel}>Learnings</div>
      <div class={statValue}>{row.learnings}</div>
    </div>
  </div>

  <div class="space-y-1">
    <div class="border-l-4 border-[var(--accent)] pl-3">
      <h4 class="text-sm font-bold text-[var(--ink)]">Every Round here, by score gap</h4>
      <p class="text-xs text-[var(--muted)]">{learningTakeaway(row)}</p>
    </div>
    <PlotChart height={180} label="Score gap of every Round in {name} over time" render={timelineChart} />
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
      {#each MISTAKE_CLASSES as cls (cls)}
        <span>
          <span class="inline-block size-2 rounded-full" style:background={MISTAKE_CLASS_COLORS[cls]}></span>
          {MISTAKE_CLASS_LABELS[cls]}
        </span>
      {/each}
      <span>
        <span class="inline-block size-2.5 rounded-full border-[1.5px] border-[var(--ink)]"></span>
        Split
      </span>
      {#if row.firstLearningAtMs !== null}
        <span><span class="text-[var(--accent)]">┆</span> first Learning</span>
      {/if}
    </div>
  </div>

  <div class="grid gap-4 text-xs md:grid-cols-3">
    <div>
      <h4 class={listHeading}>We guessed instead</h4>
      {#each outgoing as p (`${p.actual}>${p.guessed}`)}
        <button type="button" class={pairButton} disabled={p.guessed === null || !canSelect(p.guessed)} onclick={() => p.guessed && onselect(p.guessed)}>
          <span>
            {#if p.actual !== row.countryCode}<span class="text-[var(--muted)]">{placeName(p.actual)} →</span>{/if}
            {placeName(p.guessed)}
          </span>
          <span class="mono whitespace-nowrap">{countAndDamage(p)}</span>
        </button>
      {:else}
        <p class="text-[var(--muted)]">Never the wrong country.</p>
      {/each}
    </div>
    <div>
      <h4 class={listHeading}>Mistaken for {name}</h4>
      {#each incoming as p (`${p.actual}>${p.guessed}`)}
        <button type="button" class={pairButton} disabled={!canSelect(p.actual)} onclick={() => onselect(p.actual)}>
          <span>{placeName(p.actual)}</span>
          <span class="mono whitespace-nowrap">{countAndDamage(p)}</span>
        </button>
      {:else}
        <p class="text-[var(--muted)]">No other country.</p>
      {/each}
    </div>
    <div>
      <h4 class={listHeading}>Far guesses by Region</h4>
      {#each farRegions as f (`${f.actual}>${f.guessed}`)}
        <div class="flex justify-between gap-2 px-1">
          <span>{regionLabel(f.actual)} → {regionLabel(f.guessed)}</span>
          <span class="mono whitespace-nowrap">{countAndDamage(f)}</span>
        </div>
      {:else}
        <p class="text-[var(--muted)]">No far guesses.</p>
      {/each}
    </div>
  </div>

  <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs">
    <span class="text-[var(--muted)]">Best guess</span>
    {#each players as p (p.id)}
      <span>
        <span class="font-semibold" style:color={playerInk(p.avatarColor)}>{p.displayName}</span>
        {formatPercent(row.bestGuessShare[p.id] ?? 0)}
      </span>
    {/each}
  </div>

  <!-- Extra blocks for this country, e.g. hedge quality (#41). -->
  {@render extra?.(row)}
</div>
