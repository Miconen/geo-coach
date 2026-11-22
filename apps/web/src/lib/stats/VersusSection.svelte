<script lang="ts">
  // The Versus Opponents section of /stats (#43): the Duo's best guess against
  // the Opponents' best guess, per country and over time. Opponents change every
  // Game, so "them" is the level of play at the Duo's rating, a moving baseline.
  import * as Plot from "@observablehq/plot";
  import {
    DEFAULT_GREY_OUT_ROUNDS,
    applyFilter,
    countryVersusRows,
    getCountryName,
    smoothingWindow,
    versusNumbers,
    versusSeries,
    type CountryVersusRow,
    type SmoothingLevel,
    type StatsFilter,
    type StatsPayload,
    type VersusPoint,
  } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import { formatNumber, formatPercent, unitLabel } from "./overview-text.js";
  import { flagEmoji } from "./players-text.js";
  import { aheadTakeaway, outGuessedCountries, outGuessedTakeaway, versusHeadline } from "./versus-text.js";

  let {
    payload,
    filter,
    smoothing,
    greyOutRounds = DEFAULT_GREY_OUT_ROUNDS,
  }: {
    payload: StatsPayload;
    filter: StatsFilter;
    smoothing: SmoothingLevel;
    /** Countries with fewer Rounds than this are left out of the charts (the Rankings threshold). */
    greyOutRounds?: number;
  } = $props();

  const filtered = $derived(applyFilter(payload, filter));
  const window = $derived(smoothingWindow(smoothing, "rounds"));
  const overall = $derived(versusNumbers(filtered.rounds));
  const rows = $derived(countryVersusRows(filtered.rounds));
  const charted = $derived(rows.filter((r) => r.rounds >= greyOutRounds));
  const series = $derived(versusSeries(filtered.rounds, window));

  const DUO = "var(--accent)";
  const OPPONENTS = "var(--danger)";
  const TIP = { lineWidth: 32 } as const;

  const closerColor = (r: CountryVersusRow) =>
    r.closerShare === null ? "var(--muted)" : r.closerShare >= 0.5 ? "var(--ok)" : "var(--danger)";

  function countryTitle(r: CountryVersusRow): string {
    return [
      `${flagEmoji(r.countryCode)} ${getCountryName(r.countryCode)} · ${unitLabel("rounds", r.rounds)}`,
      `Score ${formatNumber(r.avgDuoScore)} ours vs ${formatNumber(r.avgOpponentScore)} theirs`,
      `Median km ${formatNumber(r.duoMedianKm)} ours vs ${formatNumber(r.opponentsMedianKm)} theirs`,
      `Ours closer in ${formatPercent(r.closerShare)} of ${unitLabel("rounds", r.compared)}`,
    ].join("\n");
  }

  // --- Country against country: our score vs theirs -------------------------------

  function scatterChart(width: number): SVGSVGElement | HTMLElement {
    const scores = charted.flatMap((r) => [r.avgDuoScore ?? 0, r.avgOpponentScore ?? 0]);
    const lo = Math.max(0, Math.floor((Math.min(5000, ...scores) - 200) / 500) * 500);
    const domain: [number, number] = [lo, 5000];
    return Plot.plot({
      width,
      height: 320,
      marginLeft: 52,
      x: { label: "Opponents' avg score", domain, grid: true },
      y: { label: "Our avg score", domain, grid: true },
      r: { range: [3, 14] },
      marks: [
        Plot.line(
          [
            [domain[0], domain[0]],
            [domain[1], domain[1]],
          ],
          { stroke: "var(--border-strong)", strokeDasharray: "4,3" },
        ),
        Plot.dot(charted, {
          x: "avgOpponentScore",
          y: "avgDuoScore",
          r: "rounds",
          fill: closerColor,
          fillOpacity: 0.55,
          stroke: closerColor,
          tip: TIP,
          title: countryTitle,
        }),
        Plot.text(charted, {
          x: "avgOpponentScore",
          y: "avgDuoScore",
          text: "countryCode",
          dy: -10,
          fontSize: 9,
          fill: "var(--muted)",
        }),
      ],
    });
  }

  // --- Where are they closer? Median km per country --------------------------------

  /** How many countries the km chart shows: the most out-guessed first. */
  const KM_COUNTRIES = 15;
  type KmRow = { country: string; team: "Us" | "Opponents"; km: number; row: CountryVersusRow };
  const kmCountries = $derived(outGuessedCountries(rows, greyOutRounds).slice(0, KM_COUNTRIES));
  const kmRows = $derived<KmRow[]>(
    kmCountries.flatMap((r) => {
      const country = `${flagEmoji(r.countryCode)} ${getCountryName(r.countryCode)}`;
      return [
        ...(r.duoMedianKm === null ? [] : [{ country, team: "Us" as const, km: Math.max(1, r.duoMedianKm), row: r }]),
        ...(r.opponentsMedianKm === null
          ? []
          : [{ country, team: "Opponents" as const, km: Math.max(1, r.opponentsMedianKm), row: r }]),
      ];
    }),
  );
  const kmHeight = $derived(50 + kmCountries.length * 22);

  function kmChart(width: number): SVGSVGElement | HTMLElement {
    const order = [...new Set(kmRows.map((r) => r.country))];
    return Plot.plot({
      width,
      height: kmHeight,
      marginLeft: 140,
      x: { type: "log", label: "Median km off of each team's best guess", grid: true },
      y: { label: null, domain: order },
      color: { domain: ["Us", "Opponents"], range: [DUO, OPPONENTS], legend: true },
      marks: [
        Plot.ruleY(
          kmCountries,
          {
            y: (r: CountryVersusRow) => `${flagEmoji(r.countryCode)} ${getCountryName(r.countryCode)}`,
            x1: (r: CountryVersusRow) => Math.max(1, r.duoMedianKm ?? 1),
            x2: (r: CountryVersusRow) => Math.max(1, r.opponentsMedianKm ?? 1),
            stroke: "var(--border-strong)",
            strokeWidth: 2,
          },
        ),
        Plot.dot(kmRows, {
          y: "country",
          x: "km",
          fill: "team",
          r: 4,
          tip: TIP,
          title: (d: KmRow) => countryTitle(d.row),
        }),
      ],
    });
  }

  // --- Are we pulling ahead? ---------------------------------------------------------

  function aheadChart(width: number): SVGSVGElement | HTMLElement {
    const data = series.filter((p) => p.closerShare !== null);
    return Plot.plot({
      width,
      height: 220,
      marginLeft: 48,
      x: { label: `Round (end of each ${window}-Round window)` },
      y: { label: "Our best guess closer", domain: [0, 1], grid: true, tickFormat: (d: number) => formatPercent(d) },
      marks: [
        Plot.ruleY([0.5], { stroke: "var(--border-strong)", strokeDasharray: "3,3" }),
        Plot.lineY(data, {
          x: "roundIndex",
          y: "closerShare",
          stroke: DUO,
          strokeWidth: 2,
          tip: TIP,
          title: (p: VersusPoint) =>
            [
              `Rounds ${p.roundIndex - window + 1}–${p.roundIndex}`,
              `Ours closer in ${formatPercent(p.closerShare)}`,
              `Score ${formatNumber(p.avgDuoScore)} ours vs ${formatNumber(p.avgOpponentScore)} theirs`,
              `Median km ${formatNumber(p.duoMedianKm)} ours vs ${formatNumber(p.opponentsMedianKm)} theirs`,
            ].join("\n"),
        }),
      ],
    });
  }

  const statValue = "text-2xl font-bold text-[var(--ink)]";
  const statLabel = "text-xs text-[var(--muted)]";
</script>

{#snippet takeaway(question: string, answer: string)}
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h3 class="text-sm font-bold text-[var(--ink)]">{question}</h3>
    <p class="text-xs text-[var(--muted)]">{answer}</p>
  </div>
{/snippet}

<div class="space-y-6">
  <div class="space-y-1">
    <div class="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <span class={statValue}>{formatPercent(overall.closerShare)}</span>
        <span class={statLabel}>of Rounds our best guess was closer</span>
      </div>
      <div class="mono text-sm text-[var(--ink)]">
        {formatNumber(overall.duoMedianKm)}
        <span class="text-[var(--muted)]">vs {formatNumber(overall.opponentsMedianKm)} median km off</span>
      </div>
      <div class="mono text-sm text-[var(--ink)]">
        {formatNumber(overall.avgDuoScore)}
        <span class="text-[var(--muted)]">vs {formatNumber(overall.avgOpponentScore)} score / Round</span>
      </div>
    </div>
    <p class={statLabel}>{versusHeadline(overall)}</p>
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <div class="space-y-2">
      {@render takeaway("Where do the Opponents out-guess us?", outGuessedTakeaway(rows, greyOutRounds))}
      {#if charted.length > 0}
        <PlotChart height={320} label="Our average score against the Opponents' per country" render={scatterChart} />
      {/if}
      <p class="text-[11px] text-[var(--muted)]">
        One dot per country with {unitLabel("rounds", greyOutRounds)} or more, sized by Rounds. Above the dashed line we
        outscore them there. Green: our best guess is the closer one at least half the time.
      </p>
    </div>
    <div class="space-y-2">
      {@render takeaway(
        "How far off are we, next to them?",
        kmCountries.length
          ? `Median km off in the ${kmCountries.length} countries where they're closer most often, worst first.`
          : "No country has enough Rounds in this filter.",
      )}
      {#if kmRows.length > 0}
        <PlotChart height={kmHeight} label="Median km off per country for both teams" render={kmChart} />
      {/if}
    </div>
  </div>

  <div class="space-y-2">
    {@render takeaway("Are we pulling ahead of our Opponents?", aheadTakeaway(series, filtered.rounds.length, window))}
    {#if series.length > 0}
      <PlotChart height={220} label="Rolling share of Rounds where our best guess was closer" render={aheadChart} />
    {/if}
    <p class="text-[11px] text-[var(--muted)]">
      Rolling {unitLabel("rounds", window)} (set by Smoothing in the filter bar). Opponents change every Game, so this
      measures us against the level of play we're matched with: above 50% means we out-guess our rating's peers.
    </p>
  </div>
</div>
