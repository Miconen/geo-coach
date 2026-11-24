<script lang="ts">
  // One chip shape for every entity link (#56 1b-shell token table). Without an href (its page has not
  // shipped, or X7's non-positive Round number) it renders the same label as plain text.
  import { ENTITY_TOKENS } from "$lib/entity-tokens.js";
  import type { EntityKind } from "$lib/links.js";

  let {
    kind,
    label,
    href = null,
    title = undefined,
  }: { kind: EntityKind; label: string; href?: string | null; title?: string } = $props();

  const token = $derived(ENTITY_TOKENS[kind]);
</script>

{#if href}
  <a
    {href}
    title={title ?? `${token.label}: ${label}`}
    data-entity-chip={kind}
    class="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] hover:underline"
  >
    <span aria-hidden="true" style="color: {token.color}">{token.icon}</span>
    <span class="truncate">{label}</span>
  </a>
{:else}
  <span
    title={title}
    data-entity-text={kind}
    class="inline-flex max-w-full items-center gap-1 px-0.5 text-xs text-[var(--muted)]"
  >
    <span class="truncate">{label}</span>
  </span>
{/if}
