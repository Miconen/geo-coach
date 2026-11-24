<script lang="ts">
  // A Session's Transcript (#56 2a token table: Game chips per GameCard, Round chips inside): the Session's
  // Games with their Rounds, speech and Learning pills, deleted-speech gaps, between-Game talk, search, inline
  // transcript fixes, "+ Learning" and delete-speech. Speech is an answer: one Recall reveal per Session.
  import type { WorkbenchSession, WorkbenchUtterance } from "$lib/server/workbench/view-model.js";
  import type { EntityWorkbench } from "$lib/server/entities/index.js";
  import { gameSlice } from "$lib/workbench/slices.js";
  import { entityHref } from "$lib/links.js";
  import { gameTitle } from "$lib/entity-titles.js";
  import EntityChip from "./EntityChip.svelte";
  import GameCard from "./GameCard.svelte";
  import Masked from "./Masked.svelte";
  import UtteranceText from "./UtteranceText.svelte";
  import type { ManualPrefill } from "./ManualLearningModal.svelte";
  import { DELETE_SPEECH_LABEL } from "$lib/delete-speech.js";

  let {
    wb,
    session,
    revealed = false,
    revealedLearningIds = {},
    onReveal,
    onSaved,
    onAddLearning,
    onSelectLearning,
  }: {
    wb: EntityWorkbench;
    session: WorkbenchSession;
    revealed?: boolean;
    revealedLearningIds?: Record<string, boolean>;
    onReveal?: () => void;
    onSaved?: () => unknown;
    onAddLearning?: (prefill: ManualPrefill) => void;
    onSelectLearning?: (learningId: string) => void;
  } = $props();


  let search = $state("");
  let highlightedUtteranceId = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  const roundUtterances = $derived(
    new Set(
      session.gameIds.flatMap((gId) => (wb.gamesById[gId]?.roundIds ?? []).flatMap((rId) => wb.roundsById[rId]?.utteranceIds ?? [])),
    ),
  );
  const betweenGame = $derived(
    wb.utterances
      .filter((u) => u.sessionId === session.id && !u.historical && !roundUtterances.has(u.id))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
  );
  const hits = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q || !revealed) return 0;
    return wb.utterances.filter((u) => u.sessionId === session.id && !u.historical && u.text.toLowerCase().includes(q)).length;
  });

  async function deleteUtterance(u: WorkbenchUtterance) {
    if (!confirm(`${DELETE_SPEECH_LABEL}.`)) return;
    deleteError = null;
    const res = await fetch(`/api/recordings/${u.recordingId}/delete-speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duoId: wb.duo.id, startUtc: u.startedAt, endUtc: u.endedAt }),
    });
    if (!res.ok) deleteError = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not delete that speech.";
    await onSaved?.();
  }
</script>

<section class="space-y-3" data-testid="transcript-timeline" aria-label="Transcript">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Transcript</h2>
    <input
      bind:value={search}
      placeholder="Search this Session's speech"
      class="min-w-[200px] flex-1 rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-xs"
    />
    {#if search.trim()}
      <span class="text-xs text-[var(--muted)]" data-testid="search-hits">{hits} match{hits === 1 ? "" : "es"}</span>
    {/if}
  </div>
  {#if deleteError}<p class="text-xs text-[var(--danger)]" role="alert">{deleteError}</p>{/if}

  {#each session.deletedRanges as dr}
    <div class="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--muted)]">
      Deleted speech ({wb.players[dr.playerId]?.displayName ?? "Player"}): {new Date(dr.startUtc).toLocaleTimeString()} – {new Date(dr.endUtc).toLocaleTimeString()}
    </div>
  {/each}

  <Masked block {revealed}>
    {#snippet placeholder()}
      <button
        type="button"
        data-testid="session-reveal"
        onclick={onReveal}
        class="w-full rounded-lg border border-dashed border-[var(--border-strong)] py-3 text-xs font-semibold text-[var(--accent)]"
      >
        Recall is on: reveal this Session's Games and speech
      </button>
    {/snippet}
    {#each session.gameIds as gId (gId)}
      {@const slice = gameSlice(wb, gId)}
      {#if slice}
        <div class="space-y-1">
          <EntityChip kind="game" label={gameTitle(slice.game)} href={entityHref({ kind: "game", duoId: wb.duo.id, id: gId })} />
          <GameCard
            duoId={wb.duo.id}
            game={slice.game}
            rounds={slice.rounds}
            learnings={slice.learnings}
            timeline
            {highlightedUtteranceId}
            timelineSearch={search}
            {revealedLearningIds}
            {onSaved}
            onSelectUtterance={(id) => (highlightedUtteranceId = id)}
            onSelectLearning={onSelectLearning}
            onAddLearning={(opts) => onAddLearning?.(opts)}
            onDeleteUtterance={deleteUtterance}
          />
        </div>
      {/if}
    {/each}

    {#if betweenGame.length > 0}
      <div class="space-y-1.5 border-t border-[var(--border)] pt-3" data-testid="between-game-talk">
        <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Between-Game & Session Talk</div>
        {#each betweenGame as u (u.id)}
          {@const speaker = wb.players[u.playerId]}
          {@const match = search.trim() !== "" && u.text.toLowerCase().includes(search.trim().toLowerCase())}
          <div
            data-utterance-anchor={u.id}
            class="flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs {match ? 'bg-[var(--warn-bg)]' : 'bg-[var(--surface-subtle)]'}"
          >
            <div>
              <span class="mono text-[var(--muted)]">{new Date(u.startedAt).toISOString().slice(11, 19)}</span>
              <strong class="ml-1.5">{speaker?.displayName ?? "Player"}:</strong>
              <UtteranceText duoId={wb.duo.id} utterance={u} {onSaved} />
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="text-[var(--accent)] hover:underline"
                onclick={() => onAddLearning?.({ utteranceIds: [u.id] })}>+ Learning</button
              >
              {#if speaker?.isCurrentPlayer}
                <button
                  type="button"
                  class="text-[var(--danger)] hover:underline"
                  title={DELETE_SPEECH_LABEL}
                  onclick={() => deleteUtterance(u)}>Delete speech</button
                >
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Masked>
</section>
