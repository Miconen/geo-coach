<script lang="ts">
  // GeoGuessr-style card for the country or Region under the pointer.
  import type { AreaStats } from "@geo-coach/shared";
  import Flag from "./Flag.svelte";
  import StatBlock from "./StatBlock.svelte";

  let {
    x,
    y,
    name,
    flag,
    stats,
    hint,
  }: {
    x: number;
    y: number;
    name: string;
    /** The country code for a flag; null for a Region. */
    flag: string | null;
    stats: AreaStats | null;
    hint: string;
  } = $props();
</script>

<div
  class="pointer-events-none absolute z-20 rounded-2xl border border-white/10 bg-[#1e1b4b]/95 px-4 py-3 text-white shadow-2xl"
  style="left: {x + 18}px; top: {y + 18}px"
>
  <div class="flex items-center gap-2 text-lg font-extrabold italic">
    <Flag code={flag} />{name}
  </div>
  {#if stats}
    <div class="mt-1"><StatBlock {stats} /></div>
    <div class="mt-1 text-xs text-white/50">{hint}</div>
  {:else}
    <div class="text-sm text-white/60">No Rounds here yet</div>
  {/if}
</div>
