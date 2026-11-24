<script lang="ts">
  // The /stats Map view: a globe explorer over the page-filtered Rounds. World view
  // shows Round dots and a smoothed Areas or Countries overlay with hover cards; a
  // click focuses a country (its Regions, answer pins and guess avatars); a pin opens
  // the Round card; Lasso and Box select an area. Esc steps back one thing at a time.
  import { onMount } from "svelte";
  import { env } from "$env/dynamic/public";
  import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
  import type { FeatureCollection, Polygon } from "geojson";
  import "mapbox-gl/dist/mapbox-gl.css";
  import {
    AREA_RADIUS_KM,
    AREA_RESOLUTION,
    areaStats,
    getCountryName,
    hexSurface,
    isValidIsoCountryCode,
    regionName,
    shrunkMeasureBy,
    type AreaMeasure,
    type HexGrid,
    type StatsPayload,
    type StatsRound,
  } from "@geo-coach/shared";
  import { formatNumber, formatSigned } from "../overview-text.js";
  import AreaDrawer from "./AreaDrawer.svelte";
  import { initial, playerColors } from "./colors.js";
  import { attachDrawing, type Drawing } from "./draw.js";
  import { EMPTY, hexFeatures, roundDots, roundLayers, type GuessWho, type ShowMode } from "./features.js";
  import Flag from "./Flag.svelte";
  import {
    answersIn,
    duoGuessesIn,
    focusBounds,
    gameCamera,
    boundsOf,
    isPlacedRound,
    roundBounds,
    uniqueRounds,
    type Bounds,
    type PlacedRound,
  } from "./geo.js";
  import HoverCard from "./HoverCard.svelte";
  import MapLegend from "./MapLegend.svelte";
  import {
    COUNTRY_LAYER,
    REGION_LAYER,
    ROUND_LAYERS,
    STYLE_URL,
    TERRAIN_PITCH,
    addSceneLayers,
    applyScene,
    setDrawRing,
    setHover,
    type MapStyle,
    type Scene,
  } from "./mapbox-scene.js";
  import Pills from "./Pills.svelte";
  import RoundCard from "./RoundCard.svelte";
  import {
    WORLD_VIEW,
    backToWorld,
    clickRegion,
    focusCountry,
    stepBack,
    type AreaTarget,
    type DrawTool,
    type ExplorerView,
  } from "./view-state.js";

  let { duoId, payload, rounds }: { duoId: string; payload: StatsPayload; rounds: StatsRound[] } = $props();

  type Overlay = "areas" | "fill" | "plain";
  type WorldRounds = "none" | "lost" | "all";

  const WORLD_CAMERA = { center: [15, 25] as [number, number], zoom: 1.6 };
  /** Zoomed in this far on the globe, Areas use the tighter radius. */
  const AREA_ZOOM_IN = 3;

  let mapStyle = $state<MapStyle>("dark");
  let overlay = $state<Overlay>("plain");
  let measure = $state<AreaMeasure>("gap");
  let worldRounds = $state<WorldRounds>("all");
  let show = $state<ShowMode>("answers");
  let who = $state<GuessWho>("best");
  let view = $state<ExplorerView>({ ...WORLD_VIEW });
  let areaTarget = $state<AreaTarget>("answers");
  let hover = $state<{ kind: "country" | "region"; code: string; name: string; x: number; y: number } | null>(null);
  let zoomedIn = $state(false);
  let ready = $state(false);
  let error = $state<string | null>(null);
  let h3 = $state.raw<HexGrid | null>(null);
  let regionsGeo = $state.raw<FeatureCollection | null>(null);

  let toolbarHeight = $state(44);
  /** Docked panels sit under the toolbar, however many rows it wraps to. */
  const dockTop = $derived(toolbarHeight + 24);

  let wrapper: HTMLDivElement;
  let container: HTMLDivElement;
  let map: MapboxMap | undefined;
  let drawing: Drawing | undefined;
  const regionCache = new Map<string, FeatureCollection>();

  // --- data -------------------------------------------------------------------

  const colors = $derived(playerColors(payload.players));
  const placed = $derived(rounds.filter(isPlacedRound));
  /** The payload's Rounds, unfiltered: a Game shown whole, or opened from its list. */
  const allPlaced = $derived(payload.rounds.filter(isPlacedRound));
  const byCountry = $derived.by(() => {
    const m = new Map<string, PlacedRound[]>();
    for (const r of placed) {
      const c = r.countryCode?.toUpperCase();
      if (!c) continue;
      const list = m.get(c);
      if (list) list.push(r);
      else m.set(c, [r]);
    }
    return m;
  });
  const countryRounds = $derived(view.country ? (byCountry.get(view.country) ?? []) : []);
  const focusRounds = $derived(
    view.regions.length
      ? countryRounds.filter((r) => r.regionCode !== null && view.regions.includes(r.regionCode))
      : countryRounds,
  );
  const hits = $derived(
    view.area ? (areaTarget === "answers" ? answersIn(placed, view.area) : duoGuessesIn(placed, view.area)) : null,
  );
  const openRound = $derived(view.roundId ? (allPlaced.find((r) => r.id === view.roundId) ?? null) : null);
  const gameRoundsOf = (gameId: string) =>
    allPlaced.filter((r) => r.gameId === gameId).sort((a, b) => a.roundNumber - b.roundNumber);
  const openGameRounds = $derived(openRound ? gameRoundsOf(openRound.gameId) : []);

  const areaRadiusKm = $derived(view.country || zoomedIn ? AREA_RADIUS_KM.focused : AREA_RADIUS_KM.world);
  const areaResolution = $derived(view.country || zoomedIn ? AREA_RESOLUTION.focused : AREA_RESOLUTION.world);

  const scene = $derived.by((): Scene => {
    const world = !view.country;
    const shown = view.gameId ? gameRoundsOf(view.gameId) : hits ? uniqueRounds(hits) : focusRounds;
    const dotRounds = worldRounds === "lost" ? placed.filter((r) => r.hpDelta < 0) : placed;
    return {
      measure,
      countryFill:
        world && overlay === "fill" ? shrunkMeasureBy(placed, measure, (r) => r.countryCode?.toUpperCase() ?? null) : null,
      focusCountry: view.country,
      hex:
        overlay === "areas" && h3
          ? hexFeatures(
              hexSurface(h3, world ? placed : countryRounds, measure, {
                resolution: areaResolution,
                radiusKm: areaRadiusKm,
              }),
            )
          : EMPTY,
      regions: view.country ? regionsGeo : null,
      regionFill: !world && overlay === "fill" ? shrunkMeasureBy(countryRounds, measure, (r) => r.regionCode) : null,
      selectedRegions: view.regions,
      dots: world && !hits && worldRounds !== "none" ? roundDots(dotRounds) : EMPTY,
      // A Game shown whole has both Duo guesses and lines; otherwise the pills decide.
      rounds: roundLayers(shown, view.gameId ? { show: "both", who: "duo" } : { show, who }, payload.players),
      numbered: view.gameId !== null,
      open: openRound ? roundLayers([openRound], { show: "both", who: "all" }, payload.players) : null,
      area: view.area,
    };
  });

  $effect(() => {
    const s = scene;
    // Read `ready` before `map` (not reactive), so the effect re-runs when the style loads.
    if (ready && map) applyScene(map, s);
  });

  // The focused country's Regions, from the server (cached per country).
  $effect(() => {
    const code = view.country;
    if (!code) return;
    const cached = regionCache.get(code);
    if (cached) {
      regionsGeo = cached;
      return;
    }
    regionsGeo = null;
    let stale = false;
    fetch(`/api/stats/regions/${code}`)
      .then((res) => (res.ok ? (res.json() as Promise<FeatureCollection>) : null))
      .then((fc) => {
        if (!fc) return;
        regionCache.set(code, fc);
        if (!stale) regionsGeo = fc;
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  });

  // --- camera -----------------------------------------------------------------

  const pitch = () => (mapStyle === "terrain" ? TERRAIN_PITCH : 0);

  function fit(bounds: Bounds | null, maxZoom: number, padding: number | Record<string, number> = 120) {
    if (bounds && map) map.fitBounds(bounds, { padding, maxZoom, duration: 900, pitch: pitch() });
  }

  function fitRegions(codes: readonly string[]) {
    const features = regionsGeo?.features.filter((f) => codes.includes(f.properties?.code)) ?? [];
    if (!features.length) return fit(focusBounds(countryRounds), 6);
    const coords: number[][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as number[]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    for (const f of features) walk((f.geometry as Polygon).coordinates);
    fit(boundsOf(coords), 8, 100);
  }

  function flyToWorld() {
    map?.flyTo({ ...WORLD_CAMERA, pitch: 0, duration: 900 });
  }

  // --- view changes -----------------------------------------------------------

  /** Moves to a new view, with the camera and drawing side effects of the change. */
  function setView(next: ExplorerView) {
    const prev = view;
    view = next;
    if (next.tool !== prev.tool) drawing?.setTool(next.tool);
    if (prev.country && !next.country) flyToWorld();
    else if (next.country && prev.regions.length && !next.regions.length && !next.roundId) {
      fit(focusBounds(countryRounds), 6);
    }
  }

  function focusOn(code: string) {
    hover = null;
    setView(focusCountry(view, code));
    fit(focusBounds(byCountry.get(code) ?? []), 6);
  }

  function selectRegion(code: string, add: boolean) {
    const next = clickRegion(view, code, add);
    view = next;
    if (next.regions.length) fitRegions(next.regions);
    else fit(focusBounds(countryRounds), 6);
  }

  function openRoundById(roundId: string) {
    const r = allPlaced.find((x) => x.id === roundId);
    if (!r) return;
    const gameId = view.gameId === r.gameId ? view.gameId : null;
    // The card derives from view.roundId at once (#56 2b); only the camera waits for the map.
    setView({ ...view, roundId, gameId });
    if (ready && map) fitRound(r);
    else pendingRoundId = roundId;
  }

  function fitRound(r: PlacedRound) {
    // Frame the answer and every guess, clear of the card (and the area drawer).
    map?.fitBounds(roundBounds(r), {
      padding: { top: 90, bottom: 60, left: 330, right: hits ? 760 : 380 },
      maxZoom: 7,
      duration: 800,
    });
  }

  function toggleGame() {
    if (!openRound) return;
    if (view.gameId === openRound.gameId) return setView({ ...view, gameId: null });
    setView({ ...view, gameId: openRound.gameId });
    // Stay on the globe: turn to the middle of the Game's answers, zoomed out to their spread.
    const cam = gameCamera(gameRoundsOf(openRound.gameId));
    if (cam) map?.flyTo({ ...cam, pitch: 0, padding: { top: 60, bottom: 40, left: 0, right: 360 }, duration: 1000 });
  }

  /** A Round whose camera fit waits for the map (opened before it loaded). */
  let pendingRoundId: string | null = null;

  /**
   * Scrolls the Map view into sight and opens a Round's card, for other sections
   * (the Players' best guesses). Works for a Round the page filter hides.
   */
  export function showRound(roundId: string, opts: { scroll?: boolean } = {}) {
    if (opts.scroll !== false) wrapper?.scrollIntoView({ behavior: "smooth", block: "end" });
    openRoundById(roundId);
  }

  /** The open Round, for the page's Back snapshot. */
  export function openRoundId(): string | null {
    return view.roundId;
  }

  function setTool(tool: DrawTool) {
    setView({ ...view, tool: view.tool === tool ? "pan" : tool });
  }

  function setMapStyle(next: MapStyle) {
    if (next === mapStyle || !map) return;
    mapStyle = next;
    ready = false;
    // A full reload, so `style.load` fires and every layer is added again.
    map.setStyle(STYLE_URL[next], { diff: false } as Parameters<MapboxMap["setStyle"]>[1]);
    map.easeTo({ pitch: next === "terrain" && view.country ? TERRAIN_PITCH : 0, duration: 600 });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
    const next = stepBack(view);
    if (next) setView(next);
  }

  // --- map --------------------------------------------------------------------

  function bindEvents(m: MapboxMap) {
    m.on("mousemove", (e: MapMouseEvent) => {
      if (!ready || view.tool !== "pan") return;
      if (view.country) {
        const f = m.queryRenderedFeatures(e.point, { layers: [REGION_LAYER] })[0];
        const code = (f?.properties?.code as string | undefined) ?? null;
        setHover(m, "region", code);
        hover = code
          ? { kind: "region", code, name: regionName(code) ?? String(f?.properties?.name ?? code), x: e.point.x, y: e.point.y }
          : null;
        return;
      }
      const f = m.queryRenderedFeatures(e.point, { layers: [COUNTRY_LAYER] })[0];
      const code = (f?.properties?.iso_3166_1 as string | undefined) ?? null;
      setHover(m, "country", code);
      const name = code && isValidIsoCountryCode(code) ? getCountryName(code) : String(f?.properties?.name_en ?? code);
      hover = code ? { kind: "country", code, name, x: e.point.x, y: e.point.y } : null;
    });
    m.on("mouseout", () => {
      hover = null;
    });
    m.on("click", (e: MapMouseEvent) => {
      if (!ready || view.tool !== "pan" || drawing?.justReleased()) return;
      const hit = m.queryRenderedFeatures(e.point, { layers: ROUND_LAYERS })[0];
      if (hit?.properties?.roundId) return openRoundById(hit.properties.roundId as string);
      if (view.country) {
        const region = m.queryRenderedFeatures(e.point, { layers: [REGION_LAYER] })[0]?.properties?.code as
          | string
          | undefined;
        // A click outside the focused country steps back to the world.
        if (!region) return setView(backToWorld(view));
        const o = e.originalEvent;
        return selectRegion(region, o.shiftKey || o.ctrlKey || o.metaKey);
      }
      const code = m.queryRenderedFeatures(e.point, { layers: [COUNTRY_LAYER] })[0]?.properties?.iso_3166_1 as
        | string
        | undefined;
      if (code && byCountry.has(code)) focusOn(code);
    });
    m.on("zoomend", () => {
      zoomedIn = m.getZoom() >= AREA_ZOOM_IN;
    });
    m.on("style.load", () => {
      addSceneLayers(
        m,
        mapStyle,
        payload.players.map((p, i) => ({ initial: initial(p.displayName), color: colors[i]! })),
      );
      ready = true;
      if (pendingRoundId) {
        const r = view.roundId === pendingRoundId ? allPlaced.find((x) => x.id === pendingRoundId) : undefined;
        if (r) fitRound(r);
        pendingRoundId = null;
      }
    });
    drawing = attachDrawing(m, {
      tool: () => view.tool,
      preview: (ring) => setDrawRing(m, ring),
      done: (area) => {
        // One area at a time: a new one replaces the last; a drag too small keeps it.
        setView({ ...view, area: area ?? view.area, tool: "pan" });
        if (!area) setDrawRing(m, (view.area?.coordinates[0] as [number, number][]) ?? null);
      },
    });
  }

  onMount(() => {
    const token = env.PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      error = "The map needs PUBLIC_MAPBOX_TOKEN (see .env.example).";
      return;
    }
    let disposed = false;
    void (async () => {
      const [mapbox, h3js] = await Promise.all([import("mapbox-gl").then((m) => m.default), import("h3-js")]);
      if (disposed) return;
      h3 = h3js;
      mapbox.accessToken = token;
      map = new mapbox.Map({
        container,
        style: STYLE_URL[mapStyle],
        ...WORLD_CAMERA,
        projection: "globe",
        // Shift-drag box zoom would swallow shift-clicks on Regions; the Box tool replaces it.
        boxZoom: false,
      });
      map.addControl(new mapbox.NavigationControl({ visualizePitch: true }), "bottom-right");
      // Fullscreen the whole explorer, not only the canvas, so the toolbar and cards come along.
      map.addControl(new mapbox.FullscreenControl({ container: wrapper }), "bottom-right");
      bindEvents(map);
    })().catch((e: unknown) => {
      error = `The map failed to load: ${(e as Error).message}`;
    });
    return () => {
      disposed = true;
      map?.remove();
      map = undefined;
    };
  });

  // --- view helpers -----------------------------------------------------------

  const focusStats = $derived(view.country ? areaStats(focusRounds) : null);
  const hoverStats = $derived.by(() => {
    if (!hover) return null;
    const rs =
      hover.kind === "country"
        ? (byCountry.get(hover.code) ?? [])
        : countryRounds.filter((r) => r.regionCode === hover!.code);
    return areaStats(rs);
  });
  const overlayOptions = $derived([
    { value: "areas" as const, label: "Areas" },
    { value: "fill" as const, label: view.country ? "Regions" : "Countries" },
    { value: "plain" as const, label: "Plain" },
  ]);
  const overlayTitle = $derived(
    overlay === "plain" ? null : overlay === "areas" ? "Areas" : view.country ? "Regions" : "Countries",
  );
  const avatarsShown = $derived(view.country !== null || hits !== null || view.gameId !== null);
</script>

<svelte:window onkeydown={onKey} />

<!-- `isolate`: the overlays stack inside the map, never over the page's sticky filter bar. -->
<div bind:this={wrapper} class="map-view relative isolate overflow-hidden rounded-xl border border-[var(--border)] bg-black" style="height: 780px">
  <div bind:this={container} class="h-full w-full"></div>
  {#if error}<div class="absolute inset-0 grid place-items-center px-6 text-center text-sm text-red-300">{error}</div>{/if}

  <!-- One toolbar row; every group has the same height and style. -->
  <div bind:clientHeight={toolbarHeight} class="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2 text-white">
    {#if view.country && focusStats}
      <div class="pill-group pr-4">
        <button type="button" class="pill pill-off" onclick={() => setView(backToWorld(view))} title="Back to the world (Esc)">← World</button>
        <Flag code={view.country} />
        <span class="font-bold">{getCountryName(view.country)}</span>
        {#if view.regions.length}
          <span class="max-w-64 truncate text-sm text-yellow-300">· {view.regions.map((c) => regionName(c) ?? c).join(", ")}</span>
        {/if}
        <span class="ml-2 text-sm font-bold {focusStats.gap < 0 ? 'text-red-400' : 'text-green-400'}" title="Average score gap vs Opponents per Round">
          {formatSigned(focusStats.gap)}
        </span>
        <span class="text-sm text-white/60">{formatNumber(focusStats.rounds)} Rounds</span>
      </div>
      <Pills label="Overlay" options={overlayOptions} value={overlay} onselect={(v) => (overlay = v)} />
      <Pills
        label="Show"
        options={[
          { value: "answers", label: "Answers" },
          { value: "guesses", label: "Guesses" },
          { value: "both", label: "Both" },
        ]}
        value={show}
        onselect={(v) => (show = v)}
      />
      {#if show !== "answers"}
        <Pills
          label="Whose guesses"
          options={[
            { value: "best", label: "Our best" },
            { value: "duo", label: "Both of us" },
            { value: "all", label: "+ Opponents" },
          ]}
          value={who}
          onselect={(v) => (who = v)}
        />
      {/if}
    {:else}
      <Pills label="Overlay" options={overlayOptions} value={overlay} onselect={(v) => (overlay = v)} />
      <Pills
        label="Rounds"
        options={[
          { value: "none", label: "No Rounds" },
          { value: "lost", label: "Lost" },
          { value: "all", label: "All Rounds" },
        ]}
        value={worldRounds}
        onselect={(v) => (worldRounds = v)}
      />
    {/if}
    <div class="ml-auto flex flex-wrap gap-2">
      <Pills
        label="Map style"
        options={[
          { value: "dark", label: "Map" },
          { value: "satellite", label: "Satellite" },
          { value: "terrain", label: "Terrain" },
        ]}
        value={mapStyle}
        onselect={setMapStyle}
      />
      <Pills
        label="Select an area"
        options={[
          { value: "lasso", label: "✎ Lasso", title: "Press, drag and release to draw an area" },
          { value: "box", label: "▭ Box", title: "Press, drag and release to draw a box" },
        ]}
        value={view.tool === "pan" ? null : view.tool}
        onselect={setTool}
      >
        {#if view.area}
          <button type="button" class="pill pill-off" onclick={() => setView({ ...view, area: null })} title="Clear the area (Esc)" aria-label="Clear the area">✕</button>
        {/if}
      </Pills>
    </div>
  </div>

  <MapLegend
    {overlayTitle}
    bind:measure
    areaRadiusKm={overlay === "areas" ? areaRadiusKm : null}
    showClasses={view.country !== null || hits !== null || worldRounds !== "none"}
    players={avatarsShown ? payload.players : []}
    {colors}
    hint={view.country ? "Click a Region to select it, shift-click for more. Esc or a click outside steps back." : null}
  />

  {#if hover && view.tool === "pan" && !openRound}
    <HoverCard
      x={hover.x}
      y={hover.y}
      name={hover.name}
      flag={hover.kind === "country" ? hover.code : null}
      stats={hoverStats}
      hint={hover.kind === "country" ? "Click to focus" : "Click to select, shift-click for more"}
    />
  {/if}

  {#if openRound}
    <aside
      class="absolute z-20 w-[22rem] overflow-y-auto rounded-2xl bg-[#111827]/95 p-4 text-white shadow-2xl {hits ? 'right-[27.5rem]' : 'right-14'}"
      style="top: {dockTop}px; max-height: calc(100% - {dockTop + 12}px)"
    >
      <RoundCard
        {duoId}
        round={openRound}
        {payload}
        {colors}
        gameRounds={openGameRounds}
        gameShown={view.gameId === openRound.gameId}
        onclose={() => setView({ ...view, roundId: null, gameId: null })}
        ontogglegame={toggleGame}
        onopenround={openRoundById}
      />
    </aside>
  {/if}

  {#if hits}
    <AreaDrawer
      {hits}
      top={dockTop}
      target={areaTarget}
      openRoundId={view.roundId}
      ontarget={(t) => (areaTarget = t)}
      onopenround={openRoundById}
      onclose={() => setView({ ...view, area: null })}
    />
  {/if}
</div>

<style>
  .map-view :global(.pill-group) {
    display: flex;
    height: 2.75rem;
    align-items: center;
    gap: 0.25rem;
    border-radius: 9999px;
    background: rgb(0 0 0 / 0.8);
    padding: 0 0.25rem;
    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.3);
    backdrop-filter: blur(8px);
  }
  .map-view :global(.pill) {
    height: 2.25rem;
    border-radius: 9999px;
    padding: 0 0.875rem;
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
    transition: background-color 120ms;
  }
  .map-view :global(.pill-on) {
    background: #fff;
    color: #000;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
  }
  .map-view :global(.pill-off) {
    color: rgb(255 255 255 / 0.8);
  }
  .map-view :global(.pill-off:hover) {
    background: rgb(255 255 255 / 0.1);
  }
</style>
