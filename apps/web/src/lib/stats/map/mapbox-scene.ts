import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { AreaMeasure } from "@geo-coach/shared";
import { CLASS_COLOR, MEASURE_SCALE, NO_CLASS_COLOR, OPPONENT_COLOR } from "./colors.js";
import { EMPTY, type RoundLayers } from "./features.js";

// The Map view's Mapbox layers: added on every style load (a style switch drops
// custom layers), then kept in step with the page by `applyScene`.

export type MapStyle = "dark" | "satellite" | "terrain";

export const STYLE_URL: Record<MapStyle, string> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
};

export const TERRAIN_EXAGGERATION = 2.5;
/** The tilt used for Terrain when focused, so the relief shows. */
export const TERRAIN_PITCH = 55;

/** Clickable layers holding a `roundId`, topmost first. */
export const ROUND_LAYERS = ["s-marks", "s-pins", "f-marks", "f-pins", "world-dots"];
export const COUNTRY_LAYER = "countries";
export const REGION_LAYER = "region-fill";

const GEOJSON_SOURCES = [
  "hex",
  "regions",
  "world-dots",
  "f-lines",
  "f-labels",
  "f-marks",
  "f-pins",
  "s-lines",
  "s-labels",
  "s-marks",
  "s-pins",
  "draw",
] as const;
type SourceId = (typeof GEOJSON_SOURCES)[number];

const NONE = ["==", ["get", "iso_3166_1"], ""] as ExpressionSpecification;
const FONT = ["DIN Pro Bold", "Arial Unicode MS Bold"];

/** Everything the layers show; computed by the page, applied in one go. */
export interface Scene {
  measure: AreaMeasure;
  /** Country fills by measure, or null when the Countries overlay is off. */
  countryFill: Map<string, number> | null;
  focusCountry: string | null;
  hex: FeatureCollection;
  regions: FeatureCollection | null;
  /** Region fills by measure, or null when the Regions overlay is off. */
  regionFill: Map<string, number> | null;
  selectedRegions: string[];
  dots: FeatureCollection;
  rounds: RoundLayers;
  /** Label answer pins R1…RN (the Game view). */
  numbered: boolean;
  /** The open Round, drawn above everything else; null when none is open. */
  open: RoundLayers | null;
  area: Polygon | null;
}

// --- images -----------------------------------------------------------------

function drawImage(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

function avatarImage(letter: string, color: string): ImageData {
  return drawImage(56, (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, s / 2, s / 2 + 1);
  });
}

function pinImage(color: string): ImageData {
  return drawImage(44, (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

/** Avatars `av-0`, `av-1`… for the Players, `av-opp` and `av-unknown`; pins per class. */
function addImages(map: MapboxMap, avatars: { initial: string; color: string }[]) {
  const add = (id: string, image: ImageData) => {
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, image, { pixelRatio: 2 });
  };
  avatars.forEach((a, i) => add(`av-${i}`, avatarImage(a.initial, a.color)));
  add("av-opp", avatarImage("O", OPPONENT_COLOR));
  add("av-unknown", avatarImage("?", NO_CLASS_COLOR));
  for (const [cls, color] of Object.entries(CLASS_COLOR)) add(`pin-${cls}`, pinImage(color));
  add("pin-none", pinImage(NO_CLASS_COLOR));
}

// --- layers -----------------------------------------------------------------

/** Adds every source and layer for the current style. Call on each `style.load`. */
export function addSceneLayers(
  map: MapboxMap,
  style: MapStyle,
  avatars: { initial: string; color: string }[],
) {
  addImages(map, avatars);
  if (style === "terrain") {
    map.addSource("dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
    map.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
  }
  if (style !== "satellite") {
    map.setFog({ color: "#0b1020", "high-color": "#1e293b", "space-color": "#020617", "horizon-blend": 0.05 });
  }

  map.addSource("cb", { type: "vector", url: "mapbox://mapbox.country-boundaries-v1" });
  for (const id of GEOJSON_SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });

  // Fills go under the style's labels; everything else on top.
  const firstSymbol = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  const worldview: ExpressionSpecification = [
    "any",
    ["==", "all", ["get", "worldview"]],
    ["in", "US", ["get", "worldview"]],
  ];
  const countryLayer = { source: "cb", "source-layer": "country_boundaries", filter: worldview };
  map.addLayer({ id: COUNTRY_LAYER, type: "fill", ...countryLayer, paint: { "fill-opacity": 0.01 } }, firstSymbol);
  map.addLayer({ id: "hex", type: "fill", source: "hex", paint: { "fill-outline-color": "rgba(0,0,0,0.25)" } }, firstSymbol);
  map.addLayer({ id: REGION_LAYER, type: "fill", source: "regions", paint: { "fill-opacity": 0.01 } }, firstSymbol);
  map.addLayer({
    id: "region-line",
    type: "line",
    source: "regions",
    paint: { "line-color": "#fff", "line-width": 0.7, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: "region-sel",
    type: "line",
    source: "regions",
    filter: ["in", ["get", "code"], ["literal", []]],
    paint: { "line-color": "#facc15", "line-width": 3 },
  });
  map.addLayer({
    id: "region-hover",
    type: "line",
    source: "regions",
    filter: ["==", ["get", "code"], ""],
    paint: { "line-color": "#fff", "line-width": 2.5 },
  });
  map.addLayer({ id: "country-hover", type: "line", ...countryLayer, filter: NONE, paint: { "line-color": "#fff", "line-width": 2.5 } });
  map.addLayer({ id: "country-focus", type: "line", ...countryLayer, filter: NONE, paint: { "line-color": "#facc15", "line-width": 3 } });

  map.addLayer({
    id: "world-dots",
    type: "circle",
    source: "world-dots",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 5, 5],
      "circle-color": classColorExpression(),
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1,
    },
  });

  // Pins and avatars shrink when zoomed out.
  const iconSize = ["interpolate", ["linear"], ["zoom"], 1, 0.4, 4, 1] as ExpressionSpecification;
  const labelPaint = { "text-color": "#fff", "text-halo-color": "#111827", "text-halo-width": 3 };
  map.addLayer({
    id: "f-lines",
    type: "line",
    source: "f-lines",
    paint: { "line-color": "#fff", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "f-labels",
    type: "symbol",
    source: "f-labels",
    layout: { "text-field": ["get", "text"], "text-size": 12, "text-font": FONT },
    paint: labelPaint,
  });
  map.addLayer({
    id: "f-pins",
    type: "symbol",
    source: "f-pins",
    layout: { "icon-image": ["concat", "pin-", ["get", "cls"]], "icon-allow-overlap": true, "icon-size": iconSize },
  });
  map.addLayer({
    id: "f-marks",
    type: "symbol",
    source: "f-marks",
    layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-size": iconSize },
  });
  map.addLayer({
    id: "f-num",
    type: "symbol",
    source: "f-pins",
    layout: {
      visibility: "none",
      "text-field": ["get", "num"],
      "text-size": 12,
      "text-offset": [0, -1.5],
      "text-font": FONT,
      "text-allow-overlap": true,
    },
    paint: { ...labelPaint, "text-color": "#facc15" },
  });

  // The open Round: its answer, all four guesses and their lines.
  map.addLayer({
    id: "s-lines",
    type: "line",
    source: "s-lines",
    paint: { "line-color": "#fff", "line-width": 2.5, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: "s-labels",
    type: "symbol",
    source: "s-labels",
    layout: { "text-field": ["get", "text"], "text-size": 13, "text-font": FONT, "text-allow-overlap": true },
    paint: labelPaint,
  });
  map.addLayer({
    id: "s-pins",
    type: "symbol",
    source: "s-pins",
    layout: { "icon-image": ["concat", "pin-", ["get", "cls"]], "icon-allow-overlap": true },
  });
  map.addLayer({
    id: "s-marks",
    type: "symbol",
    source: "s-marks",
    layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true },
  });

  map.addLayer({ id: "draw-fill", type: "fill", source: "draw", paint: { "fill-color": "#facc15", "fill-opacity": 0.12 } });
  map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#facc15", "line-width": 2 } });
}

// --- expressions ------------------------------------------------------------

function classColorExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "cls"],
    ...Object.entries(CLASS_COLOR).flat(),
    NO_CLASS_COLOR,
  ] as unknown as ExpressionSpecification;
}

function scaleExpression(measure: AreaMeasure, value: unknown): ExpressionSpecification {
  return ["interpolate", ["linear"], value, ...MEASURE_SCALE[measure].stops.flat()] as unknown as ExpressionSpecification;
}

const NO_VALUE = -999_999;

/** A fill colour by a feature property looked up in `values`; transparent where there's none. */
function matchFill(measure: AreaMeasure, property: string, values: Map<string, number>) {
  if (values.size === 0) return "rgba(0,0,0,0)";
  const value = ["match", ["get", property], ...[...values].flat(), NO_VALUE];
  return ["case", ["==", value, NO_VALUE], "rgba(0,0,0,0)", scaleExpression(measure, value)] as unknown as ExpressionSpecification;
}

// --- sync -------------------------------------------------------------------

function setData(map: MapboxMap, id: SourceId, data: FeatureCollection | Feature) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

/** Shows the area being drawn, or the drawn area. */
export function setDrawRing(map: MapboxMap, ring: [number, number][] | null) {
  setData(
    map,
    "draw",
    ring ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } } : EMPTY,
  );
}

export function setHover(map: MapboxMap, kind: "country" | "region", code: string | null) {
  if (kind === "country") map.setFilter("country-hover", ["==", ["get", "iso_3166_1"], code ?? ""]);
  else map.setFilter("region-hover", ["==", ["get", "code"], code ?? ""]);
}

/** Brings every layer in line with the scene. Safe to call often. */
export function applyScene(map: MapboxMap, s: Scene) {
  if (!map.getSource("hex")) return; // the style is still loading

  // Near-zero rather than zero, so countries and Regions stay hoverable when not filled.
  map.setPaintProperty(COUNTRY_LAYER, "fill-color", matchFill(s.measure, "iso_3166_1", s.countryFill ?? new Map()));
  map.setPaintProperty(COUNTRY_LAYER, "fill-opacity", s.countryFill ? 0.5 : 0.01);
  map.setFilter("country-focus", ["==", ["get", "iso_3166_1"], s.focusCountry ?? ""]);
  if (s.focusCountry) setHover(map, "country", null);

  setData(map, "hex", s.hex);
  map.setPaintProperty("hex", "fill-color", scaleExpression(s.measure, ["get", "value"]));
  map.setPaintProperty("hex", "fill-opacity", ["get", "opacity"]);

  setData(map, "regions", s.regions ?? EMPTY);
  map.setPaintProperty(REGION_LAYER, "fill-color", matchFill(s.measure, "code", s.regionFill ?? new Map()));
  map.setPaintProperty(REGION_LAYER, "fill-opacity", s.regionFill ? 0.55 : 0.01);
  map.setFilter("region-sel", ["in", ["get", "code"], ["literal", s.selectedRegions]]);
  if (!s.focusCountry) setHover(map, "region", null);

  setData(map, "world-dots", s.dots);

  setData(map, "f-pins", s.rounds.pins);
  setData(map, "f-marks", s.rounds.marks);
  setData(map, "f-lines", s.rounds.lines);
  setData(map, "f-labels", s.rounds.labels);
  map.setLayoutProperty("f-num", "visibility", s.numbered ? "visible" : "none");
  // With a Round open, the other Rounds fade.
  const dim = s.open !== null;
  map.setPaintProperty("f-pins", "icon-opacity", dim ? 0.25 : 1);
  map.setPaintProperty("f-marks", "icon-opacity", dim ? 0.25 : 1);
  map.setPaintProperty("world-dots", "circle-opacity", dim ? 0.25 : 1);
  map.setPaintProperty("world-dots", "circle-stroke-opacity", dim ? 0.25 : 1);
  map.setPaintProperty("f-lines", "line-opacity", dim ? 0 : 0.9);
  map.setPaintProperty("f-labels", "text-opacity", dim ? 0 : 1);

  setData(map, "s-pins", s.open?.pins ?? EMPTY);
  setData(map, "s-marks", s.open?.marks ?? EMPTY);
  setData(map, "s-lines", s.open?.lines ?? EMPTY);
  setData(map, "s-labels", s.open?.labels ?? EMPTY);

  const ring = s.area?.coordinates[0] as [number, number][] | undefined;
  setDrawRing(map, ring ?? null);
}
