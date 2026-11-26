<script lang="ts">
  // A focused Round's transcript (#79): each Utterance at its time from the Round's start, the Duo's guesses as
  // "📍 Mico guessed" when they happened, and a "Round over" divider at the end of guessing. Lines after it react to
  // the reveal: dimmed, and hidden under Recall. Hovering a line lights that Player's callout on the map.
  import Masked from "$lib/components/Masked.svelte";
  import { playerInk } from "$lib/player-color.js";
  import Damage from "./Damage.svelte";
  import type { Debrief, DebriefRound } from "./types.js";
  import { clock } from "./view.js";

  let {
    debrief,
    round,
    revealed,
    onHover,
  }: { debrief: Debrief; round: DebriefRound; revealed: boolean; onHover: (playerId: string | null) => void } = $props();

  type Line =
    | { kind: "speech"; at: number; id: string; playerId: string; text: string; after: boolean }
    | { kind: "guess"; at: number; id: string; playerId: string; after: boolean };

  const lines = $derived<Line[]>(
    [
      ...round.transcript.map((u) => ({ kind: "speech" as const, at: u.atS, id: u.id, playerId: u.playerId, text: u.text, after: u.afterEnd })),
      // The Duo's guesses, bare: no country or score, since nobody knows them yet.
      ...round.guesses.flatMap((g, i) =>
        g.isDuo && g.playerId && g.secondsToGuess !== null
          ? [{ kind: "guess" as const, at: g.secondsToGuess, id: `guess-${i}`, playerId: g.playerId, after: g.secondsToGuess >= round.endS }]
          : [],
      ),
    ].sort((a, b) => a.at - b.at),
  );
  const before = $derived(lines.filter((l) => !l.after));
  const after = $derived(lines.filter((l) => l.after));
  const name = (id: string) => debrief.players[id]?.name ?? "Player";
  const ink = (id: string) => playerInk(debrief.players[id]?.color ?? "#60a5fa");
</script>

{#snippet line(l: Line)}
  <li
    class="grid grid-cols-[2.6rem_1fr] gap-1.5 rounded px-1 py-0.5 hover:bg-[var(--surface-hover)] {l.after ? 'opacity-60' : ''}"
    data-testid="transcript-line"
    data-player={l.playerId}
    onmouseenter={() => onHover(l.playerId)}
  >
    <span class="font-mono text-[10px] text-[var(--muted)]">{clock(l.at)}</span>
    {#if l.kind === "speech"}
      <span
        ><span class="font-semibold" style="color:{ink(l.playerId)}">{name(l.playerId)}</span>
        {#if l.after}<Masked {revealed}>{l.text}</Masked>{:else}{l.text}{/if}</span
      >
    {:else}
      <span class="italic text-[var(--muted)]">📍 <span class="font-semibold not-italic" style="color:{ink(l.playerId)}">{name(l.playerId)}</span> guessed</span>
    {/if}
  </li>
{/snippet}

{#if !debrief.recorded}
  <p class="text-xs text-[var(--muted)]" data-testid="transcript-not-recorded">No one recorded this Game, so there's no transcript.</p>
{:else}
  <ol class="space-y-0.5 text-xs" onmouseleave={() => onHover(null)} data-testid="round-transcript">
    {#each before as l (l.id)}{@render line(l)}{/each}
    <li class="my-1.5 flex items-center gap-2 border-y border-[var(--border)] py-1 text-[10px] font-semibold uppercase text-[var(--muted)]" data-testid="round-over">
      <span>{clock(round.endS)} · Round over</span>
      <span class="ml-auto normal-case"><Damage hp={round.hpDelta} /></span>
    </li>
    {#each after as l (l.id)}{@render line(l)}{/each}
    {#if round.transcript.length === 0}<li class="text-[var(--muted)]">No speech in this Round.</li>{/if}
  </ol>
{/if}
