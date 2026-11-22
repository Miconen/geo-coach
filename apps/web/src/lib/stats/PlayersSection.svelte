<script lang="ts">
  // The Players section of /stats: who carries where, who guesses first within
  // the Duo, whether waiting for the timer pays, each Player's trend, and a
  // shortlist of their best guesses. Every panel follows the whole page filter.
  import * as Plot from "@observablehq/plot";
  import {
    DEFAULT_GREY_OUT_ROUNDS,
    ROLLING_WINDOW_ROUNDS,
    applyFilter,
    bestGuesses,
    carryChips,
    countryRows,
    firstGuesserStats,
    getCountryName,
    playerSummaries,
    regionName,
    rollingSeries,
    type BestGuess,
    type CarryChip,
    type GuessGroup,
    type StatsFilter,
    type StatsPayload,
  } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import { formatNumber, formatPercent, formatSeconds, unitLabel } from "./overview-text.js";
  import {
    MODE_LABELS,
    bestGuessReasons,
    carryTakeaway,
    firstTakeaway,
    flagEmoji,
    playerColor,
    trendTakeaway,
    waitingTakeaway,
  } from "./players-text.js";

  let {
    payload,
    filter,
    greyOutRounds = DEFAULT_GREY_OUT_ROUNDS,
    onOpenRound,
  }: {
    payload: StatsPayload;
    filter: StatsFilter;
    /** Carry chips leave out countries with fewer Rounds than this (the Rankings threshold). */
    greyOutRounds?: number;
    /** Opens a Round's card; Best-guess rows are clickable only when it's given. */
    onOpenRound?: (roundId: string) => void;
  } = $props();

  const filtered = $derived(applyFilter(payload, filter));
  const players = $derived(payload.players);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.displayName ?? "?";
  const colorOf = (id: string) => playerColor(Math.max(0, players.findIndex((p) => p.id === id)));

  const summaries = $derived(playerSummaries(filtered, players));
  const firsts = $derived(firstGuesserStats(filtered.rounds, players));
  // Only the Players' best-guess shares are read, so no Learnings or slow threshold.
  const rows = $derived(countryRows(filtered, { learnings: [], slowThresholdSeconds: null }));
  const chipsOf = (id: string): CarryChip[] => carryChips(rows, id, greyOutRounds);
  const trends = $derived(
    players.map((p) => ({ playerId: p.id, points: rollingSeries(filtered.rounds, p.id, ROLLING_WINDOW_ROUNDS) })),
  );
  const hasTrend = $derived(filtered.rounds.length >= ROLLING_WINDOW_ROUNDS);
  const shortlist = $derived(players.map((p) => ({ playerId: p.id, guesses: bestGuesses(filtered, p.id) })));

  const TIP = { lineWidth: 32 } as const;

  // --- Who guesses first? -------------------------------------------------------

  type FirstSlice = { label: string; count: number; share: number; fill: string };

  const firstSlices = $derived<FirstSlice[]>(
    firsts.rounds === 0
      ? []
      : [
          ...firsts.players.map((p) => ({
            label: `${nameOf(p.playerId)} first`,
            count: p.first,
            share: p.share ?? 0,
            fill: colorOf(p.playerId),
          })),
          {
            label: "Both timed out",
            count: firsts.bothTimedOut,
            share: firsts.bothTimedOutShare ?? 0,
            fill: "var(--muted)",
          },
          {
            label: "Nobody pressed",
            count: firsts.noPressedGuess,
            share: firsts.noPressedGuess / firsts.rounds,
            fill: "var(--border-strong)",
          },
        ].filter((s) => s.count > 0),
  );

  function firstShareChart(width: number): SVGSVGElement | HTMLElement {
    return Plot.plot({
      width,
      height: 56,
      marginLeft: 8,
      marginRight: 8,
      x: { domain: [0, 1], axis: null },
      y: { axis: null },
      marks: [
        Plot.barX(
          firstSlices,
          Plot.stackX({
            x: "share",
            fill: "fill",
            insetRight: 1,
            tip: TIP,
            title: (s: FirstSlice) => `${s.label}: ${unitLabel("rounds", s.count)} (${formatPercent(s.share)})`,
          }),
        ),
        Plot.text(
          firstSlices.filter((s) => s.share >= 0.18),
          Plot.stackX({
            x: "share",
            text: (s: FirstSlice) => `${s.label} ${formatPercent(s.share)}`,
            fill: "var(--surface)",
            fontWeight: "bold",
          }),
        ),
      ],
    });
  }

  type WhenFirst = { player: string; when: string; share: number; fill: string; rounds: number };

  const whenFirst = $derived<WhenFirst[]>(
    firsts.players.flatMap((p) => {
      const other = players.find((o) => o.id !== p.playerId);
      const otherFirst = firsts.players.find((o) => o.playerId === other?.id)?.first ?? 0;
      const rows: WhenFirst[] = [];
      if (p.bestShareWhenFirst !== null) {
        rows.push({ player: nameOf(p.playerId), when: "when first", share: p.bestShareWhenFirst, fill: colorOf(p.playerId), rounds: p.first });
      }
      if (p.bestShareWhenOtherFirst !== null && other) {
        rows.push({ player: nameOf(p.playerId), when: `when ${other.displayName} first`, share: p.bestShareWhenOtherFirst, fill: colorOf(other.id), rounds: otherFirst });
      }
      return rows;
    }),
  );

  function whenFirstChart(width: number): SVGSVGElement | HTMLElement {
    return Plot.plot({
      width,
      height: 40 + whenFirst.length * 26,
      marginLeft: 150,
      x: { domain: [0, 1], label: "Best-guess share", tickFormat: (d: number) => formatPercent(d), grid: true },
      y: { label: null },
      marks: [
        Plot.barX(whenFirst, {
          y: (d: WhenFirst) => `${d.player} ${d.when}`,
          x: "share",
          fill: "fill",
          fillOpacity: 0.85,
          tip: TIP,
          title: (d: WhenFirst) => `${d.player} had the best guess in ${formatPercent(d.share)} of ${unitLabel("rounds", d.rounds)} ${d.when}`,
        }),
        Plot.ruleX([0.5], { stroke: "var(--border-strong)", strokeDasharray: "3,3" }),
        Plot.text(whenFirst, {
          y: (d: WhenFirst) => `${d.player} ${d.when}`,
          x: "share",
          text: (d: WhenFirst) => formatPercent(d.share),
          dx: 4,
          textAnchor: "start",
          fill: "var(--ink)",
        }),
      ],
    });
  }

  // --- Trends -------------------------------------------------------------------

  type TrendRow = { playerId: string; roundIndex: number; bestShare: number; medianKm: number | null };

  const trendRows = $derived<TrendRow[]>(
    trends.flatMap(({ playerId, points }) => points.map((p) => ({ playerId, ...p }))),
  );

  function trendChart(metric: "bestShare" | "medianKm") {
    return (width: number): SVGSVGElement | HTMLElement => {
      const data = trendRows.filter((r) => r[metric] !== null);
      return Plot.plot({
        width,
        height: 220,
        marginLeft: 48,
        x: { label: `Round (end of each ${ROLLING_WINDOW_ROUNDS}-Round window)` },
        y:
          metric === "bestShare"
            ? { label: "Best-guess share", grid: true, tickFormat: (d: number) => formatPercent(d) }
            : { label: "Median km off (not Splits)", grid: true, nice: true },
        marks: [
          metric === "bestShare" ? Plot.ruleY([0.5], { stroke: "var(--border-strong)", strokeDasharray: "3,3" }) : null,
          Plot.lineY(data, {
            x: "roundIndex",
            y: metric,
            z: "playerId",
            stroke: (r: TrendRow) => colorOf(r.playerId),
            strokeWidth: 2,
            tip: TIP,
            title: (r: TrendRow) =>
              [
                `${nameOf(r.playerId)} · Rounds ${r.roundIndex - ROLLING_WINDOW_ROUNDS + 1}–${r.roundIndex}`,
                `Best guess in ${formatPercent(r.bestShare)}`,
                `Median ${formatNumber(r.medianKm)} km off (not Splits)`,
              ].join("\n"),
          }),
        ],
      });
    };
  }

  // --- Layout helpers -----------------------------------------------------------

  const groupCells = (g: GuessGroup) => [formatNumber(g.guesses), formatNumber(g.avgScore), formatNumber(g.medianKm)];

  function bestGuessTitle(b: BestGuess): string {
    return [
      `${formatNumber(b.score)} points, ${formatNumber(b.distanceMeters / 1000, 1)} km off`,
      `Others averaged ${formatNumber(b.othersAvgScore)}`,
      `Standout score ${formatNumber(b.standout)}`,
    ].join("\n");
  }

  const statValue = "text-2xl font-bold text-[var(--ink)]";
  const statLabel = "text-xs text-[var(--muted)]";
  const th = "px-2 py-1 text-right font-semibold whitespace-nowrap";
  const td = "px-2 py-1 text-right mono";
  const rowClass = "flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-left text-xs";
</script>

{#snippet takeaway(question: string, answer: string)}
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h3 class="text-sm font-bold text-[var(--ink)]">{question}</h3>
    <p class="text-xs text-[var(--muted)]">{answer}</p>
  </div>
{/snippet}

{#snippet playerName(id: string)}
  <span class="inline-flex items-center gap-1.5 font-bold text-[var(--ink)]">
    <span class="inline-block size-2.5 rounded-full" style:background={colorOf(id)}></span>
    {nameOf(id)}
  </span>
{/snippet}

{#snippet bestGuessRow(b: BestGuess, i: number)}
  <span class="mono w-5 text-[var(--muted)]">{i + 1}</span>
  <span class="text-base leading-none">{flagEmoji(b.countryCode)}</span>
  <span class="font-medium text-[var(--ink)]">
    {b.countryCode ? getCountryName(b.countryCode) : "Unknown country"}
    {#if regionName(b.regionCode)}<span class="text-[var(--muted)]">· {regionName(b.regionCode)}</span>{/if}
  </span>
  {#if b.mode === "moving"}
    <!-- NM and NMPZ show as reason chips. -->
    <span class="text-[var(--muted)]">{MODE_LABELS[b.mode]}</span>
  {/if}
  <span class="ml-auto flex flex-wrap gap-1">
    {#each bestGuessReasons(b) as reason (reason)}
      <span class="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent-soft-ink)]">
        {reason}
      </span>
    {/each}
  </span>
{/snippet}

<div class="space-y-6">
  <!-- Who carries where? -->
  <div class="space-y-2">
    {@render takeaway("Who carries where?", carryTakeaway(summaries, nameOf))}
    <div class="grid gap-3 md:grid-cols-2">
      {#each summaries as s (s.playerId)}
        <div class="space-y-2 rounded-lg border border-[var(--border)] px-3 py-2">
          {@render playerName(s.playerId)}
          <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <span class={statValue}>{formatPercent(s.bestShare)}</span>
              <span class={statLabel}>best guess</span>
            </div>
            <div>
              <span class={statValue}>{formatNumber(s.medianKm)}</span>
              <span class={statLabel}>median km off (not Splits)</span>
            </div>
            <div>
              <span class={statValue}>{formatSeconds(s.medianSeconds)}</span>
              <span class={statLabel}>median time to guess (pressed)</span>
            </div>
          </div>
          <p class={statLabel}>
            {formatPercent(s.timedOutShare)} of {formatNumber(s.placed)} guesses timed out ·
            no guess in {unitLabel("rounds", s.noGuess)}
          </p>
          <div class="flex flex-wrap gap-1">
            {#each chipsOf(s.playerId) as c (c.countryCode)}
              <span
                class="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-xs text-[var(--ink)]"
                title="Best guess in {formatPercent(c.share)} of {unitLabel('rounds', c.rounds)}"
              >
                {flagEmoji(c.countryCode)} {getCountryName(c.countryCode)} <span class="mono font-bold">{formatPercent(c.share)}</span>
              </span>
            {:else}
              <span class={statLabel}>
                No country with {unitLabel("rounds", greyOutRounds)} or more where {nameOf(s.playerId)} had the best guess 60%+ of the time.
              </span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <!-- Who guesses first? -->
    <div class="space-y-2">
      {@render takeaway("Who guesses first?", firstTakeaway(firsts, nameOf))}
      {#if firstSlices.length > 0}
        <PlotChart height={56} label="Who pressed guess first within the Duo" render={firstShareChart} />
      {/if}
      {#if whenFirst.length > 0}
        <PlotChart
          height={40 + whenFirst.length * 26}
          label="Each Player's best-guess share when they were first and when the other Player was"
          render={whenFirstChart}
        />
      {/if}
      <p class="text-[11px] text-[var(--muted)]">
        First is whoever pressed guess earlier; a pressed guess beats one the timer submitted. When both timed out,
        neither was first.
      </p>
    </div>

    <!-- Does waiting pay? -->
    <div class="space-y-2">
      {@render takeaway("Does waiting pay?", waitingTakeaway(summaries, nameOf))}
      <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table class="w-full text-xs">
          <thead class="text-[var(--muted)]">
            <tr>
              <th class="px-2 py-1 text-left font-semibold" rowspan="2">Player</th>
              <th class="px-2 py-1 text-center font-semibold" colspan="3">Pressed guess</th>
              <th class="px-2 py-1 text-center font-semibold" colspan="3">Timed out</th>
            </tr>
            <tr>
              {#each [0, 1] as i (i)}
                <th class={th}>Guesses</th>
                <th class={th}>Avg score</th>
                <th class={th}>Median km</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each summaries as s (s.playerId)}
              <tr class="border-t border-[var(--border)]">
                <td class="px-2 py-1">{@render playerName(s.playerId)}</td>
                {#each [...groupCells(s.waiting.pressed), ...groupCells(s.waiting.timedOut)] as value, i (i)}
                  <td class={td}>{value}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-[11px] text-[var(--muted)]">Rounds that aren't Splits; on a Split the other guess is a hedge.</p>
    </div>
  </div>

  <!-- Trends -->
  <div class="space-y-2">
    {@render takeaway(
      "Is each of us getting better?",
      trendTakeaway(trends, filtered.rounds.length, ROLLING_WINDOW_ROUNDS, nameOf),
    )}
    {#if hasTrend}
      <div class="grid gap-6 lg:grid-cols-2">
        <PlotChart height={220} label="Rolling best-guess share per Player" render={trendChart("bestShare")} />
        <PlotChart height={220} label="Rolling median km off per Player" render={trendChart("medianKm")} />
      </div>
    {/if}
  </div>

  <!-- Best guesses -->
  <div class="space-y-2">
    {@render takeaway(
      "Best guesses",
      "Guesses closest of all four, ranked by the lead over the next guess, others in another country, speed and how hard the Round was. A shortlist to look at, not a verdict.",
    )}
    <div class="grid gap-4 lg:grid-cols-2">
      {#each shortlist as { playerId, guesses } (playerId)}
        <div class="space-y-1">
          {@render playerName(playerId)}
          <ol class="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {#each guesses as b, i (b.roundId)}
              <li>
                {#if onOpenRound}
                  <button
                    type="button"
                    class="{rowClass} cursor-pointer hover:bg-[var(--surface-hover)]"
                    title={bestGuessTitle(b)}
                    onclick={() => onOpenRound(b.roundId)}
                  >
                    {@render bestGuessRow(b, i)}
                  </button>
                {:else}
                  <div class={rowClass} title={bestGuessTitle(b)}>{@render bestGuessRow(b, i)}</div>
                {/if}
              </li>
            {:else}
              <li class="px-2 py-2 text-xs text-[var(--muted)]">No guess was the closest of all four in this filter.</li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
  </div>
</div>
