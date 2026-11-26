<script lang="ts">
  // A focused Round's transcript (#79, #83): each Utterance at its time from the Round's start and the Duo's guesses as
  // "📍 Mico guessed" when they happened. The Countdown sits in an amber band that opens on the guess that started it
  // (⚡, with its length) and closes on any Timed-out guess. The Round-end line follows: every guess's country,
  // distance and score, and both teams' HP, hidden under Recall until revealed (one reveal state with the map's).
  // Lines after it react to the reveal: dimmed, and hidden under Recall. Hovering a line lights that Player's callout.
  import Masked from "$lib/components/Masked.svelte";
  import { OPPONENT_COLOR, playerInk } from "$lib/player-color.js";
  import { formatKm } from "$lib/stats/map/features.js";
  import Damage from "./Damage.svelte";
  import { roundTranscript, type TranscriptLine } from "./transcript.js";
  import type { Debrief, DebriefRound } from "./types.js";
  import { clock, flag, playerName } from "./view.js";

  let {
    debrief,
    round,
    revealed,
    onReveal,
    onHover,
  }: {
    debrief: Debrief;
    round: DebriefRound;
    revealed: boolean;
    onReveal?: () => void;
    onHover: (playerId: string | null) => void;
  } = $props();

  const model = $derived(roundTranscript(round));
  const name = (id: string | null) => debrief.players[id ?? ""]?.name ?? "Player";
  const ink = (id: string | null, isDuo = true) => playerInk(isDuo ? (debrief.players[id ?? ""]?.color ?? "#60a5fa") : OPPONENT_COLOR);
  const hp = (n: number) => n.toLocaleString("en-US");
</script>

{#snippet line(l: TranscriptLine, inBand: boolean)}
  <li
    class="grid grid-cols-[2.6rem_1fr] gap-1.5 rounded px-1 py-0.5 hover:bg-[var(--surface-hover)] {l.after ? 'opacity-60' : ''}"
    data-testid="transcript-line"
    data-kind={l.kind}
    data-player={l.playerId ?? "opponents"}
    onmouseenter={() => onHover(l.playerId)}
  >
    <span class="font-mono text-[10px] text-[var(--muted)]">{clock(l.at)}</span>
    {#if l.kind === "speech"}
      <span
        ><span class="font-semibold" style="color:{ink(l.playerId)}">{name(l.playerId)}</span>
        {#if l.after}<Masked {revealed}>{l.text}</Masked>{:else}{l.text}{/if}</span
      >
    {:else}
      <span class="italic text-[var(--muted)]" data-testid={l.first ? "countdown-opener" : l.timedOut ? "timed-out" : undefined}>
        {l.timedOut ? "⏱" : "📍"}
        <span class="font-semibold not-italic" style="color:{ink(l.playerId, l.isDuo)}">{l.isDuo ? name(l.playerId) : "Opponents"}</span>
        {l.timedOut ? "timed out" : "guessed"}{#if l.first}{" "}<span class="not-italic text-amber-400" title="Guessed first: started the Countdown">⚡</span
          >{#if inBand && model.band}<span
              class="float-right text-[10px] font-semibold uppercase not-italic tracking-wide text-amber-400"
              data-testid="countdown-length">Countdown {model.band.lengthS}s</span
            >{/if}{/if}
      </span>
    {/if}
  </li>
{/snippet}

{#if !debrief.recorded}
  <p class="text-xs text-[var(--muted)]" data-testid="transcript-not-recorded">No one recorded this Game, so there's no transcript.</p>
{:else}
  <ol class="space-y-0.5 text-xs" onmouseleave={() => onHover(null)} data-testid="round-transcript">
    {#each model.before as l (l.id)}{@render line(l, false)}{/each}
    {#if model.band}
      <li class="my-1 rounded-md bg-amber-400/10 py-0.5 ring-1 ring-amber-400/30" data-testid="countdown-band">
        <ol class="space-y-0.5">{#each model.band.lines as l (l.id)}{@render line(l, true)}{/each}</ol>
      </li>
    {/if}

    <li class="my-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1.5" data-testid="round-over">
      <p class="flex items-center gap-2 text-[10px] font-semibold uppercase text-[var(--muted)]">
        <span>{clock(round.endS)} · Round over</span>
        <span class="ml-auto normal-case"><Damage hp={round.hpDelta} /></span>
      </p>
      {#if revealed}
        <ul class="mt-1 space-y-0.5" data-testid="round-end-guesses">
          {#each round.guesses as g, i (i)}
            <li class="grid grid-cols-[4.5rem_1fr_4rem_2.8rem] items-center gap-1 {g.isDuo ? '' : 'text-[var(--muted)]'}" data-testid="round-end-guess">
              <span class="truncate font-semibold" style="color:{ink(g.playerId, g.isDuo)}">{playerName(debrief, g)}</span>
              <span class="truncate">{flag(g.countryCode)}{g.countryCode && g.countryCode === round.countryCode ? " ✓" : ""}</span>
              <span class="text-right font-mono text-[10px]">{formatKm(g.distanceMeters)}</span>
              <span class="text-right font-mono tabular-nums {g.isBestForTeam ? 'font-bold' : ''}">{g.score.toLocaleString("en-US")}</span>
            </li>
          {/each}
        </ul>
        <p class="mt-1 flex gap-3 border-t border-[var(--border)] pt-1 text-[10px] text-[var(--muted)]" data-testid="round-end-hp">
          <span>HP us {hp(round.hpBefore.duo)} → <b class="text-[var(--ink)]">{hp(round.hpAfter.duo)}</b></span>
          <span>them {hp(round.hpBefore.opponents)} → <b class="text-[var(--ink)]">{hp(round.hpAfter.opponents)}</b></span>
        </p>
      {:else}
        <button
          type="button"
          class="mt-1 w-full rounded bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--accent)]"
          data-testid="round-end-reveal"
          onclick={() => onReveal?.()}
        >
          Reveal guesses, scores and HP
        </button>
      {/if}
    </li>

    {#each model.after as l (l.id)}{@render line(l, false)}{/each}
    {#if round.transcript.length === 0}<li class="text-[var(--muted)]">No speech in this Round.</li>{/if}
  </ol>
{/if}
