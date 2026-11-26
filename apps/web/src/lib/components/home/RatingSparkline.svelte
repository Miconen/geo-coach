<script lang="ts">
  // Duo Home (#84): the rating after each Game as one line, with a crosshair and a readout on hover.
  let { points, height = 56 }: { points: ReadonlyArray<{ at: string; rating: number }>; height?: number } = $props();

  let width = $state(300);
  let hover = $state<number | null>(null);
  const pad = 4;
  const min = $derived(Math.min(...points.map((p) => p.rating)));
  const max = $derived(Math.max(...points.map((p) => p.rating)));
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / Math.max(1, max - min)) * (height - pad * 2);
  const d = $derived(points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(""));
  const last = $derived(points.at(-1));
  const shown = $derived(hover !== null ? points[hover] : last);
  // UTC, so the server and the browser render the same text.
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

  function move(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    hover = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - pad) / (width - pad * 2)) * (points.length - 1))));
  }
</script>

<div class="space-y-0.5" data-testid="home-rating">
  <div class="flex items-baseline gap-2 text-[11px] text-[var(--muted)]">
    <span class="font-semibold uppercase tracking-wide">Rating</span>
    {#if shown}
      <span class="ml-auto text-sm font-bold tabular-nums text-[var(--ink)]" data-testid="home-rating-value">{shown.rating.toLocaleString("en-US")}</span>
      <span class="tabular-nums" data-testid="home-rating-date">{date(shown.at)}</span>
    {/if}
  </div>
  <div bind:clientWidth={width}>
    {#if points.length > 1}
      <svg
        {width}
        {height}
        role="img"
        aria-label="Rating from {min} to {max}, now {last?.rating}"
        onpointermove={move}
        onpointerleave={() => (hover = null)}
        class="block cursor-crosshair"
        data-testid="home-rating-chart"
      >
        <line x1={pad} x2={width - pad} y1={y(min)} y2={y(min)} stroke="var(--border)" stroke-width="1" />
        <path {d} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {#if hover !== null}
          <line x1={x(hover)} x2={x(hover)} y1={pad} y2={height - pad} stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 2" />
          <circle cx={x(hover)} cy={y(points[hover]!.rating)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
        {:else if last}
          <circle cx={x(points.length - 1)} cy={y(last.rating)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
        {/if}
      </svg>
      <div class="flex justify-between text-[10px] text-[var(--muted)]"><span>{date(points[0]!.at)}</span><span>{min}–{max}</span></div>
    {:else}
      <p class="text-xs text-[var(--muted)]">Not enough rated Games yet.</p>
    {/if}
  </div>
</div>
