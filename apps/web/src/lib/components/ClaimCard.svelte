<script lang="ts">
  import type { EvidenceDirection } from "@geo-coach/shared";
  import type { WorkbenchClaim, WorkbenchData } from "$lib/server/workbench/view-model.js";
  import { CLAIM_STATUS_META, describeEvidence } from "$lib/workbench/knowledge.js";
  import Masked from "./Masked.svelte";

  interface Props {
    claim: WorkbenchClaim;
    wb: Pick<WorkbenchData, "roundsById" | "gamesById" | "players" | "learnings">;
    /** Hides Evidence, linked Learnings and images: for inline use in a dossier or inspector. */
    compact?: boolean;
    onSetEvidence?: (claimId: string, direction: EvidenceDirection | null) => void;
    onSelectLearning?: (learningId: string) => void;
    /** Per-item Recall reveals: a sibling Learning not in it stays masked while Recall is on (X4). */
    revealedLearningIds?: Record<string, boolean>;
  }

  let { claim, wb, compact = false, onSetEvidence, onSelectLearning, revealedLearningIds = {} }: Props = $props();

  const meta = $derived(CLAIM_STATUS_META[claim.status]);
  const linkedLearnings = $derived(
    claim.learningIds.flatMap((id) => wb.learnings.filter((l) => l.id === id)),
  );

  const frame: Record<WorkbenchClaim["status"], string> = {
    speculated: "border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)]",
    verified: "border-[var(--ok-border)] bg-[var(--surface)]",
    disproved: "border-[var(--danger-border)] bg-[var(--surface)]",
    disputed: "border-[var(--warn-border)] bg-[var(--surface)]",
  };
  const badge: Record<WorkbenchClaim["status"], string> = {
    speculated: "border border-dashed border-[var(--border-strong)] text-[var(--muted)]",
    verified: "bg-[var(--ok-bg)] text-[var(--ok)]",
    disproved: "bg-[var(--danger-bg)] text-[var(--danger)]",
    disputed: "bg-[var(--warn-bg)] text-[var(--warn)]",
  };

  function toggle(direction: EvidenceDirection) {
    onSetEvidence?.(claim.id, claim.viewerDirection === direction ? null : direction);
  }
</script>

<div class="rounded-xl border p-3 text-xs {frame[claim.status]}">
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="rounded px-1.5 py-0.5 font-semibold uppercase {badge[claim.status]}" title={meta.hint}>
        {claim.status === "speculated" ? "? " : ""}{meta.label}
      </span>
      {#each claim.countries as code}
        <span class="mono rounded bg-[var(--badge-bg)] px-1.5 py-0.5 font-semibold text-[var(--badge-ink)]">{code}</span>
      {/each}
      {#each claim.regions as region}
        <span class="rounded bg-[var(--badge-bg)] px-1.5 py-0.5 text-[var(--badge-ink)]">{region.name}</span>
      {/each}
    </div>
    {#if onSetEvidence}
      <div class="flex shrink-0 gap-1">
        <button
          type="button"
          onclick={() => toggle("for")}
          title={claim.viewerDirection === "for" ? "Withdraw your confirmation" : "Confirm: you know this is true"}
          aria-pressed={claim.viewerDirection === "for"}
          class="rounded-md border px-2 py-0.5 font-semibold {claim.viewerDirection === 'for'
            ? 'border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok)]'
            : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
        >
          ✓
        </button>
        <button
          type="button"
          onclick={() => toggle("against")}
          title={claim.viewerDirection === "against" ? "Withdraw your rejection" : "Reject: you know this is wrong"}
          aria-pressed={claim.viewerDirection === "against"}
          class="rounded-md border px-2 py-0.5 font-semibold {claim.viewerDirection === 'against'
            ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'}"
        >
          ✗
        </button>
      </div>
    {/if}
  </div>

  <p
    class="mt-1.5 text-sm {claim.status === 'speculated'
      ? 'italic text-[var(--muted)]'
      : claim.status === 'disproved'
        ? 'text-[var(--muted)] line-through'
        : 'font-medium text-[var(--ink)]'}"
  >
    {claim.text}
  </p>

  {#if claim.topics.length > 0}
    <div class="mt-1 flex flex-wrap gap-1">
      {#each claim.topics as topic}
        <span class="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] text-[var(--muted)]">#{topic}</span>
      {/each}
    </div>
  {/if}

  {#if !compact}
    {#if claim.imageUrls.length > 0}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each claim.imageUrls as src}
          <a href={src} target="_blank" rel="noopener">
            <img {src} alt="From a Source" loading="lazy" class="h-20 max-w-40 rounded border border-[var(--border)] object-cover" />
          </a>
        {/each}
      </div>
    {/if}

    <div class="mt-2 space-y-0.5 border-t border-[var(--border)] pt-1.5">
      {#if claim.evidence.length === 0}
        <div class="text-[11px] text-[var(--muted)]">No Evidence yet. Nothing has confirmed or rejected this.</div>
      {/if}
      {#each claim.evidence as e}
        <div class="flex items-center gap-1.5 text-[11px]">
          <span class="font-semibold {e.direction === 'for' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}">
            {e.direction === "for" ? "✓" : "✗"}
          </span>
          <span class="rounded bg-[var(--surface-subtle)] px-1 text-[10px] uppercase text-[var(--muted)]">
            {e.kind === "documentation" ? "Source" : e.kind}
          </span>
          <span class="truncate">{describeEvidence(e, wb)}</span>
        </div>
      {/each}
    </div>

    {#if linkedLearnings.length > 0}
      <div class="mt-1.5 space-y-0.5 border-t border-[var(--border)] pt-1.5">
        {#each linkedLearnings as l}
          <button
            type="button"
            onclick={() => onSelectLearning?.(l.id)}
            class="block w-full truncate text-left text-[11px] text-[var(--accent)] hover:underline"
          >
            {l.origin === "agent" ? "Tip" : "Learning"}: <Masked revealed={Boolean(revealedLearningIds[l.id])}>{l.text}</Masked>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
