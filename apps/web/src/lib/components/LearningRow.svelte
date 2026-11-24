<script lang="ts">
  // One Learning on an entity page (#56 2a token table: Learning chip pins it on Review). The takeaway is an
  // answer: masked until this row is revealed while Recall is on (X4).
  import type { WorkbenchLearning } from "$lib/server/workbench/view-model.js";
  import EntityChip from "./EntityChip.svelte";
  import Masked from "./Masked.svelte";
  import { entityHref } from "$lib/links.js";

  let {
    duoId,
    learning,
    revealed = false,
    onReveal,
    runLabel = null,
  }: {
    duoId: string;
    learning: WorkbenchLearning;
    revealed?: boolean;
    onReveal?: () => void;
    /** The authoring run's chip label (Rounds show Learnings with authoring run links). */
    runLabel?: string | null;
  } = $props();
</script>

<li class="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs" data-testid="learning-row" data-learning-id={learning.id}>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-semibold uppercase">{learning.kind}</span>
    {#if learning.status !== "current"}
      <span class="rounded bg-[var(--badge-bg)] px-1.5 py-0.5 text-[var(--muted)]">{learning.status}</span>
    {/if}
    <EntityChip kind="learning" label="Open in Review" href={entityHref({ kind: "learning", duoId, id: learning.id })} />
    {#if learning.runId && runLabel}
      <EntityChip
        kind="run"
        label={runLabel}
        href={learning.sessionIds[0]
          ? entityHref({ kind: "run", duoId, id: learning.runId, sessionId: learning.sessionIds[0] })
          : null}
      />
    {/if}
    {#if learning.claimId}
      <!-- The Claim chip (#56 3b): opens its drawer on Review; the label carries no answer. -->
      <EntityChip kind="claim" label="Claim" href={entityHref({ kind: "claim", duoId, id: learning.claimId })} />
    {/if}
  </div>
  <p class="mt-1 text-sm text-[var(--ink)]" data-answer="learning-text">
    <Masked {revealed} label="Hidden (Recall)">{learning.text}</Masked>
  </p>
  {#if !revealed && onReveal}
    <span class="recall-mask-placeholder">
      <button type="button" data-testid="learning-reveal" class="mt-1 text-[11px] font-semibold text-[var(--accent)]" onclick={onReveal}>Reveal</button>
    </span>
  {/if}
</li>
