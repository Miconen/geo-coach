<script lang="ts">
  // The one Recall mask (#56 X4). The content is always rendered; while its item is unrevealed, CSS hides it
  // whenever <html data-recall> is "on" or "pending", so first paint is masked before hydration. `revealed` is
  // the per-item reveal only, never the Recall preference (that lives on <html>).
  import type { Snippet } from "svelte";

  let {
    revealed = false,
    block = false,
    label = "Hidden (Recall)",
    children,
    placeholder,
  }: {
    revealed?: boolean;
    /** Use block elements (for content containing divs). */
    block?: boolean;
    label?: string;
    children: Snippet;
    /** Shown instead of the label while masked (e.g. a Round card without its speech). */
    placeholder?: Snippet;
  } = $props();
</script>

{#if revealed}
  {@render children()}
{:else if block}
  <div class="recall-mask" data-masked>
    <div class="recall-mask-content">{@render children()}</div>
    <div class="recall-mask-placeholder">
      {#if placeholder}{@render placeholder()}{:else}<span
          class="inline-block rounded bg-[var(--badge-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">{label}</span
        >{/if}
    </div>
  </div>
{:else}
  <span class="recall-mask" data-masked>
    <span class="recall-mask-content">{@render children()}</span>
    <span class="recall-mask-placeholder">
      {#if placeholder}{@render placeholder()}{:else}<span
          class="rounded bg-[var(--badge-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">{label}</span
        >{/if}
    </span>
  </span>
{/if}
