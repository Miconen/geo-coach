<script lang="ts">
  // The drawn area's Rounds: the answers inside it, or the Duo's guesses inside it.
  import { areaStats, getCountryName, mapRoundClass, regionName } from "@geo-coach/shared";
  import { formatSigned } from "../overview-text.js";
  import { CLASS_LABEL, classColor } from "./colors.js";
  import Flag from "./Flag.svelte";
  import { uniqueRounds, type AreaHit } from "./geo.js";
  import Pills from "./Pills.svelte";
  import StatBlock from "./StatBlock.svelte";
  import type { AreaTarget } from "./view-state.js";

  let {
    hits,
    target,
    openRoundId,
    ontarget,
    onopenround,
    onclose,
  }: {
    hits: readonly AreaHit[];
    target: AreaTarget;
    openRoundId: string | null;
    ontarget: (target: AreaTarget) => void;
    onopenround: (roundId: string) => void;
    onclose: () => void;
  } = $props();

  /** Rows shown; a huge area lists the first ones. */
  const MAX_ROWS = 300;

  const stats = $derived(areaStats(uniqueRounds(hits)));
  const targets = [
    { value: "answers", label: "Answers here" },
    { value: "guesses", label: "Our guesses here" },
  ] as const;
</script>

<aside class="absolute bottom-3 right-14 top-16 z-10 flex w-96 flex-col rounded-2xl bg-black/85 text-white shadow-2xl backdrop-blur">
  <div class="flex items-center gap-2 border-b border-white/10 p-3">
    <Pills label="List" options={targets} value={target} onselect={ontarget} />
    <button type="button" class="ml-auto text-white/60 hover:text-white" onclick={onclose} title="Clear the area (Esc)" aria-label="Clear the area">✕</button>
  </div>
  {#if stats}
    <div class="px-3 pt-2"><StatBlock {stats} /></div>
  {:else}
    <p class="px-3 pt-2 text-sm text-white/60">
      {target === "answers" ? "No answers in this area." : "None of our guesses landed in this area."}
    </p>
  {/if}
  <ul class="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
    {#each hits.slice(0, MAX_ROWS) as hit, i (i)}
      {@const r = hit.round}
      {@const cls = mapRoundClass(r)}
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10 {openRoundId === r.id ? 'bg-white/10' : ''}"
          onclick={() => onopenround(r.id)}
        >
          <Flag code={r.countryCode} />
          <span class="font-semibold">{r.countryCode ? getCountryName(r.countryCode) : "?"}</span>
          <span class="truncate text-xs text-white/50">{regionName(r.regionCode) ?? ""}</span>
          <span class="inline-block size-2 shrink-0 rounded-full" style="background: {classColor(cls)}" title={cls ? CLASS_LABEL[cls] : "Unclassified"}></span>
          <span class="ml-auto font-mono text-xs {r.hpDelta < 0 ? 'text-red-400' : 'text-green-400'}">{formatSigned(r.hpDelta)}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if hits.length > MAX_ROWS}
    <p class="border-t border-white/10 px-3 py-2 text-xs text-white/50">Showing the first {MAX_ROWS} of {hits.length}.</p>
  {/if}
</aside>
