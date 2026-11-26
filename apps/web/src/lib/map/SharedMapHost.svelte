<script lang="ts" module>
  /** Mapbox maps created by any host in this tab: the shared map makes one and keeps it (#78). */
  let created = 0;
</script>

<script lang="ts">
  // The shared persistent map (#78), mounted once by the Duo layout. Its node moves into whichever
  // `use:mapSlot` element the page renders, so navigating keeps the same Mapbox instance (and WebGL
  // context); only the camera and the layers change. With no slot, it's parked out of sight.
  import { onMount, untrack } from "svelte";
  import { env } from "$env/dynamic/public";
  import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
  import type { FeatureCollection } from "geojson";
  import "mapbox-gl/dist/mapbox-gl.css";
  import { greatCircleMeters } from "@geo-coach/shared";
  import { formatKm } from "$lib/stats/map/features.js";
  import {
    MAP_FONT,
    MAP_STYLE_OPTIONS,
    STYLE_URL,
    addCountryBoundariesSource,
    addTerrainAndFog,
    avatarImage,
    countryBoundaries,
  } from "./mapbox-base.js";
  import { LENS_LEGEND } from "./lens.js";
  import {
    ANSWER_LOST,
    ANSWER_WON,
    CLEAR_HIGHLIGHT_DELAY_MS,
    FADE_MS,
    avatarId,
    bearingDeg,
    bearingToScreen,
    boundsAround,
    cameraKey,
    edgeCandidates,
    edgeMarker,
    fadeOpacities,
    framePoints,
    guessColor,
    guessInitial,
    LENS_COLOR,
    LENS_OUTLINE_COLOR,
    lensCategories,
    litRoundIds,
    opacityByRound,
    paddingBox,
    sceneFeatures,
    type MapRound,
    type MapScene,
  } from "./scene.js";
  import type { SharedMap } from "./shared-map.svelte.js";

  let { map: shared }: { map: SharedMap } = $props();

  const SOURCES = ["answers", "guesses", "lines", "km"] as const;
  const DIMMED_LAYERS: [string, string[]][] = [
    ["answers", ["circle-opacity", "circle-stroke-opacity"]],
    ["answer-labels", ["text-opacity"]],
    ["guesses", ["icon-opacity"]],
  ];
  const COUNTRY_HIT = "countries-hit";
  const LENS_LAYER = "lens";
  const LENS_OUTLINE_LAYER = "lens-outline";
  const NO_COUNTRY = ["==", ["get", "iso_3166_1"], ""] as ExpressionSpecification;

  let park: HTMLDivElement;
  let wrap: HTMLDivElement;
  let container: HTMLDivElement;
  let mb: MapboxMap | undefined;
  let ready = $state(false);
  let error = $state<string | null>(null);
  let loadedStyle: string | null = null;
  let tip = $state<{ x: number; y: number; round: MapRound } | null>(null);

  // --- slot -------------------------------------------------------------------

  $effect(() => {
    const slot = shared.slot;
    const target = slot ?? park;
    if (wrap.parentElement !== target) target.appendChild(wrap);
    untrack(() => {
      tip = null;
      if (slot) {
        shared.pagesServed += 1;
        init();
      }
    });
    requestAnimationFrame(() => mb?.resize());
  });

  function init() {
    if (mb || error) return;
    const token = env.PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      error = "The map needs PUBLIC_MAPBOX_TOKEN (see .env.example).";
      return;
    }
    void (async () => {
      const mapbox = (await import("mapbox-gl")).default;
      if (mb) return;
      mapbox.accessToken = token;
      // Flat and north-up in every style: no pitch or rotation, by camera or by hand.
      const m = new mapbox.Map({
        container,
        style: STYLE_URL[shared.style],
        center: [10, 25],
        zoom: 1.2,
        projection: "globe",
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new mapbox.AttributionControl({ compact: true }), "bottom-right");
      m.addControl(new mapbox.NavigationControl({ showCompass: false }), "bottom-right");
      mb = m;
      created += 1;
      // Dev only: the instance, for checking from the console or a test that navigation never rebuilds it.
      if (import.meta.env.DEV) (window as unknown as { __sharedMapbox?: MapboxMap }).__sharedMapbox = m;
      shared.instances = created;
      shared.projector = project;
      shared.panner = (lng, lat) => m.easeTo({ center: [lng, lat], duration: 800 });
      bindEvents(m);
    })().catch((e: unknown) => {
      error = `The map failed to load: ${(e as Error).message}`;
    });
  }

  /** Screen position inside the map, or null on the far side of the globe. */
  function project(lng: number, lat: number): { x: number; y: number } | null {
    if (!mb) return null;
    const c = mb.getCenter();
    if (greatCircleMeters({ lat: c.lat, lng: c.lng }, { lat, lng }) > 9_800_000) return null;
    const p = mb.project([lng, lat]);
    return { x: p.x, y: p.y };
  }

  function bindEvents(m: MapboxMap) {
    let queued = false;
    m.on("move", () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        shared.tick += 1;
      });
    });
    m.on("style.load", () => {
      loadedStyle = shared.style;
      addLayers(m);
      ready = true;
      // The new layers start fully lit; `apply` repaints the dimming as it was.
      apply(shared.scene, true);
    });
    m.on("click", (e: MapMouseEvent) => {
      if (!ready) return;
      const s = shared.scene;
      const pin = m.queryRenderedFeatures(e.point, { layers: ["answers"] })[0];
      const roundId = pin?.properties?.roundId as string | undefined;
      if (roundId) return s?.onRoundClick?.(roundId);
      const code = m.queryRenderedFeatures(e.point, { layers: [COUNTRY_HIT] })[0]?.properties?.iso_3166_1 as
        | string
        | undefined;
      if (code) s?.onCountryClick?.(code, { lng: e.lngLat.lng, lat: e.lngLat.lat }, { x: e.point.x, y: e.point.y });
    });
    m.on("mousemove", "answers", (e) => {
      m.getCanvas().style.cursor = "pointer";
      const id = e.features?.[0]?.properties?.roundId as string | undefined;
      const round = shared.scene?.rounds.find((r) => r.id === id);
      tip = round ? { x: e.point.x, y: e.point.y, round } : null;
    });
    m.on("mouseleave", "answers", () => {
      m.getCanvas().style.cursor = "";
      tip = null;
    });
  }

  // --- layers -----------------------------------------------------------------

  const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

  function addImage(m: MapboxMap, id: string, image: () => ImageData) {
    if (!m.hasImage(id)) m.addImage(id, image(), { pixelRatio: 2 });
  }

  function addLayers(m: MapboxMap) {
    addTerrainAndFog(m, shared.style);
    addCountryBoundariesSource(m, "cb");
    for (const id of SOURCES) m.addSource(id, { type: "geojson", data: empty() });
    const firstSymbol = m.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
    const countries = countryBoundaries("cb");
    // Near-transparent, so every country is clickable.
    m.addLayer({ id: COUNTRY_HIT, type: "fill", ...countries, paint: { "fill-color": "#000", "fill-opacity": 0.01 } }, firstSymbol);
    m.addLayer(
      {
        id: LENS_LAYER,
        type: "fill",
        ...countries,
        filter: ["all", countries.filter, NO_COUNTRY],
        paint: { "fill-color": LENS_COLOR.g, "fill-opacity": 0.6 },
      },
      firstSymbol,
    );
    m.addLayer(
      {
        id: LENS_OUTLINE_LAYER,
        type: "line",
        ...countries,
        filter: ["all", countries.filter, NO_COUNTRY],
        paint: { "line-color": LENS_OUTLINE_COLOR, "line-width": 3 },
      },
      firstSymbol,
    );
    m.addLayer({
      id: "lines",
      type: "line",
      source: "lines",
      paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.9 },
    });
    m.addLayer({
      id: "km",
      type: "symbol",
      source: "km",
      layout: { "text-field": ["get", "text"], "text-size": 12, "text-font": MAP_FONT },
      paint: { "text-color": "#fff", "text-halo-color": "#111827", "text-halo-width": 3 },
    });
    m.addLayer({
      id: "guesses",
      type: "symbol",
      source: "guesses",
      layout: {
        "icon-image": ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 4, 0.8],
      },
    });
    m.addLayer({
      id: "answers",
      type: "circle",
      source: "answers",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 5, 9],
        "circle-color": ["case", ["get", "won"], ANSWER_WON, ANSWER_LOST],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
    m.addLayer({
      id: "answer-labels",
      type: "symbol",
      source: "answers",
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, -1.4], "text-font": MAP_FONT },
      paint: { "text-color": "#fff", "text-halo-color": "#111827", "text-halo-width": 2 },
    });
  }

  // --- scene ------------------------------------------------------------------

  let lastCameraKey = "";

  function apply(s: MapScene | null, forceCamera = false) {
    const m = mb;
    if (!m || !ready || !m.getSource("answers")) return;
    const set = (id: (typeof SOURCES)[number], data: FeatureCollection) => (m.getSource(id) as GeoJSONSource).setData(data);
    if (!s) {
      for (const id of SOURCES) set(id, empty());
      m.setFilter(LENS_LAYER, NO_COUNTRY);
      m.setFilter(LENS_OUTLINE_LAYER, NO_COUNTRY);
      return;
    }

    for (const r of s.rounds) for (const g of r.guesses) addImage(m, avatarId(g), () => avatarImage(guessInitial(g), guessColor(g)));
    const f = sceneFeatures(s);
    set("answers", f.answers);
    set("guesses", f.guesses);
    set("lines", f.lines);
    set("km", f.km);

    applyLens(m, s);
    fadeTo(litRoundIds(s), s);

    const key = cameraKey(s);
    if (forceCamera || key !== lastCameraKey) {
      lastCameraKey = key;
      const bounds = boundsAround(framePoints(s));
      if (bounds) {
        const focused = s.focusRoundIds.length > 0;
        m.fitBounds(bounds, { padding: paddingBox(s.padding), maxZoom: focused ? 5 : 4, pitch: 0, bearing: 0, duration: 1200 });
      }
    }
  }

  function applyLens(m: MapboxMap, s: MapScene) {
    const focus = new Set(s.focusRoundIds);
    const { fills, outlines } = lensCategories(
      s.rounds.filter((r) => focus.has(r.id)),
      s.masked,
    );
    const countries = countryBoundaries("cb");
    const only = (codes: readonly string[]): ExpressionSpecification =>
      codes.length ? ["all", countries.filter, ["in", ["get", "iso_3166_1"], ["literal", codes]]] : NO_COUNTRY;
    m.setFilter(LENS_OUTLINE_LAYER, only([...outlines]));
    // The Clue lens (#89) swaps the fills only; the outline is the same said-not-guessed rule.
    const colors = s.clueLens
      ? s.masked
        ? []
        : s.clueLens.fills
      : [...fills].map(([code, kind]) => [code, LENS_COLOR[kind]] as const);
    m.setFilter(LENS_LAYER, only(colors.map(([code]) => code)));
    if (colors.length === 0) return;
    m.setPaintProperty(LENS_LAYER, "fill-color", [
      "match",
      ["get", "iso_3166_1"],
      ...colors.flatMap(([code, color]) => [code, color]),
      LENS_COLOR.g,
    ] as unknown as ExpressionSpecification);
  }

  // --- dimming: a short cross-fade, and a cleared highlight waits a moment so row-to-row moves never flash.

  /** Each dimmed Round's opacity as drawn now. */
  let shown = new Map<string, number>();
  let target: Set<string> | null = null;
  let fadeFrame = 0;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  const sameLit = (a: Set<string> | null, b: Set<string> | null) =>
    a === b || (a !== null && b !== null && a.size === b.size && [...a].every((x) => b.has(x)));

  function fadeTo(next: Set<string> | null, s: MapScene) {
    clearTimeout(clearTimer);
    if (sameLit(next, target)) return paintOpacities(shown);
    // Highlight off with nothing focused: wait in case the pointer is on its way to the next row.
    if (next === null && target !== null && s.focusRoundIds.length === 0) {
      clearTimer = setTimeout(() => startFade(null, s), CLEAR_HIGHLIGHT_DELAY_MS);
      return;
    }
    startFade(next, s);
  }

  function startFade(next: Set<string> | null, s: MapScene) {
    target = next;
    cancelAnimationFrame(fadeFrame);
    const from = shown;
    const ids = s.rounds.map((r) => r.id);
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / FADE_MS;
      shown = fadeOpacities(ids, from, next, t);
      paintOpacities(shown);
      if (t < 1) fadeFrame = requestAnimationFrame(step);
    };
    fadeFrame = requestAnimationFrame(step);
  }

  function paintOpacities(dimmed: ReadonlyMap<string, number>) {
    const m = mb;
    if (!m || !ready || !m.getLayer("answers")) return;
    const value = opacityByRound(dimmed) as ExpressionSpecification;
    for (const [layer, props] of DIMMED_LAYERS) for (const p of props) m.setPaintProperty(layer, p as "circle-opacity", value);
  }

  $effect(() => {
    const s = shared.scene;
    untrack(() => apply(s));
  });

  // A style switch drops custom layers; `style.load` adds them back and re-applies the scene.
  $effect(() => {
    const style = shared.style;
    untrack(() => {
      if (!mb || style === loadedStyle) return;
      ready = false;
      mb.setStyle(STYLE_URL[style], { diff: false } as Parameters<MapboxMap["setStyle"]>[1]);
    });
  });

  // --- overlays ---------------------------------------------------------------

  /** Arrows at the map's edge for the focused Rounds' Duo guesses that are off screen. */
  const edges = $derived.by(() => {
    void shared.tick;
    const s = shared.scene;
    const { width, height } = shared.size;
    if (!s || !ready || !mb || width === 0) return [];
    const inset = paddingBox(s.padding, 24);
    const pad = { top: Math.max(16, inset.top), bottom: Math.max(16, inset.bottom), left: Math.max(16, inset.left), right: Math.max(16, inset.right) };
    const c = mb.getCenter();
    const centre = { x: (pad.left + width - pad.right) / 2, y: (pad.top + height - pad.bottom) / 2 };
    return edgeCandidates(s).flatMap(({ round, guess }) => {
      const p = project(guess.lng, guess.lat);
      const onScreen = p !== null && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
      const dir = p ? { x: p.x - centre.x, y: p.y - centre.y } : bearingToScreen(bearingDeg({ lat: c.lat, lng: c.lng }, guess));
      const at = edgeMarker({ width, height }, pad, dir, onScreen);
      return at ? [{ at, guess, round, color: guessColor(guess), km: s.masked ? null : formatKm(guess.distanceMeters) }] : [];
    });
  });

  const focusedAny = $derived((shared.scene?.focusRoundIds.length ?? 0) > 0);

  onMount(() => {
    const ro = new ResizeObserver(() => {
      shared.size = { width: wrap.clientWidth, height: wrap.clientHeight };
      mb?.resize();
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      clearTimeout(clearTimer);
      cancelAnimationFrame(fadeFrame);
      shared.projector = null;
      shared.panner = null;
      mb?.remove();
      mb = undefined;
    };
  });
</script>

<!-- Parked: off screen, invisible and inert, so it never takes input. -->
<div
  bind:this={park}
  aria-hidden="true"
  inert
  style="position:fixed;left:-10000px;top:0;width:800px;height:500px;visibility:hidden;pointer-events:none;"
></div>

<div
  bind:this={wrap}
  class="absolute inset-0 z-0 isolate overflow-hidden bg-[#0b1020]"
  data-testid="shared-map"
  data-map-instances={shared.instances}
  data-pages-served={shared.pagesServed}
  data-ready={ready}
>
  <!-- Inline, because mapbox-gl.css makes the container `position: relative`. -->
  <div bind:this={container} style="position:absolute;inset:0;width:100%;height:100%"></div>
  {#if error}
    <div class="absolute inset-0 grid place-items-center p-6 text-center text-xs text-slate-300">{error}</div>
  {/if}

  {#if tip}
    <div
      class="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg bg-black/85 px-2.5 py-1.5 text-xs text-white shadow"
      style="left:{tip.x}px;top:{tip.y}px"
      data-testid="shared-map-tip"
    >
      <p class="font-semibold">{tip.round.title}</p>
      <p class="text-slate-300">{tip.round.detail}</p>
    </div>
  {/if}

  {#each edges as e (e.round.id + e.guess.playerId + e.guess.lng)}
    <button
      type="button"
      class="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border-2 border-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
      style="left:{e.at.x}px;top:{e.at.y}px;background:{e.color}"
      title="Off-screen guess: pan to it"
      data-testid="shared-map-edge"
      onclick={() => shared.panTo(e.guess.lng, e.guess.lat)}
    >
      <span class="inline-block" style="transform:rotate({e.at.angle}deg)" aria-hidden="true">➜</span>
      {#if e.km}<span>{e.km}</span>{/if}
    </button>
  {/each}

  {#if shared.scene && !shared.scene.chromeless}
    <div class="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[80%] flex-col gap-0.5 rounded-lg bg-black/70 px-3 py-1.5 text-white shadow" data-testid="shared-map-header">
      <span class="text-sm font-semibold">{shared.scene.header}</span>
      {#if shared.scene.sub}<span class="text-[11px] text-slate-300">{shared.scene.sub}</span>{/if}
    </div>
    <div class="absolute bottom-2 left-3 z-10 flex gap-0.5 rounded-full bg-black/80 p-0.5 shadow backdrop-blur" role="group" aria-label="Map style">
      {#each MAP_STYLE_OPTIONS as o (o.value)}
        <button
          type="button"
          aria-pressed={shared.style === o.value}
          class="rounded-full px-2.5 py-1 text-xs font-semibold {shared.style === o.value ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}"
          onclick={() => (shared.style = o.value)}>{o.label}</button
        >
      {/each}
    </div>
    {#if shared.scene.masked && shared.scene.onReveal}
      <button
        type="button"
        class="absolute right-3 top-3 z-10 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow"
        data-testid="shared-map-reveal"
        onclick={() => shared.scene?.onReveal?.()}>Reveal</button
      >
    {/if}
  {/if}

  {#if shared.scene && (shared.scene.legend ?? "bottom-left") !== "hidden"}
    {@const pos = shared.scene.legend ?? "bottom-left"}
    <div
      class="pointer-events-none absolute z-10 flex max-w-[60%] flex-wrap gap-x-2.5 gap-y-1 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] text-slate-200
        {pos === 'bottom-left'
        ? `left-3 ${shared.scene.chromeless ? 'bottom-2' : 'bottom-12'}`
        : pos === 'top-right'
          ? 'right-3 top-12'
          : 'bottom-2 right-12'}"
      data-testid="shared-map-legend"
    >
      {#if focusedAny && !shared.scene.masked}
        {#each LENS_LEGEND as e (e.label)}
          <span class="flex items-center gap-1" data-testid="lens-legend-entry">
            <span
              class="inline-block size-2.5 rounded-sm"
              style="background:{e.fill ?? 'transparent'};{e.outline ? ` box-shadow: inset 0 0 0 1.5px ${e.outline}` : ''}"
            ></span>
            {e.label}
          </span>
        {/each}
      {:else if !shared.scene.masked}
        <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-full" style="background:{ANSWER_WON}"></span> Round won</span>
        <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-full" style="background:{ANSWER_LOST}"></span> Round lost</span>
      {:else}
        <span>Answers hidden (Recall)</span>
      {/if}
    </div>
  {/if}
</div>
