<script lang="ts">
  import type { WorkbenchPlayer, WorkbenchRound, WorkbenchUtterance } from "$lib/server/workbench/view-model.js";

  interface Props {
    round: WorkbenchRound;
    players: Record<string, WorkbenchPlayer>;
    utterancesById: Record<string, WorkbenchUtterance>;
    recallHidden?: boolean;
    highlighted?: boolean;
    onSelectUtterance?: (utteranceId: string) => void;
  }

  let {
    round,
    players,
    utterancesById,
    recallHidden = false,
    highlighted = false,
    onSelectUtterance,
  }: Props = $props();

  const totalMs = $derived(
    Math.max(1, Date.parse(round.resultsEndTime) - Date.parse(round.startTime)),
  );

  const duoGuesses = $derived(round.guesses.filter((g) => g.isDuo));
  const bestDuoGuess = $derived(duoGuesses.find((g) => g.isBestForTeam) ?? duoGuesses[0] ?? null);
  const wrongCountry = $derived(
    Boolean(bestDuoGuess?.countryCode && round.countryCode && bestDuoGuess.countryCode !== round.countryCode),
  );

  const phaseFractions = $derived(
    round.phases.map((p) => ({
      phase: p.phase,
      fr: Math.max(1, Date.parse(p.endedAt) - Date.parse(p.startedAt)),
    })),
  );

  const utteranceMarkers = $derived(
    round.utteranceIds
      .map((id) => utterancesById[id])
      .filter((u): u is WorkbenchUtterance => Boolean(u))
      .map((u) => {
        const pct = Math.max(
          0,
          Math.min(100, ((Date.parse(u.startedAt) - Date.parse(round.startTime)) / totalMs) * 100),
        );
        const speaker = players[u.playerId];
        return {
          id: u.id,
          pct,
          color: speaker?.avatarColor ?? "#2563eb",
          tooltip: recallHidden ? "Utterance" : `${speaker?.displayName ?? "Player"}: ${u.text}`,
        };
      }),
  );
</script>

<div
  class="rounded-lg border p-3 transition-colors {highlighted
    ? 'border-[var(--accent)] bg-[var(--accent-soft)]/40'
    : 'border-[var(--border)] bg-[var(--surface-subtle)]'}"
>
  <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
    <div class="flex items-center gap-2">
      <span class="mono font-semibold text-[var(--ink)]">R{round.roundNumber}</span>
      {#if recallHidden}
        <span class="rounded bg-[var(--badge-bg)] px-1.5 py-0.5 text-[var(--muted)]">Hidden in Recall</span>
      {:else}
        <span
          class="rounded px-1.5 py-0.5 font-semibold {wrongCountry
            ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--ok-bg)] text-[var(--ok)]'}"
        >
          {#if wrongCountry}
            {bestDuoGuess?.countryCode ?? "?"} → {round.countryCode ?? "?"}
          {:else}
            {round.countryCode ?? "?"} {round.countryName ?? ""}
          {/if}
        </span>
        {#if round.regionName}
          <span class="text-[var(--muted)]">{round.regionName}</span>
        {/if}
      {/if}
    </div>

    <div class="flex items-center gap-1.5">
      <span class="mono rounded bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] border border-[var(--border)]">
        {round.replayPlayerCount > 0 ? `Replay · ${round.replayPlayerCount}p` : "No replay"}
      </span>
      <span
        class="mono rounded px-1.5 py-0.5 text-[11px] font-semibold {round.hpDelta >= 0
          ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
          : 'bg-[var(--danger-bg)] text-[var(--danger)]'}"
      >
        {round.hpDelta >= 0 ? "+" : ""}{round.hpDelta} HP{round.damageMultiplier > 1 ? ` (×${round.damageMultiplier})` : ""}
      </span>
    </div>
  </div>

  <!-- 0-5000 Duo score meter with Opponent score tick -->
  <div class="mt-2">
    <div class="relative h-2 w-full rounded-full bg-[var(--meter-track)] overflow-hidden">
      <div
        class="h-full rounded-full bg-[var(--accent)]"
        style="width: {Math.min(100, (round.duoBestScore / 5000) * 100)}%"
      ></div>
      <div
        title="Opponent best: {round.opponentBestScore}"
        class="absolute top-0 bottom-0 w-0.5 bg-[var(--danger)]"
        style="left: {Math.min(100, (round.opponentBestScore / 5000) * 100)}%"
      ></div>
    </div>
    <div class="mt-1 flex justify-between text-[11px] text-[var(--muted)] mono">
      <span>Duo {round.duoBestScore}</span>
      <span>Opp {round.opponentBestScore}</span>
    </div>
  </div>

  <!-- Per-Player guesses -->
  {#if duoGuesses.length > 0 && !recallHidden}
    <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
      {#each duoGuesses as g}
        {@const pl = g.playerId ? players[g.playerId] : null}
        <span
          class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 bg-[var(--surface)] {g.isBestForTeam
            ? 'border-[var(--accent)] font-medium text-[var(--ink)]'
            : 'border-[var(--border)] text-[var(--muted)]'}"
        >
          <span
            class="h-2 w-2 rounded-full"
            style="background: color-mix(in srgb, {pl?.avatarColor ?? '#2563eb'}, #ffffff var(--speaker-lighten))"
          ></span>
          {pl?.displayName ?? g.nick ?? "Duo"}: {g.countryCode ?? "?"} · {g.score}pt
          {#if g.distanceMeters !== null}
            · {Math.round(g.distanceMeters / 1000)}km
          {/if}
          {#if g.guessedFirst}
            <span class="rounded bg-[var(--info-bg)] px-1 text-[10px] text-[var(--info)]">1st</span>
          {/if}
        </span>
      {/each}
    </div>
  {/if}

  <!-- Proportional phase bar (Play / CD / Res) with clickable Utterance markers -->
  <div class="mt-2.5">
    <div
      class="relative grid h-5 gap-0.5 overflow-hidden rounded"
      style="grid-template-columns: {phaseFractions.map((p) => `${p.fr}fr`).join(' ')}"
    >
      {#each phaseFractions as seg}
        <div
          class="flex items-center justify-center text-[10px] font-medium {seg.phase === 'play'
            ? 'bg-[var(--phase-play-bg)] text-[var(--phase-play-ink)]'
            : seg.phase === 'countdown'
              ? 'bg-[var(--phase-cd-bg)] text-[var(--phase-cd-ink)]'
              : 'bg-[var(--phase-res-bg)] text-[var(--phase-res-ink)]'}"
        >
          {seg.phase === "play" ? "Play" : seg.phase === "countdown" ? "CD" : "Res"}
        </div>
      {/each}

      {#each utteranceMarkers as marker}
        <button
          type="button"
          title={marker.tooltip}
          onclick={() => onSelectUtterance?.(marker.id)}
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-[var(--surface)] shadow hover:scale-125"
          style="left: {marker.pct}%; background: color-mix(in srgb, {marker.color}, #ffffff var(--speaker-lighten))"
          aria-label="Jump to Utterance"
        ></button>
      {/each}
    </div>
  </div>
</div>
