<script lang="ts">
  // The Claim drawer (#56 3a), opened by ?claim= on /knowledge and Review. The whole Claim surface is masked under
  // Recall: a cold ?claim= shows its status and a reveal control only. Revealing the Claim reveals none of its
  // linked Learnings (each keeps its own reveal).
  import type { ComponentProps } from "svelte";
  import type { WorkbenchClaim } from "$lib/server/workbench/view-model.js";
  import { CLAIM_STATUS_META } from "$lib/workbench/knowledge.js";
  import ClaimCard from "./ClaimCard.svelte";
  import Masked from "./Masked.svelte";

  let {
    claim,
    closeHref,
    revealed = false,
    onReveal,
    card,
  }: {
    /** null: the Claim no longer exists (or never was this Duo's). */
    claim: WorkbenchClaim | null;
    closeHref: string;
    revealed?: boolean;
    onReveal: () => void;
    /** The ClaimCard props besides the Claim. */
    card: Omit<ComponentProps<typeof ClaimCard>, "claim">;
  } = $props();
</script>

<div
  role="dialog"
  aria-label="Claim"
  data-testid="claim-drawer"
  class="fixed inset-y-0 right-0 z-40 w-[min(30rem,100vw)] space-y-3 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl"
>
  <div class="flex items-center justify-between">
    <h2 class="text-sm font-bold">Claim</h2>
    <a href={closeHref} data-sveltekit-noscroll data-testid="claim-drawer-close" class="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
      >Close ✕</a
    >
  </div>
  {#if claim}
    <Masked block {revealed}>
      {#snippet placeholder()}
        <div class="space-y-2 rounded-xl border border-dashed border-[var(--border-strong)] p-3 text-xs">
          <span class="rounded px-1.5 py-0.5 font-semibold uppercase text-[var(--muted)]" data-testid="claim-drawer-status"
            >{CLAIM_STATUS_META[claim.status].label}</span
          >
          <button type="button" data-testid="claim-drawer-reveal" class="block font-semibold text-[var(--accent)]" onclick={onReveal}
            >Reveal this Claim</button
          >
        </div>
      {/snippet}
      <ClaimCard {claim} {...card} />
    </Masked>
  {:else}
    <p role="status" data-testid="claim-missing" class="rounded-xl bg-[var(--warn-bg)] px-4 py-2 text-sm text-[var(--warn)]">
      That Claim no longer exists.
    </p>
  {/if}
</div>
