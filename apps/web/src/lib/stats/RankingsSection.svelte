<script lang="ts">
  // The Rankings section of /stats: which countries cost us and which carry us
  // (a gap chart), every country in a sortable table, and either the directed
  // confusion pairs or one country's detail pane next to it.
  import * as Plot from "@observablehq/plot";
  import {
    DEFAULT_GREY_OUT_ROUNDS,
    DEFAULT_RANKING_METHOD,
    RANKING_PRIOR_ROUNDS,
    applyFilter,
    confusionPairs,
    countryRows,
    gapChartRows,
    getCountryName,
    isGreyedOut,
    slowThreshold,
    sortCountryRows,
    withoutCountryFilter,
    type ConfusionPair,
    type CountryRow,
    type CountryRowValue,
    type RankingMethod,
    type StatsFilter,
    type StatsPayload,
  } from "@geo-coach/shared";
  import { getDeveloperMode } from "$lib/developer-mode.svelte.js";
  import CountryDetail from "./CountryDetail.svelte";
  import PlotChart from "./PlotChart.svelte";
  import { formatNumber, formatPercent, formatSigned, unitLabel } from "./overview-text.js";
  import { gapTakeaway, placeName, rowCountryOf } from "./rankings-text.js";

  let { payload, filter }: { payload: StatsPayload; filter: StatsFilter } = $props();

  // --- Ranking method (other methods only in Developer mode) -------------------

  const prior = (rounds: number): RankingMethod => (values, duoMean) =>
    (values.reduce((sum, v) => sum + v, 0) + rounds * duoMean) / (values.length + rounds);
  const METHODS: Record<string, RankingMethod> = {
    [`Default (${RANKING_PRIOR_ROUNDS} Rounds at our mean)`]: DEFAULT_RANKING_METHOD,
    "Raw mean": prior(0),
    "10 Rounds at our mean": prior(10),
    "20 Rounds at our mean": prior(20),
  };
  const DEFAULT_METHOD_NAME = Object.keys(METHODS)[0]!;
  let methodName = $state(DEFAULT_METHOD_NAME);
  const method = $derived(
    getDeveloperMode() ? (METHODS[methodName] ?? DEFAULT_RANKING_METHOD) : DEFAULT_RANKING_METHOD,
  );

  // --- Rows ---------------------------------------------------------------------

  const filtered = $derived(applyFilter(payload, filter));
  // Fixed over all the Duo's Rounds, so the filter never moves it.
  const slowAt = $derived(slowThreshold(payload.rounds));
  const rows = $derived(
    countryRows(filtered, { learnings: payload.learnings, slowThresholdSeconds: slowAt, method }),
  );
  const rowCodes = $derived(new Set(rows.map((r) => r.countryCode)));

  let greyOutRounds = $state(DEFAULT_GREY_OUT_ROUNDS);
  const chartRows = $derived(gapChartRows(rows, greyOutRounds));
  const chartHeight = $derived(Math.max(120, chartRows.length * 22 + 40));

  type Column = {
    key: string;
    label: string;
    title?: string;
    value: CountryRowValue;
    /** The direction of the first click: worst first for the rank columns. */
    first: "asc" | "desc";
  };
  const COLUMNS: Column[] = [
    { key: "country", label: "Country", value: (r) => getCountryName(r.countryCode), first: "asc" },
    { key: "rounds", label: "Rounds", value: (r) => r.rounds, first: "desc" },
    {
      key: "gap",
      label: "Gap vs Opp",
      title: "The rank: our best score minus the Opponents' best per Round, pulled toward our mean gap",
      value: (r) => r.gap,
      first: "asc",
    },
    {
      key: "avgScore",
      label: "Avg score",
      title: "Our best score per Round, pulled toward our mean. Favours small countries, which score higher for everyone",
      value: (r) => r.avgScore,
      first: "asc",
    },
    {
      key: "netDamage",
      label: "Damage / Round",
      title: "Net damage per Round (dealt minus taken), pulled toward our mean",
      value: (r) => r.netDamage,
      first: "asc",
    },
    { key: "wrongCountry", label: "Wrong country", title: "Rounds whose best guess was in another country or the water", value: (r) => r.wrongCountry, first: "desc" },
    { key: "far", label: "Far", title: "Right country, but far off for its size", value: (r) => r.far, first: "desc" },
    { key: "slow", label: "Slow", title: "Best guesses slower than our 75th percentile", value: (r) => r.slow, first: "desc" },
    { key: "splits", label: "Splits", title: "Caught / total: caught when one of our guesses was in the right country", value: (r) => r.splits, first: "desc" },
    { key: "learnings", label: "Learnings", value: (r) => r.learnings, first: "desc" },
  ];
  const playerColumns = $derived<Column[]>(
    payload.players.map((p) => ({
      key: `share:${p.id}`,
      label: `${p.displayName} best`,
      title: `Share of Rounds where ${p.displayName}'s guess was our best`,
      value: (r) => r.bestGuessShare[p.id] ?? 0,
      first: "desc",
    })),
  );

  let sortKey = $state("gap");
  let sortDirection = $state<"asc" | "desc">("asc");
  const sortColumn = $derived(
    [...COLUMNS, ...playerColumns].find((c) => c.key === sortKey) ?? COLUMNS[2]!,
  );
  const sortedRows = $derived(sortCountryRows(rows, sortColumn.value, sortDirection, greyOutRounds));

  function sortBy(column: Column) {
    if (sortKey === column.key) sortDirection = sortDirection === "asc" ? "desc" : "asc";
    else {
      sortKey = column.key;
      sortDirection = column.first;
    }
  }

  // --- Selection: a row or a confusion pair opens the detail pane ----------------

  let selected = $state<string | null>(null);
  const selectedRow = $derived(rows.find((r) => r.countryCode === selected) ?? null);

  const pairs = $derived(confusionPairs(filtered.rounds));
  // "Mistaken for" looks at other countries' Rounds, so it ignores the country filter.
  const otherCountryPairs = $derived(
    confusionPairs(applyFilter(payload, withoutCountryFilter(filter)).rounds),
  );
  const canSelect = (place: string) => rowCodes.has(rowCountryOf(place));
  const select = (place: string) => {
    const code = rowCountryOf(place);
    if (rowCodes.has(code)) selected = code;
  };
  const toggleRow = (code: string) => (selected = selected === code ? null : code);

  const PAIRS_SHOWN = 15;

  function outgoingOf(row: CountryRow): ConfusionPair[] {
    return pairs.filter((p) => rowCountryOf(p.actual) === row.countryCode);
  }
  function incomingOf(row: CountryRow): ConfusionPair[] {
    return otherCountryPairs.filter((p) => p.guessed !== null && rowCountryOf(p.guessed) === row.countryCode);
  }

  // --- Gap chart ------------------------------------------------------------------

  const TIP = { lineWidth: 32 } as const;

  function gapTitle(r: CountryRow): string {
    return [
      `${getCountryName(r.countryCode)}: ${formatSigned(r.gap)} per Round over ${unitLabel("rounds", r.rounds)}`,
      `Raw gap ${formatSigned(r.rawGap)}`,
      `${r.wrongCountry} wrong country · ${r.far} far`,
      `${r.learnings} Learning${r.learnings === 1 ? "" : "s"}`,
    ].join("\n");
  }

  function gapChart(width: number): SVGSVGElement | HTMLElement {
    const names = chartRows.map((r) => getCountryName(r.countryCode));
    const label = (r: CountryRow) => `${r.rounds}`;
    return Plot.plot({
      width,
      height: chartHeight,
      marginLeft: 130,
      x: { label: "Score gap vs Opponents per Round (adjusted)", grid: true },
      y: { label: null, domain: names },
      marks: [
        Plot.barX(chartRows, {
          y: (r: CountryRow) => getCountryName(r.countryCode),
          x: "gap",
          fill: (r: CountryRow) => (r.gap >= 0 ? "var(--ok)" : "var(--danger)"),
          fillOpacity: 0.85,
          tip: TIP,
          title: gapTitle,
        }),
        Plot.ruleX([0], { stroke: "var(--border-strong)" }),
        // The Round count sits at the zero line, on the side away from the bar.
        Plot.text(chartRows, {
          y: (r: CountryRow) => getCountryName(r.countryCode),
          x: 0,
          text: label,
          dx: -6,
          textAnchor: "end",
          fill: "var(--muted)",
          filter: (r: CountryRow) => r.gap >= 0,
        }),
        Plot.text(chartRows, {
          y: (r: CountryRow) => getCountryName(r.countryCode),
          x: 0,
          text: label,
          dx: 6,
          textAnchor: "start",
          fill: "var(--muted)",
          filter: (r: CountryRow) => r.gap < 0,
        }),
      ],
    });
  }
  const signedTone = (n: number) => (n >= 0 ? "var(--ok)" : "var(--danger)");
  const cell = "px-2 py-1 text-right mono";
  const inputClass =
    "rounded-md border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-xs text-[var(--ink)]";
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
    <label class="inline-flex items-center gap-1.5">
      <span class="text-[var(--muted)]">Grey out below</span>
      <input
        type="number"
        min="1"
        class="{inputClass} w-14"
        value={greyOutRounds}
        oninput={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isInteger(n) && n >= 1) greyOutRounds = n;
        }}
      />
      <span class="text-[var(--muted)]">Rounds</span>
    </label>
    {#if getDeveloperMode()}
      <label class="inline-flex items-center gap-1.5">
        <span class="text-[var(--muted)]">Ranking method</span>
        <select class={inputClass} bind:value={methodName}>
          {#each Object.keys(METHODS) as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>
    {/if}
    <span class="text-[var(--muted)]">Click a country or a confusion pair for its detail.</span>
  </div>

  <div class="space-y-2">
    <div class="border-l-4 border-[var(--accent)] pl-3">
      <h3 class="text-sm font-bold text-[var(--ink)]">Which countries cost us, and which carry us?</h3>
      <p class="text-xs text-[var(--muted)]">{gapTakeaway(chartRows, greyOutRounds)}</p>
    </div>
    {#if chartRows.length > 0}
      <PlotChart
        height={chartHeight}
        label="Best and worst countries by score gap against the Opponents"
        render={gapChart}
      />
    {/if}
  </div>

  <div class="grid gap-4 {selectedRow ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]' : 'xl:grid-cols-[minmax(0,1fr)_340px]'}">
    <div class="max-h-[720px] overflow-auto rounded-lg border border-[var(--border)]">
      <table class="w-full text-xs">
        <thead class="sticky top-0 z-[1] bg-[var(--surface)]">
          <tr class="text-[var(--muted)]">
            {#each [...COLUMNS, ...(selectedRow ? [] : playerColumns)] as c (c.key)}
              <th
                class="whitespace-nowrap px-2 py-1.5 font-semibold {c.key === 'country' ? 'text-left' : 'text-right'}"
                title={c.title}
                aria-sort={sortKey === c.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" class="hover:text-[var(--ink)]" onclick={() => sortBy(c)}>
                  {c.label}{sortKey === c.key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as r (r.countryCode)}
            <tr
              class="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-hover)] {r.countryCode === selected
                ? 'bg-[var(--surface-subtle)]'
                : ''} {isGreyedOut(r, greyOutRounds) ? 'opacity-45' : ''}"
              aria-selected={r.countryCode === selected}
              onclick={() => toggleRow(r.countryCode)}
            >
              <td class="px-2 py-1 font-medium text-[var(--ink)]">
                <button type="button" class="text-left" onclick={(e) => { e.stopPropagation(); toggleRow(r.countryCode); }}>
                  {getCountryName(r.countryCode)}
                </button>
              </td>
              <td class={cell}>{r.rounds}</td>
              <td class="{cell} font-bold" style:color={signedTone(r.gap)}>{formatSigned(r.gap)}</td>
              <td class={cell}>{formatNumber(r.avgScore)}</td>
              <td class={cell}>{formatSigned(r.netDamage)}</td>
              <td class={cell}>{r.wrongCountry || ""}</td>
              <td class={cell}>{r.far || ""}</td>
              <td class={cell}>{r.slow || ""}</td>
              <td class={cell}>{r.splits ? `${r.splitsCaught}/${r.splits}` : ""}</td>
              <td class={cell}>{r.learnings || ""}</td>
              {#if !selectedRow}
                {#each payload.players as p (p.id)}
                  <td class={cell}>{formatPercent(r.bestGuessShare[p.id] ?? 0)}</td>
                {/each}
              {/if}
            </tr>
          {:else}
            <tr><td class="px-2 py-3 text-[var(--muted)]" colspan={COLUMNS.length}>No Rounds in this filter.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if selectedRow}
      <div class="rounded-lg border border-[var(--border)]">
        <CountryDetail
          row={selectedRow}
          rounds={filtered.rounds.filter((r) => r.countryCode === selectedRow.countryCode)}
          outgoing={outgoingOf(selectedRow)}
          incoming={incomingOf(selectedRow)}
          players={payload.players}
          onclose={() => (selected = null)}
          onselect={select}
          {canSelect}
        />
      </div>
    {:else}
      <div class="space-y-4">
        <div>
          <h3 class="mb-1 text-sm font-bold text-[var(--ink)]">Confusion pairs</h3>
          <p class="mb-2 text-xs text-[var(--muted)]">
            Wrong-country Rounds: the country → where our best guess landed, with the damage taken.
          </p>
          {#each pairs.slice(0, PAIRS_SHOWN) as p (`${p.actual}>${p.guessed}`)}
            <button
              type="button"
              class="flex w-full justify-between gap-2 border-t border-[var(--border)] px-1 py-1 text-left text-xs enabled:hover:bg-[var(--surface-hover)]"
              disabled={!canSelect(p.actual)}
              onclick={() => select(p.actual)}
            >
              <span>{placeName(p.actual)} → {placeName(p.guessed)}</span>
              <span class="mono whitespace-nowrap">
                {p.count}×{#if p.damage > 0}
                  <span class="text-[var(--danger)]">−{formatNumber(p.damage)}</span>{/if}
              </span>
            </button>
          {:else}
            <p class="text-xs text-[var(--muted)]">No wrong-country Rounds in this filter.</p>
          {/each}
          {#if pairs.length > PAIRS_SHOWN}
            <p class="mt-1 text-[11px] text-[var(--muted)]">{pairs.length - PAIRS_SHOWN} more pairs not shown.</p>
          {/if}
        </div>
        <!-- Subsections after the confusion pairs (e.g. hedge quality, #41) go here. -->
      </div>
    {/if}
  </div>
</div>
