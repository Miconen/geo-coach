<script lang="ts">
  // The numbers for a place or an area: the gap vs the Opponents, average score,
  // wrong-country rate (with the Opponents' under it) and Rounds.
  import type { AreaStats } from "@geo-coach/shared";
  import { formatNumber, formatPercent, formatSigned } from "../overview-text.js";

  let { stats }: { stats: AreaStats } = $props();

  const ours = $derived(stats.wrongCountryRate);
  const theirs = $derived(stats.opponentWrongCountryRate);
  // Coloured by who did better; neutral when either side is unknown.
  const wrongClass = $derived(
    ours === null || theirs === null ? "" : ours > theirs ? "text-red-400" : "text-green-400",
  );
</script>

<div class="flex gap-5">
  <div>
    <div class="text-lg font-bold {stats.gap < 0 ? 'text-red-400' : 'text-green-400'}">{formatSigned(stats.gap)}</div>
    <div class="stat-label">VS OPPONENTS</div>
  </div>
  <div>
    <div class="text-lg font-bold">{formatNumber(stats.avgScore)}</div>
    <div class="stat-label">AVG SCORE</div>
  </div>
  <div>
    <div class="text-lg font-bold {wrongClass}">{formatPercent(ours)}</div>
    <div class="stat-label">WRONG COUNTRY</div>
    <div class="text-[10px] text-white/50">Opponents {formatPercent(theirs)}</div>
  </div>
  <div>
    <div class="text-lg font-bold">{formatNumber(stats.rounds)}</div>
    <div class="stat-label">ROUNDS</div>
  </div>
</div>

<style>
  .stat-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: rgb(255 255 255 / 0.6);
  }
</style>
