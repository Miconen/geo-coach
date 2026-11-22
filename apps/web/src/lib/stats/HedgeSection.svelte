<script lang="ts">
  // "How do we place our two guesses?" in the Rankings section (#41): our
  // Committed / Spread / Split Rounds next to the Opponents' as the baseline, and
  // our Splits and Spreads by Call. A Round panel: it follows the whole filter.
  import * as Plot from "@observablehq/plot";
  import { HEDGE_KINDS, type HedgeKind, type HedgeKindStats, type HedgeSummary } from "@geo-coach/shared";
  import PlotChart from "./PlotChart.svelte";
  import {
    HEDGE_KIND_HINTS,
    HEDGE_KIND_LABELS,
    callsNote,
    hedgeTakeaway,
    kindOf,
    kindTitle,
  } from "./hedge-text.js";
  import { formatNumber, formatPercent, formatSigned } from "./overview-text.js";

  let { summary, greyOutRounds }: { summary: HedgeSummary; greyOutRounds: number } = $props();

  type Bar = { kind: HedgeKind; team: "We" | "Opponents"; stats: HedgeKindStats };
  const bars = $derived<Bar[]>(
    HEDGE_KINDS.flatMap((kind) => [
      { kind, team: "We" as const, stats: kindOf(summary.duo, kind) },
      { kind, team: "Opponents" as const, stats: kindOf(summary.opponents, kind) },
    ]),
  );

  const TEAM_COLORS = { We: "var(--accent)", Opponents: "var(--muted)" };

  function shareChart(width: number): SVGSVGElement | HTMLElement {
    return Plot.plot({
      width,
      height: 150,
      marginLeft: 76,
      x: { label: "Share of Rounds", tickFormat: "%", domain: [0, 1], grid: true },
      y: { label: null, domain: ["We", "Opponents"], axis: null },
      fy: { label: null, domain: HEDGE_KINDS, tickFormat: (k: HedgeKind) => HEDGE_KIND_LABELS[k] },
      marks: [
        Plot.barX(bars, {
          fy: "kind",
          y: "team",
          x: (b: Bar) => b.stats.share ?? 0,
          fill: (b: Bar) => TEAM_COLORS[b.team],
          fillOpacity: (b: Bar) => (b.stats.rounds < greyOutRounds ? 0.35 : 0.85),
          tip: { lineWidth: 34 },
          title: (b: Bar) => kindTitle(b.stats, b.team),
        }),
        Plot.text(bars, {
          fy: "kind",
          y: "team",
          x: (b: Bar) => b.stats.share ?? 0,
          text: (b: Bar) => formatPercent(b.stats.share),
          dx: 4,
          textAnchor: "start",
          fill: "var(--muted)",
        }),
      ],
    });
  }

  type Row = { label: string; title?: string; value: (k: HedgeKindStats) => string; tone?: (k: HedgeKindStats) => string | undefined };
  const signedTone = (n: number | null) => (n === null ? undefined : n >= 0 ? "var(--ok)" : "var(--danger)");
  const ROWS: Row[] = [
    { label: "Rounds", value: (k) => formatNumber(k.rounds) },
    { label: "Share", title: "Share of the team's Rounds with both guesses placed", value: (k) => formatPercent(k.share) },
    { label: "Score gap", title: "The team's best score minus the other team's, per Round", value: (k) => formatSigned(k.avgScoreGap), tone: (k) => signedTone(k.avgScoreGap) },
    { label: "Damage", title: "Damage dealt minus taken by the team, per Round", value: (k) => formatSigned(k.avgDamage), tone: (k) => signedTone(k.avgDamage) },
    { label: "Right country", title: "Either of the team's guesses in the right country", value: (k) => formatPercent(k.rightCountry) },
    { label: "Right Region", title: "Either of the team's guesses in the right Region", value: (k) => formatPercent(k.rightRegion) },
  ];

  const greyed = (kind: HedgeKind) => kindOf(summary.duo, kind).rounds < greyOutRounds;
  const callsOf = (kind: HedgeKind) => (kind === "committed" ? null : summary.calls[kind]);
  const cell = "px-1.5 py-1 text-right mono align-top";
</script>

<div class="space-y-2">
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h3 class="text-sm font-bold text-[var(--ink)]">How do we place our two guesses?</h3>
    <p class="text-xs text-[var(--muted)]">{hedgeTakeaway(summary, greyOutRounds)}</p>
  </div>

  {#if summary.duo.classified + summary.opponents.classified > 0}
    <PlotChart height={150} label="Share of Rounds Committed, Spread and Split, ours against the Opponents'" render={shareChart} />
    <div class="flex gap-3 text-[11px] text-[var(--muted)]">
      <span><span class="inline-block size-2 rounded-sm bg-[var(--accent)]"></span> We</span>
      <span><span class="inline-block size-2 rounded-sm bg-[var(--muted)]"></span> Opponents</span>
    </div>

    <table class="w-full text-xs">
      <thead>
        <tr class="text-[var(--muted)]">
          <th></th>
          {#each HEDGE_KINDS as kind (kind)}
            <th class="px-1.5 py-1 text-right font-semibold {greyed(kind) ? 'opacity-45' : ''}" title={HEDGE_KIND_HINTS[kind]}>
              {HEDGE_KIND_LABELS[kind]}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each ROWS as row (row.label)}
          <tr class="border-t border-[var(--border)]">
            <th class="px-1 py-1 text-left font-normal text-[var(--muted)]" title={row.title}>{row.label}</th>
            {#each HEDGE_KINDS as kind (kind)}
              {@const ours = kindOf(summary.duo, kind)}
              {@const theirs = kindOf(summary.opponents, kind)}
              <td class="{cell} {greyed(kind) ? 'opacity-45' : ''}" title={kindTitle(ours, "We")}>
                <div class="font-semibold" style:color={row.tone?.(ours)}>{row.value(ours)}</div>
                <div class="text-[10px] text-[var(--muted)]" title={kindTitle(theirs, "Opponents")}>Opp {row.value(theirs)}</div>
              </td>
            {/each}
          </tr>
        {/each}
        <tr class="border-t border-[var(--border-strong)]">
          <th class="px-1 pt-2 pb-1 text-left text-[11px] font-semibold text-[var(--ink)]" colspan="4">Our Calls</th>
        </tr>
        {#each [["Called", "called"], ["Not called", "notCalled"], ["Unlabelled", "unlabelled"]] as const as [label, key] (key)}
          <tr class="border-t border-[var(--border)]">
            <th class="px-1 py-1 text-left font-normal text-[var(--muted)]">{label}</th>
            {#each HEDGE_KINDS as kind (kind)}
              {@const calls = callsOf(kind)}
              <td class="{cell} {greyed(kind) ? 'opacity-45' : ''}">{calls ? formatNumber(calls[key]) : ""}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="text-[11px] text-[var(--muted)]">
      {callsNote(summary)} We may commit when we're already sure, so these numbers describe the Rounds; they don't
      show what placing the guesses differently would have done.
    </p>
  {/if}
</div>
