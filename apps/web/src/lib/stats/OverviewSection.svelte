<script lang="ts">
  import * as Plot from "@observablehq/plot";
  import {
    CLOSE_SHARE_OF_COUNTRY_SIZE,
    getCountryName,
    overview,
    regionName,
    type LostRoundPoint,
    type RatingGapBand,
    type RatingGapPoint,
    type RatingPoint,
    type StatsFilter,
    type StatsPayload,
    type StreakRun,
  } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import {
    COUNTRY_FILTER_NOTE,
    MISTAKE_CLASS_COLORS,
    MISTAKE_CLASS_LABELS,
    climbingTakeaway,
    damageTakeaway,
    formatNumber,
    formatPercent,
    formatSeconds,
    formatSigned,
    ratedAboveTakeaway,
    unitLabel,
  } from "./overview-text.js";

  let { payload, filter }: { payload: StatsPayload; filter: StatsFilter } = $props();

  const o = $derived(overview(payload, filter));

  let xAxis = $state<"game" | "date">("game");

  const CLASS_COLOR = MISTAKE_CLASS_COLORS;
  const resultColor = (won: boolean | null) =>
    won === null ? "var(--muted)" : won ? "var(--ok)" : "var(--danger)";
  // Wider than Plot's default so tooltip lines don't wrap mid-phrase.
  const TIP = { lineWidth: 32 } as const;
  const dateLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

  // --- Are we climbing? ------------------------------------------------------

  type Band = { x1: number | Date; x2: number | Date };

  function ratingChart(width: number): SVGSVGElement | HTMLElement {
    const series = o.rating;
    const byGame = new Map(series.map((p) => [p.gameId, p]));
    const xOf = (p: RatingPoint): number | Date =>
      xAxis === "game" ? p.gameNumber : new Date(p.startedAtMs);
    const runBand = (run: StreakRun): Band[] => {
      const first = byGame.get(run.firstGameId);
      const last = byGame.get(run.lastGameId);
      if (!first || !last) return [];
      return xAxis === "game"
        ? [{ x1: first.gameNumber - 0.5, x2: last.gameNumber + 0.5 }]
        : [{ x1: new Date(first.startedAtMs), x2: new Date(last.startedAtMs) }];
    };
    const sessionBands: Band[] = payload.sessions.flatMap((s): Band[] => {
      const inSession = series.filter((p) => p.sessionId === s.id);
      if (inSession.length === 0) return [];
      return xAxis === "game"
        ? [{ x1: inSession[0]!.gameNumber - 0.5, x2: inSession.at(-1)!.gameNumber + 0.5 }]
        : [{ x1: new Date(s.startedAtMs), x2: new Date(s.endedAtMs) }];
    });
    const rated = series.filter((p) => p.rating !== null);
    return Plot.plot({
      width,
      height: 300,
      marginLeft: 48,
      x: { label: xAxis === "game" ? "Game" : null },
      y: { label: "Rating", grid: true, nice: true },
      marks: [
        Plot.rect(sessionBands, { x1: "x1", x2: "x2", fill: "var(--info)", fillOpacity: 0.1 }),
        Plot.rect(o.streaks.winRuns.flatMap(runBand), { x1: "x1", x2: "x2", fill: "var(--ok)", fillOpacity: 0.12 }),
        Plot.rect(o.streaks.lossRuns.flatMap(runBand), { x1: "x1", x2: "x2", fill: "var(--danger)", fillOpacity: 0.12 }),
        Plot.lineY(rated, { x: xOf, y: "rating", stroke: "var(--accent)", strokeWidth: 2 }),
        Plot.dot(rated, {
          x: xOf,
          y: "rating",
          r: 3,
          fill: (p: RatingPoint) => resultColor(p.won),
          tip: TIP,
          title: (p: RatingPoint) =>
            [
              `Game ${p.gameNumber} · ${dateLabel(p.startedAtMs)}`,
              `${p.won === null ? "No result" : p.won ? "Win" : "Loss"} against ${p.opponentRatingBefore ?? "?"}`,
              `Rating ${p.ratingBefore ?? "?"} → ${p.rating}${p.position !== null ? ` · #${p.position} in bucket` : ""}`,
            ].join("\n"),
        }),
      ],
    });
  }

  // --- Do we beat teams rated above us? ---------------------------------------

  const unitName = $derived(o.ratedAbove.unit === "games" ? "Games" : "Rounds");

  /** A tick step for net Damage that gives at most three ticks each side of zero. */
  function damageStep(max: number): number {
    for (const step of [500, 1000, 2500, 5000, 10000, 25000]) if (max / step <= 3) return step;
    return 50000;
  }

  function bandTitle(b: RatingGapBand): string {
    return [
      `Rating gap ${formatSigned(b.from)} to ${formatSigned(b.to)}`,
      `Won ${b.wins} of ${unitLabel(o.ratedAbove.unit, b.count)} (${formatPercent(b.winRate)})`,
      `Avg net damage ${formatSigned(b.avgNetDamage)}`,
      `  wins ${formatSigned(b.avgNetDamageWins)} · losses ${formatSigned(b.avgNetDamageLosses)}`,
      `Avg score gap per Round ${formatSigned(b.avgScoreGapPerRound)}`,
    ].join("\n");
  }

  function ratedAboveChart(width: number): SVGSVGElement | HTMLElement {
    const { points, bands } = o.ratedAbove;
    const maxNet = Math.max(1000, ...points.map((p) => Math.abs(p.netDamage)));
    // Net Damage shares the plot on a right-hand scale whose zero sits on the 50% line.
    const damageToY = (net: number) => 0.5 + (net / maxNet) * 0.47;
    const step = damageStep(maxNet);
    const top = Math.floor(maxNet / step) * step;
    const damageTicks: number[] = [];
    for (let v = -top; v <= top; v += step) damageTicks.push(v);
    const xs = [...points.map((p) => p.ratingGap), ...bands.map((b) => b.band)];
    const domain: [number, number] = xs.length
      ? [Math.min(...xs) - 10, Math.max(...xs) + 10]
      : [-100, 100];
    return Plot.plot({
      width,
      height: 260,
      marginTop: 28,
      marginLeft: 44,
      marginRight: 56,
      x: { label: "Rating gap (Opponents − us)", domain },
      y: { domain: [0, 1], axis: null },
      marks: [
        Plot.ruleX([0], { stroke: "var(--border-strong)" }),
        Plot.ruleY([0.5], { stroke: "var(--muted)", strokeDasharray: "3,3" }),
        Plot.dot(points, {
          x: "ratingGap",
          y: (p: RatingGapPoint) => damageToY(p.netDamage),
          r: 2.5,
          fill: (p: RatingGapPoint) => resultColor(p.won),
          fillOpacity: 0.65,
          tip: TIP,
          title: (p: RatingGapPoint) =>
            [
              `${dateLabel(p.startedAtMs)} · ${p.won ? "Win" : "Loss"}`,
              `Rating gap ${formatSigned(p.ratingGap)}`,
              `Net damage ${formatSigned(p.netDamage)}`,
            ].join("\n"),
        }),
        Plot.axisY([0, 0.25, 0.5, 0.75, 1], { anchor: "left", label: "Win rate", tickFormat: (d: number) => formatPercent(d) }),
        Plot.axisY(damageTicks.map(damageToY), {
          anchor: "right",
          label: "Net damage",
          tickFormat: (_y: number, i: number) => formatSigned(damageTicks[i]!),
          color: "var(--muted)",
        }),
        Plot.lineY(bands, { x: "band", y: "winRate", stroke: "var(--accent)", strokeWidth: 2 }),
        Plot.dot(bands, {
          x: "band",
          y: "winRate",
          r: 5,
          fill: "var(--accent)",
          tip: TIP,
          title: bandTitle,
        }),
        Plot.text(bands, {
          x: "band",
          y: "winRate",
          text: (b: RatingGapBand) => formatPercent(b.winRate),
          dy: -14,
          fill: "var(--ink)",
          stroke: "var(--surface)",
          strokeWidth: 4,
          fontWeight: "bold",
        }),
      ],
    });
  }

  // --- Where does our damage come from? ---------------------------------------

  const MIN_SHARE = 0.005;

  function lostRoundTitle(p: LostRoundPoint): string {
    const region = regionName(p.regionCode);
    return [
      `${getCountryName(p.countryCode)}${region ? ` · ${region}` : ""}`,
      `${MISTAKE_CLASS_LABELS[p.mistakeClass]}: ${formatNumber(p.km)} km off (${formatPercent(p.share)} of the country's size)`,
      `${formatNumber(p.points)} points · ${formatNumber(p.damage)} damage taken`,
      `${formatSeconds(p.secondsToGuess)} to guess${p.slow ? " (slow)" : ""}`,
    ].join("\n");
  }

  function damageChart(width: number): SVGSVGElement | HTMLElement {
    const points = o.damage.points;
    return Plot.plot({
      width,
      height: 260,
      marginLeft: 52,
      x: {
        type: "log",
        label: "Best guess off, as a share of the country's size",
        tickFormat: (d: number) => formatPercent(d),
        ticks: 5,
      },
      y: { label: "Damage taken", grid: true },
      marks: [
        Plot.ruleX([CLOSE_SHARE_OF_COUNTRY_SIZE], { stroke: "var(--accent)", strokeDasharray: "4,3" }),
        Plot.text([CLOSE_SHARE_OF_COUNTRY_SIZE], {
          x: (d: number) => d,
          frameAnchor: "top",
          text: () => "close ← → far",
          dy: 4,
          fill: "var(--accent)",
        }),
        Plot.dot(points, {
          x: (p: LostRoundPoint) => Math.max(p.share, MIN_SHARE),
          y: "damage",
          r: 3,
          fill: (p: LostRoundPoint) => CLASS_COLOR[p.mistakeClass],
          fillOpacity: 0.75,
          stroke: (p: LostRoundPoint) => (p.slow ? "var(--ink)" : "none"),
          strokeWidth: 1.5,
          tip: TIP,
          title: lostRoundTitle,
        }),
      ],
    });
  }

  const streakLabel = $derived(
    o.streaks.current > 0
      ? { icon: "🔥", count: o.streaks.current, text: o.streaks.current === 1 ? "win" : "wins in a row" }
      : o.streaks.current < 0
        ? { icon: "🥶", count: -o.streaks.current, text: o.streaks.current === -1 ? "loss" : "losses in a row" }
        : null,
  );

  const statValue = "text-2xl font-bold text-[var(--ink)]";
  const statLabel = "text-xs text-[var(--muted)]";
  const toggleClass =
    "rounded-md border border-[var(--border-strong)] px-2 py-0.5 aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent-soft-ink)]";
</script>

{#snippet takeaway(question: string, answer: string)}
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h3 class="text-sm font-bold text-[var(--ink)]">{question}</h3>
    <p class="text-xs text-[var(--muted)]">{answer}</p>
  </div>
{/snippet}

<div class="space-y-5">
  <div class="space-y-1">
    <div class="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <span class={statValue}>{formatNumber(o.games.rating)}</span>
        <span class={statLabel}>
          rating{o.games.ratingChange !== null ? ` (${formatSigned(o.games.ratingChange)})` : ""}{o.games.position !== null
            ? ` · #${formatNumber(o.games.position)} in bucket`
            : ""}
        </span>
      </div>
      {#if o.countryFiltered}
        <div>
          <span class={statValue}>{formatPercent(o.rounds.roundWinRate)}</span>
          <span class={statLabel}>of {unitLabel("rounds", o.rounds.roundsDecided)} won</span>
        </div>
      {:else}
        <div>
          <span class={statValue}>{formatPercent(o.games.winRate)}</span>
          <span class={statLabel}>win rate over {unitLabel("games", o.games.decided)}</span>
        </div>
      {/if}
      <div>
        {#if streakLabel}
          <span class={statValue}>{streakLabel.icon}{streakLabel.count}</span>
          <span class={statLabel}>{streakLabel.text}</span>
        {:else}
          <span class={statValue}>–</span>
        {/if}
        <span class={statLabel}>· best {o.streaks.best} · worst {o.streaks.worst}</span>
      </div>
      <div class="mono text-sm text-[var(--ink)]">
        {formatNumber(o.rounds.avgDuoScore)}
        <span class="text-[var(--muted)]">vs {formatNumber(o.rounds.avgOpponentScore)} score / Round</span>
      </div>
      <div class="mono text-sm text-[var(--ink)]">
        <span class="text-[var(--ok)]">+{formatNumber(o.rounds.avgDamageDealt)}</span>
        / <span class="text-[var(--danger)]">−{formatNumber(o.rounds.avgDamageTaken)}</span>
        <span class="text-[var(--muted)]">damage dealt / taken per Round</span>
      </div>
      <div class="mono text-sm text-[var(--ink)]">
        {formatSeconds(o.rounds.medianDuoSecondsToGuess)}
        <span class="text-[var(--muted)]">vs {formatSeconds(o.rounds.medianOpponentSecondsToGuess)} median time to guess</span>
      </div>
    </div>
    {#if o.countryFiltered}
      <p class="text-xs text-[var(--muted)]">{COUNTRY_FILTER_NOTE}</p>
    {/if}
  </div>

  <div class="space-y-2">
    <div class="flex flex-wrap items-end justify-between gap-2">
      {@render takeaway("Are we climbing?", climbingTakeaway(o))}
      <div class="flex items-center gap-1.5 text-xs" role="group" aria-label="Rating chart x-axis">
        <span class="text-[var(--muted)]">x-axis</span>
        <button type="button" class={toggleClass} aria-pressed={xAxis === "game"} onclick={() => (xAxis = "game")}>
          Game #
        </button>
        <button type="button" class={toggleClass} aria-pressed={xAxis === "date"} onclick={() => (xAxis = "date")}>
          Date
        </button>
      </div>
    </div>
    <PlotChart height={300} label="Rating over Games" render={ratingChart} />
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <div class="space-y-2">
      {@render takeaway("Do we beat teams rated above us?", ratedAboveTakeaway(o))}
      <PlotChart
        height={260}
        label="Win rate per rating-gap band, and net damage per {unitName === 'Games' ? 'Game' : 'Round'}"
        render={ratedAboveChart}
      />
      <p class="text-[11px] text-[var(--muted)]">
        Line: win rate per 50-point band (bands with fewer than 5 {unitName} hidden). Dots: {unitName} by net
        damage on the right axis, wins above the dashed line, losses below.
      </p>
    </div>
    <div class="space-y-2">
      {@render takeaway("Where does our damage come from?", damageTakeaway(o))}
      <PlotChart height={260} label="Lost Rounds by distance and damage taken" render={damageChart} />
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
        {#each o.damage.classes as c (c.mistakeClass)}
          <span>
            <span class="inline-block size-2 rounded-full" style:background={CLASS_COLOR[c.mistakeClass]}></span>
            {MISTAKE_CLASS_LABELS[c.mistakeClass]}: {unitLabel("rounds", c.rounds)}, {formatNumber(c.damage)} damage
          </span>
        {/each}
        <span>
          <span class="inline-block size-2 rounded-full border-[1.5px] border-[var(--ink)]"></span>
          slow (over {formatSeconds(o.damage.slowThresholdSeconds)})
        </span>
      </div>
    </div>
  </div>
</div>
