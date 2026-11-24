<script lang="ts">
  // A Claim citing this Round (#56 2a token table: Claim chip, plain text until the Claim page ships in 3a).
  // The statement is an answer: masked with its own reveal while Recall is on.
  import type { WorkbenchClaim } from "$lib/server/workbench/view-model.js";
  import EntityChip from "./EntityChip.svelte";
  import Masked from "./Masked.svelte";
  import { entityHref } from "$lib/links.js";
  import { CLAIM_STATUS_META } from "$lib/workbench/knowledge.js";

  let {
    duoId,
    claim,
    revealed = false,
    onReveal,
  }: { duoId: string; claim: WorkbenchClaim; revealed?: boolean; onReveal?: () => void } = $props();
</script>

<li class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs" data-testid="claim-row">
  <div class="flex flex-wrap items-center gap-1.5">
    <EntityChip kind="claim" label="Claim" href={entityHref({ kind: "claim", duoId, id: claim.id })} />
    <span class="rounded px-1.5 py-0.5 text-[var(--muted)]">{CLAIM_STATUS_META[claim.status].label}</span>
  </div>
  <p class="mt-1 text-sm"><Masked {revealed}>{claim.text}</Masked></p>
  {#if !revealed && onReveal}
    <span class="recall-mask-placeholder">
      <button type="button" class="mt-1 text-[11px] font-semibold text-[var(--accent)]" onclick={onReveal}>Reveal</button>
    </span>
  {/if}
</li>
