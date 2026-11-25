<script lang="ts">
  import RoundCoachingCard from "$lib/components/RoundCoachingCard.svelte";
  import UtteranceText from "$lib/components/UtteranceText.svelte";
  import Masked from "./Masked.svelte";
  import { DELETE_SPEECH_LABEL } from "$lib/delete-speech.js";
  import Inspect from "$lib/inspect/Inspect.svelte";
  import { formatRelSec } from "$lib/workbench/format.js";
  import { playerInk } from "$lib/player-color.js";
  import type { RoundSlice } from "$lib/workbench/slices.js";
  import type {
    WorkbenchGame,
    WorkbenchLearning,
    WorkbenchUtterance,
  } from "$lib/server/workbench/view-model.js";

  interface Props {
    /** Enables fixing misheard words in the timeline. */
    duoId?: string;
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
    onSelectUtterance?: (utteranceId: string, roundId: string) => void;
    /** Passed to UtteranceText: refreshes the page after a transcript fix. */
    onSaved?: () => unknown;
    onSelectLearning?: (learningId: string) => void;
    /** Per-item Recall reveals for the Learning pills (X4): others stay masked while Recall is on. */
    revealedLearningIds?: Record<string, boolean>;
    onAddLearning?: (opts: { utteranceIds: string[]; roundIds: string[]; country?: string }) => void;
    onDeleteUtterance?: (utterance: WorkbenchUtterance) => void;
  }

  let {
    duoId = "",
    game,
    rounds,
    learnings = [],
    timeline = false,
    highlightedRoundIds = [],
    highlightedUtteranceId = null,
    timelineSearch = "",
    onSelectUtterance,
    onSaved,
    onSelectLearning,
    revealedLearningIds = {},
    onAddLearning,
    onDeleteUtterance,
  }: Props = $props();
</script>

<Inspect
  name="GameCard"
  props={{
    game,
    rounds,
    learnings,
    timeline,
    highlightedRoundIds,
    highlightedUtteranceId,
    timelineSearch,
    onSelectUtterance,
    onSelectLearning,
    onAddLearning,
    onDeleteUtterance,
  }}
  class={timeline ? "" : "space-y-2"}
>
  {#if timeline}
    <div class="space-y-3 border-t border-[var(--border)] pt-3">
      <div class="text-xs font-semibold text-[var(--muted)]">
        Game vs {game.opponentTeamName ?? "Opponents"} · {game.won ? "Win" : "Loss"} ({game.duoRatingBefore ?? "?"} → {game.duoRatingAfter ?? "?"}) · {game.micCount} mic{game.micCount === 1 ? "" : "s"}
      </div>
      {#each rounds as { round, utterances, players }}
        <div class="space-y-1.5" data-round-anchor={round.id}>
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
                    {isDebrief ? "Debrief: " : `${l.kind}: `}<Masked revealed={Boolean(revealedLearningIds[l.id])} label="hidden">{l.text}</Masked>
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
              data-utterance-anchor={u.id}
              class="ml-3 flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs {highlightedUtteranceId === u.id || matchHighlight
                ? 'bg-[var(--warn-bg)]'
                : 'bg-[var(--surface-subtle)]'}"
            >
              <div>
                <span class="mono text-[var(--muted)]">{formatRelSec(round.startTime, u.startedAt)}</span>
                <strong
                  class="ml-1.5"
                  style="color: {speaker ? playerInk(speaker.avatarColor) : 'var(--ink)'}"
                >
                  {speaker?.displayName ?? "Player"}:
                </strong>
                <UtteranceText {duoId} utterance={u} countryCode={round.countryCode} editable={duoId !== ""} {onSaved} />
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
                    title={DELETE_SPEECH_LABEL}
                    class="text-[var(--danger)] hover:underline"
                  >
                    Delete speech
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
      <div data-round-anchor={round.id}>
        <RoundCoachingCard
          {round}
          {utterances}
          {players}
          highlighted={highlightedRoundIds.includes(round.id)}
          {onSelectUtterance}
        />
      </div>
    {/each}
  {/if}
</Inspect>
