<script lang="ts">
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import { formatRelSec } from "$lib/workbench/format.js";
  import type { RoundSlice } from "$lib/workbench/slices.js";
  import type {
    WorkbenchGame,
    WorkbenchLearning,
    WorkbenchUtterance,
  } from "$lib/server/workbench/view-model.js";

  interface Props {
    game: WorkbenchGame;
    /** The Game's Rounds, in order, each with only its own Utterances and Players. */
    rounds: RoundSlice[];
    /** Learnings linked from this Game's Rounds. */
    learnings?: WorkbenchLearning[];
    /** Session timeline: a Game header, plus Learning pills and Utterances under each Round. */
    timeline?: boolean;
    highlightedRoundIds?: string[];
    highlightedUtteranceId?: string | null;
    timelineSearch?: string;
    onSelectUtterance?: (utteranceId: string) => void;
    onSelectLearning?: (learningId: string) => void;
    onAddLearning?: (opts: { utteranceIds: string[]; roundIds: string[]; country?: string }) => void;
    onDeleteUtterance?: (utterance: WorkbenchUtterance) => void;
  }

  let {
    game,
    rounds,
    learnings = [],
    timeline = false,
    highlightedRoundIds = [],
    highlightedUtteranceId = null,
    timelineSearch = "",
    onSelectUtterance,
    onSelectLearning,
    onAddLearning,
    onDeleteUtterance,
  }: Props = $props();
</script>

{#if timeline}
  <div class="space-y-3 border-t border-[var(--border)] pt-3">
    <div class="text-xs font-semibold text-[var(--muted)]">
      Game vs {game.opponentTeamName ?? "Opponents"} · {game.won ? "Win" : "Loss"} ({game.duoRatingBefore ?? "?"} → {game.duoRatingAfter ?? "?"}) · {game.micCount} mic{game.micCount === 1 ? "" : "s"}
    </div>
    {#each rounds as { round, utterances, players }}
      <div class="space-y-1.5">
        <RoundCoachingCard
          {round}
          {utterances}
          {players}
          highlighted={highlightedRoundIds.includes(round.id)}
          {onSelectUtterance}
        />

        {#if round.learningIds.length > 0}
          <div class="flex flex-wrap gap-1.5 pl-2">
            {#each round.learningIds as lId}
              {@const l = learnings.find((x) => x.id === lId)}
              {#if l}
                {@const isDebrief = round.debriefLearningIds.includes(l.id)}
                <button
                  onclick={() => onSelectLearning?.(l.id)}
                  class="rounded-full px-2.5 py-0.5 text-xs {isDebrief
                    ? 'bg-[var(--debrief-bg)] text-[var(--debrief)]'
                    : 'bg-[var(--accent-soft)] text-[var(--accent-soft-ink)]'}"
                >
                  {isDebrief ? "Debrief ← between-Game talk: " : `${l.kind}: `}{l.text}
                </button>
              {/if}
            {/each}
          </div>
        {/if}

        {#each utterances as u}
          {@const speaker = players[u.playerId]}
          {@const matchHighlight =
            timelineSearch.trim() !== "" &&
            u.text.toLowerCase().includes(timelineSearch.trim().toLowerCase())}
          <div
            class="ml-3 flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs {highlightedUtteranceId === u.id || matchHighlight
              ? 'bg-[var(--warn-bg)]'
              : 'bg-[var(--surface-subtle)]'}"
          >
            <div>
              <span class="mono text-[var(--muted)]">{formatRelSec(round.startTime, u.startedAt)}</span>
              <strong
                class="ml-1.5"
                style="color: {speaker?.avatarColor
                  ? `color-mix(in srgb, ${speaker.avatarColor}, #ffffff var(--speaker-lighten))`
                  : 'var(--ink)'}"
              >
                {speaker?.displayName ?? "Player"}:
              </strong>
              <span class="ml-1">{u.text}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                onclick={() => onAddLearning?.({ utteranceIds: [u.id], roundIds: [round.id], country: round.countryCode ?? undefined })}
                class="text-[var(--accent)] hover:underline"
              >
                + Learning
              </button>
              {#if speaker?.isCurrentPlayer}
                <button
                  onclick={() => onDeleteUtterance?.(u)}
                  class="text-[var(--danger)] hover:underline"
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
{:else}
  {#each rounds as { round, utterances, players }}
    <RoundCoachingCard
      {round}
      {utterances}
      {players}
      highlighted={highlightedRoundIds.includes(round.id)}
      {onSelectUtterance}
    />
  {/each}
{/if}
