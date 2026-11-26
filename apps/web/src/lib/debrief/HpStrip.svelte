<script lang="ts">
  // The Game page's HP-over-Rounds strip (#82): both teams' HP after each Round, floating above the bottom bar with
  // each point over its Round tile (the view measures the tiles and passes each point's x). Hovering a point lights
  // its Round; clicking focuses it.
  import { OPPONENT_COLOR } from "$lib/player-color.js";
  import { hpY, type HpPoint } from "./view.js";

  let {
    points,
    max,
    width,
    activeId = null,
    hoverId = null,
    onHover,
    onFocus,
  }: {
    points: Array<HpPoint & { x: number }>;
    max: number;
    width: number;
    activeId?: string | null;
    hoverId?: string | null;
    onHover: (roundId: string | null) => void;
    onFocus: (roundId: string) => void;
  } = $props();

  const H = 56;
  const US = "var(--accent)";
  const line = (hp: (p: HpPoint) => number) => points.map((p) => `${p.x.toFixed(1)},${hpY(hp(p), max, H).toFixed(1)}`).join(" ");
</script>

<div class="pointer-events-none relative" style="height:{H}px" data-testid="hp-strip">
  <svg class="absolute inset-0 overflow-visible" {width} height={H} aria-hidden="true">
    <polyline points={line((p) => p.them)} fill="none" stroke={OPPONENT_COLOR} stroke-width="2" stroke-dasharray="4 3" />
    <polyline points={line((p) => p.us)} fill="none" stroke={US} stroke-width="2.5" />
  </svg>
  {#each points as p (p.roundId)}
    {@const lit = p.roundId === hoverId || p.roundId === activeId}
    <button
      type="button"
      class="pointer-events-auto absolute top-0 flex h-full w-7 -translate-x-1/2 items-start justify-center"
      style="left:{p.x}px"
      aria-label="Round {p.roundNumber}: us {p.us.toLocaleString('en-US')} HP, them {p.them.toLocaleString('en-US')} HP"
      data-testid="hp-point"
      data-round-id={p.roundId}
      onmouseenter={() => onHover(p.roundId)}
      onmouseleave={() => onHover(null)}
      onfocus={() => onHover(p.roundId)}
      onblur={() => onHover(null)}
      onclick={() => onFocus(p.roundId)}
    >
      <span class="absolute size-2 -translate-y-1/2 rounded-full" style="top:{hpY(p.them, max, H)}px;background:{OPPONENT_COLOR}"></span>
      <span
        class="absolute -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)] {lit ? 'size-3.5' : 'size-2.5'}"
        style="top:{hpY(p.us, max, H)}px;background:{US}"
      ></span>
      {#if lit}
        <span class="absolute -top-5 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
          R{p.roundNumber} · us {p.us.toLocaleString("en-US")} · them {p.them.toLocaleString("en-US")}
        </span>
      {/if}
    </button>
  {/each}
</div>
