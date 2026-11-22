<script lang="ts">
  import JsonTreeNode from "./JsonTreeNode.svelte";
  import { describeValue, startsCollapsed } from "./json-tree.js";

  interface Props {
    name: string;
    value: unknown;
    /** Containers above this value, to stop at circular references. */
    ancestors?: object[];
  }

  let { name, value, ancestors = [] }: Props = $props();

  const node = $derived(describeValue(name, value, ancestors));
  let toggled = $state<boolean | null>(null);
  const open = $derived(toggled ?? !startsCollapsed(node));

  const LEAF_COLORS: Record<string, string> = {
    string: "text-[var(--ok)]",
    number: "text-[var(--info)]",
    bigint: "text-[var(--info)]",
    boolean: "text-[var(--warn)]",
    date: "text-[var(--manual)]",
    null: "text-[var(--muted)]",
    undefined: "text-[var(--muted)]",
    symbol: "text-[var(--muted)]",
  };
</script>

<li class="leading-5">
  {#if (node.kind === "array" || node.kind === "object") && node.entries.length > 0}
    <button
      type="button"
      aria-expanded={open}
      onclick={() => (toggled = !open)}
      class="-ml-3.5 inline-flex cursor-pointer items-baseline gap-1 rounded px-0.5 text-left hover:bg-[var(--surface-hover)]"
    >
      <span class="inline-block w-3 text-[var(--muted)]" aria-hidden="true">{open ? "▾" : "▸"}</span>
      <span class="text-[var(--ink)]">{name}:</span>
      <span class="text-[var(--muted)]">{node.summary}</span>
    </button>
    {#if open}
      <ul class="ml-1 border-l border-[var(--border)] pl-4">
        {#each node.entries as [key, child] (key)}
          <JsonTreeNode name={key} value={child} ancestors={[...ancestors, value as object]} />
        {/each}
      </ul>
    {/if}
  {:else}
    <span class="text-[var(--ink)]">{name}:</span>
    {#if node.kind === "array" || node.kind === "object"}
      <span class="text-[var(--muted)]">{node.summary}</span>
    {:else if node.kind === "function"}
      <span class="italic text-[var(--accent)]">{node.text}</span>
    {:else if node.kind === "circular"}
      <span class="text-[var(--danger)]">{node.text}</span>
    {:else if node.kind === "leaf"}
      <span class="break-all {LEAF_COLORS[node.type]}">{node.text}</span>
    {/if}
  {/if}
</li>
