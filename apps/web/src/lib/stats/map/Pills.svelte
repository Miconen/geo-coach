<script lang="ts" generics="T extends string">
  // One pill group of the Map view's toolbar. Every group has the same height and style.
  import type { Snippet } from "svelte";

  let {
    options,
    value,
    onselect,
    label,
    children,
  }: {
    options: readonly { value: T; label: string; title?: string }[];
    /** The pressed option; null for a group of toggles that are all off. */
    value: T | null;
    onselect: (value: T) => void;
    label: string;
    /** Extra content after the options (a ✕, a title). */
    children?: Snippet;
  } = $props();
</script>

<div class="pill-group" role="group" aria-label={label}>
  {#each options as o (o.value)}
    <button
      type="button"
      class="pill {value === o.value ? 'pill-on' : 'pill-off'}"
      aria-pressed={value === o.value}
      title={o.title}
      onclick={() => onselect(o.value)}>{o.label}</button
    >
  {/each}
  {@render children?.()}
</div>
