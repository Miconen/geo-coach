<script lang="ts">
  // The hedge block in a country's detail pane (#41): our Committed / Spread /
  // Split Rounds there, with the average score gap of each and the Opponents'
  // share as the baseline. Kinds below the grey-out threshold are greyed.
  import { HEDGE_KINDS, teamHedgeSummary, type StatsRound } from "@geo-coach/shared";
  import {
    HEDGE_KIND_HINTS,
    HEDGE_KIND_LABELS,
    countryHedgeTakeaway,
    kindOf,
    kindTitle,
  } from "./hedge-text.js";
  import { formatPercent, formatSigned, unitLabel } from "./overview-text.js";

  let {
    rounds,
    countryName,
    greyOutRounds,
  }: { rounds: readonly StatsRound[]; countryName: string; greyOutRounds: number } = $props();

  const duo = $derived(teamHedgeSummary(rounds, "duo"));
  const opponents = $derived(teamHedgeSummary(rounds, "opponents"));
</script>

<div class="space-y-1">
  <div class="border-l-4 border-[var(--accent)] pl-3">
    <h4 class="text-sm font-bold text-[var(--ink)]">How we place our two guesses here</h4>
    <p class="text-xs text-[var(--muted)]">{countryHedgeTakeaway(duo, countryName, greyOutRounds)}</p>
  </div>
  <div class="grid grid-cols-3 gap-2 text-xs">
    {#each HEDGE_KINDS as kind (kind)}
      {@const ours = kindOf(duo, kind)}
      {@const theirs = kindOf(opponents, kind)}
      <div
        class="rounded-md border border-[var(--border)] px-2 py-1.5 {ours.rounds < greyOutRounds ? 'opacity-45' : ''}"
        title={`${HEDGE_KIND_HINTS[kind]}\n\n${kindTitle(ours, "We")}\n\n${kindTitle(theirs, "Opponents")}`}
      >
        <div class="text-[11px] uppercase tracking-wide text-[var(--muted)]">{HEDGE_KIND_LABELS[kind]}</div>
        <div class="mono text-base font-bold" style:color={ours.avgScoreGap === null ? undefined : ours.avgScoreGap >= 0 ? "var(--ok)" : "var(--danger)"}>
          {formatSigned(ours.avgScoreGap)}
        </div>
        <div class="text-[var(--muted)]">
          {unitLabel("rounds", ours.rounds)} · {formatPercent(ours.share)}
          <span class="block text-[10px]">Opp {formatPercent(theirs.share)}</span>
        </div>
      </div>
    {/each}
  </div>
</div>
