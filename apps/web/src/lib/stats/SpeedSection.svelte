<script lang="ts">
  // The Speed section of /stats (#42): are we slower than the Opponents, who
  // presses guess first and how those Rounds go, whether guessing fast pays in
  // points, and whether we're getting faster. Teams are compared on each team's
  // first pressed guess; timed-out guesses never count as a time to guess.
  import * as Plot from "@observablehq/plot";
  import {
    applyFilter,
    smoothingWindow,
    speedStats,
    type ScoreByTimeRow,
    type SmoothingLevel,
    type SpeedPoint,
    type SpeedSpread,
    type StatsFilter,
    type StatsPayload,
  } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import { formatNumber, formatPercent, formatSeconds, formatSigned, unitLabel } from "./overview-text.js";
  import { playerColor } from "./players-text.js";
  import {
    FIRST_TEAM_LABELS,
    MIN_BUCKET_GUESSES,
    bucketLabel,
    fasterTrendTakeaway,
    firstTeamTakeaway,
    slowerTakeaway,
    speedPaysTakeaway,
    spreadLabel,
  } from "./speed-text.js";

  let {
    payload,
    filter,
    smoothing,
  }: { payload: StatsPayload; filter: StatsFilter; smoothing: SmoothingLevel } = $props();

  const filtered = $derived(applyFilter(payload, filter));
  const players = $derived(payload.players);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.displayName ?? "?";
  const window = $derived(smoothingWindow(smoothing, "rounds"));
  const stats = $derived(speedStats(filtered, players, window));

  const DUO = "var(--accent)";
  const OPPONENTS = "var(--danger)";
  const TIP = { lineWidth: 32 } as const;

  function spreadColor(s: SpeedSpread): string {
    switch (s.group.kind) {
      case "duo-first":
        return DUO;
      case "opponents-first":
      case "opponent-each":
        return OPPONENTS;
      case "player":
        return playerColor(Math.max(0, players.findIndex((p) => p.id === (s.group as { playerId: string }).playerId)));
    }
  }

  // --- Are we slower than the Opponents? ----------------------------------------

  type SpreadRow = SpeedSpread & { label: string; fill: string };
  const spreads = $derived<SpreadRow[]>(
    stats.spreads
      .filter((s) => s.median !== null)
      .map((s) => ({ ...s, label: spreadLabel(s, nameOf), fill: spreadColor(s) })),
  );
  const spreadHeight = $derived(40 + spreads.length * 28);

  function spreadChart(width: number): SVGSVGElement | HTMLElement {
    const title = (s: SpreadRow) =>
      [
        `${s.label}: ${formatNumber(s.count)} pressed guesses`,
        `Median ${formatSeconds(s.median)}`,
        `Middle half ${formatSeconds(s.p25)} – ${formatSeconds(s.p75)}`,
      ].join("\n");
    return Plot.plot({
      width,
      height: spreadHeight,
      marginLeft: 120,
      x: { label: "Seconds to guess (middle half, and median)", grid: true, nice: true },
      y: { label: null, domain: spreads.map((s) => s.label) },
      marks: [
        Plot.barX(spreads, { y: "label", x1: "p25", x2: "p75", fill: "fill", fillOpacity: 0.3, insetTop: 6, insetBottom: 6 }),
        Plot.tickX(spreads, { y: "label", x: "median", stroke: "fill", strokeWidth: 3, tip: TIP, title }),
        Plot.text(spreads, {
          y: "label",
          x: "p75",
          text: (s: SpreadRow) => formatSeconds(s.median),
          dx: 6,
          textAnchor: "start",
          fill: "var(--ink)",
        }),
      ],
    });
  }

  // --- Who presses first? --------------------------------------------------------

  const firstRows = $derived(stats.firstTeams.filter((f) => f.rounds > 0));

  // --- Does speed pay? -----------------------------------------------------------

  type BucketRow = ScoreByTimeRow & { bucket: string; enough: boolean };
  const bucketRows = $derived<BucketRow[]>(
    stats.scoreByTime.map((r) => ({ ...r, bucket: bucketLabel(r), enough: r.guesses >= MIN_BUCKET_GUESSES })),
  );
  const bucketDomain = $derived([...new Set(bucketRows.map((r) => r.bucket))]);

  function scoreByTimeChart(width: number): SVGSVGElement | HTMLElement {
    const sideColor = (r: BucketRow) => (r.side === "duo" ? DUO : OPPONENTS);
    const pressed = bucketRows.filter((r) => !r.timedOut && r.enough && r.avgScore !== null);
    const shown = bucketRows.filter((r) => r.avgScore !== null && r.guesses > 0);
    return Plot.plot({
      width,
      height: 260,
      marginLeft: 48,
      x: { type: "point", domain: bucketDomain, label: "Seconds to guess", padding: 0.4 },
      y: { label: "Avg score per guess", grid: true, domain: [0, 5000] },
      marks: [
        Plot.lineY(pressed, { x: "bucket", y: "avgScore", z: "side", stroke: sideColor, strokeWidth: 2 }),
        Plot.dot(shown, {
          x: "bucket",
          y: "avgScore",
          r: 4,
          fill: sideColor,
          fillOpacity: (r: BucketRow) => (r.enough ? 1 : 0.25),
          tip: TIP,
          title: (r: BucketRow) =>
            [
              `${r.side === "duo" ? "Our" : "Their"} guesses, ${r.bucket}`,
              `${formatNumber(r.avgScore)} points on average over ${formatNumber(r.guesses)}`,
              `Median ${formatNumber(r.medianKm)} km off`,
              r.enough ? "" : `(fewer than ${MIN_BUCKET_GUESSES} guesses)`,
            ]
              .filter(Boolean)
              .join("\n"),
        }),
      ],
    });
  }

  // --- Are we getting faster? -----------------------------------------------------

  type TrendRow = { roundIndex: number; side: "Us" | "Opponents"; seconds: number };
  const trendRows = $derived<TrendRow[]>(
    stats.series.flatMap((p: SpeedPoint) => [
      ...(p.duoMedian === null ? [] : [{ roundIndex: p.roundIndex, side: "Us" as const, seconds: p.duoMedian }]),
      ...(p.opponentsMedian === null
        ? []
        : [{ roundIndex: p.roundIndex, side: "Opponents" as const, seconds: p.opponentsMedian }]),
    ]),
  );

  function trendChart(width: number): SVGSVGElement | HTMLElement {
    return Plot.plot({
      width,
      height: 220,
      marginLeft: 48,
      x: { label: `Round (end of each ${window}-Round window)` },
      y: { label: "Median seconds to first guess", grid: true, nice: true },
      color: { domain: ["Us", "Opponents"], range: [DUO, OPPONENTS], legend: true },
      marks: [
        Plot.lineY(trendRows, {
          x: "roundIndex",
          y: "seconds",
          stroke: "side",
          strokeWidth: 2,
          tip: TIP,
          title: (r: TrendRow) =>
            `${r.side} · Rounds ${r.roundIndex - window + 1}–${r.roundIndex}\nMedian ${formatSeconds(r.seconds)} to first guess`,
        }),
      ],
    });
  }

  const netClass = (n: number | null) =>
    n === null || Math.round(n) === 0 ? "" : n > 0 ? "text-[var(--ok)]" : "text-[var(--danger)]";

  const th = "px-2 py-1 text-right font-semibold whitespace-nowrap";
  const td = "px-2 py-1 text-right mono";
</script>

{#snippet takeaway(question: string, answer: string)}
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h3 class="text-sm font-bold text-[var(--ink)]">{question}</h3>
    <p class="text-xs text-[var(--muted)]">{answer}</p>
  </div>
{/snippet}

<div class="space-y-6">
  <div class="grid gap-6 lg:grid-cols-2">
    <div class="space-y-2">
      {@render takeaway("Are we slower than the Opponents?", slowerTakeaway(stats))}
      {#if spreads.length > 0}
        <PlotChart height={spreadHeight} label="Time to guess per team and Player" render={spreadChart} />
      {/if}
      <p class="text-[11px] text-[var(--muted)]">
        Bars span the middle half of pressed guesses; the thick tick is the median. A team's first guess is
        whichever of its two Players pressed guess first. Timed-out guesses are left out: their time is just the
        timer.
      </p>
    </div>

    <div class="space-y-2">
      {@render takeaway("Who presses guess first?", firstTeamTakeaway(stats))}
      {#if firstRows.length > 0}
        <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table class="w-full text-xs">
            <thead class="text-[var(--muted)]">
              <tr>
                <th class="px-2 py-1 text-left font-semibold">Round</th>
                <th class={th}>Rounds</th>
                <th class={th}>Share</th>
                <th class={th} title="Rounds we dealt Damage in, ties left out">Won</th>
                <th class={th} title="Damage dealt minus taken per Round">Net damage</th>
                <th class={th}>Our score</th>
                <th class={th}>Their score</th>
              </tr>
            </thead>
            <tbody>
              {#each firstRows as row (row.team)}
                <tr class="border-t border-[var(--border)]">
                  <td class="px-2 py-1 text-[var(--ink)]">{FIRST_TEAM_LABELS[row.team]}</td>
                  <td class={td}>{formatNumber(row.rounds)}</td>
                  <td class={td}>{formatPercent(row.share)}</td>
                  <td class={td}>{formatPercent(row.roundWinRate)}</td>
                  <td class="{td} {netClass(row.avgNetDamage)}">{formatSigned(row.avgNetDamage)}</td>
                  <td class={td}>{formatNumber(row.avgDuoScore)}</td>
                  <td class={td}>{formatNumber(row.avgOpponentScore)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <p class="text-[11px] text-[var(--muted)]">
        The first press starts the other team's countdown. Pressing first and winning is pressure that pays; pressing
        first and losing may mean rushing.
      </p>
    </div>
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <div class="space-y-2">
      {@render takeaway("Does guessing fast pay?", speedPaysTakeaway(stats.scoreByTime))}
      <PlotChart height={260} label="Average score per guess by time to guess, for both teams" render={scoreByTimeChart} />
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
        <span><span class="inline-block size-2 rounded-full" style:background={DUO}></span> Our guesses</span>
        <span><span class="inline-block size-2 rounded-full" style:background={OPPONENTS}></span> Opponents' guesses</span>
        <span>
          Every placed guess, Splits left out. Faint dots have fewer than {MIN_BUCKET_GUESSES} guesses. Slow guesses
          are often hard Rounds, so this shows where time goes with points, not that waiting causes them.
        </span>
      </div>
    </div>

    <div class="space-y-2">
      {@render takeaway("Are we getting faster?", fasterTrendTakeaway(stats.series, stats.rounds, window))}
      {#if trendRows.length > 0}
        <PlotChart height={220} label="Rolling median time to each team's first guess" render={trendChart} />
      {/if}
      <p class="text-[11px] text-[var(--muted)]">
        Rolling {unitLabel("rounds", window)} (set by Smoothing in the filter bar).
      </p>
    </div>
  </div>
</div>
