<script lang="ts">
  // What the colours and avatars mean; the overlay's measure is picked here.
  import { AREA_MEASURES, type AreaMeasure, type MapRoundClass, type StatsPlayer } from "@geo-coach/shared";
  import { CLASS_COLOR, CLASS_LABEL, MEASURE_SCALE, OPPONENT_COLOR, initial, scaleGradient } from "./colors.js";

  let {
    overlayTitle,
    measure = $bindable(),
    areaRadiusKm,
    showClasses,
    players,
    colors,
    hint,
  }: {
    /** "Areas", "Countries" or "Regions"; null when the overlay is Plain. */
    overlayTitle: string | null;
    measure: AreaMeasure;
    /** Set for the Areas overlay. */
    areaRadiusKm: number | null;
    showClasses: boolean;
    /** The Players whose avatars are on the map; empty when none are. */
    players: readonly StatsPlayer[];
    colors: readonly string[];
    hint: string | null;
  } = $props();

  const scale = $derived(MEASURE_SCALE[measure]);
  const classes = Object.keys(CLASS_COLOR) as MapRoundClass[];
</script>

{#if overlayTitle || showClasses || hint}
  <div class="absolute bottom-3 left-3 z-10 w-72 space-y-2 rounded-2xl bg-black/80 p-3 text-xs text-white shadow-xl backdrop-blur">
    {#if overlayTitle}
      <div>
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="font-bold">{overlayTitle}</span>
          <select class="rounded bg-white/10 px-1 py-0.5 text-xs" bind:value={measure} aria-label="Colour by">
            {#each AREA_MEASURES as m (m)}
              <option value={m} class="text-black">{MEASURE_SCALE[m].option}</option>
            {/each}
          </select>
        </div>
        <div class="h-2 rounded-full" style="background: {scaleGradient(measure)}"></div>
        <div class="mt-0.5 flex justify-between gap-2 text-white/60">
          <span>{scale.format(scale.stops[0]![0])}</span>
          <span class="text-center">{scale.label}</span>
          <span>{scale.format(scale.stops.at(-1)![0])}</span>
        </div>
        {#if areaRadiusKm !== null}
          <p class="mt-1 text-white/50">
            Each hexagon blends the Rounds within {areaRadiusKm} km. Fainter means fewer Rounds behind it.
          </p>
        {/if}
      </div>
    {/if}
    {#if showClasses}
      <div class="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {#each classes as cls (cls)}
          <span class="flex items-center gap-1.5">
            <span class="inline-block size-3 rounded-full border-2 border-white" style="background: {CLASS_COLOR[cls]}"></span>
            {CLASS_LABEL[cls]}
          </span>
        {/each}
      </div>
    {/if}
    {#if players.length}
      <div class="flex flex-wrap gap-x-3 gap-y-0.5">
        {#each players as p, i (p.id)}
          <span class="flex items-center gap-1.5">
            <span class="avatar" style="background: {colors[i]}">{initial(p.displayName)}</span>{p.displayName}
          </span>
        {/each}
        <span class="flex items-center gap-1.5"><span class="avatar" style="background: {OPPONENT_COLOR}">O</span>Opponent</span>
      </div>
    {/if}
    {#if hint}<p class="text-white/50">{hint}</p>{/if}
  </div>
{/if}

<style>
  .avatar {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    border: 2px solid #fff;
    font-size: 9px;
    font-weight: 700;
  }
</style>
