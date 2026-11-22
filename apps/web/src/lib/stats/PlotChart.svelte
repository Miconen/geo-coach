<script lang="ts">
  // Renders an Observable Plot chart at the container's width. Charts colour their
  // marks with the theme's CSS variables (Plot accepts `var(--ok)` as a colour), so
  // they follow a theme switch without being redrawn.
  type Chart = SVGSVGElement | HTMLElement;

  let {
    render,
    height,
    label,
  }: {
    /** Builds the chart for the given width; re-run whenever its inputs change. */
    render: (width: number) => Chart;
    height: number;
    /** What the chart shows, for screen readers. */
    label: string;
  } = $props();

  let container: HTMLDivElement;
  let width = $state(0);

  $effect(() => {
    if (width <= 0) return;
    const chart = render(width);
    container.replaceChildren(chart);
    return () => chart.remove();
  });
</script>

<div
  bind:this={container}
  bind:clientWidth={width}
  class="plot-chart"
  role="img"
  aria-label={label}
  style:min-height="{height}px"
></div>

<style>
  .plot-chart {
    color: var(--ink);
    font-size: 11px;
  }
  /* Plot fills tooltips with --plot-background (white by default, set on its own
     svg): theme them like the cards so they read in light and dark themes. */
  .plot-chart :global(svg) {
    --plot-background: var(--surface-subtle);
    overflow: visible;
  }
  .plot-chart :global(g[aria-label="tip"] path) {
    stroke: var(--border-strong);
  }
  .plot-chart :global(g[aria-label="tip"] text) {
    fill: var(--ink);
  }
</style>
