import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";

// Mapbox pieces shared by the Stats map and the Duo's shared map: base styles, Terrain,
// the country boundaries source and avatar pin drawing.

export type MapStyle = "dark" | "satellite" | "terrain";

export const STYLE_URL: Record<MapStyle, string> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
};

export const MAP_STYLE_OPTIONS: readonly { value: MapStyle; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "satellite", label: "Satellite" },
  { value: "terrain", label: "Terrain" },
];

export const TERRAIN_EXAGGERATION = 2.5;

export const MAP_FONT = ["DIN Pro Bold", "Arial Unicode MS Bold"];

/** Terrain's relief and the fog around the globe, for the style just loaded. Call on each `style.load`. */
export function addTerrainAndFog(map: MapboxMap, style: MapStyle) {
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
}

/** Mapbox's country polygons as one worldview, for a layer's `source`, `source-layer` and `filter`. */
export function countryBoundaries(sourceId: string) {
  const filter: ExpressionSpecification = [
    "any",
    ["==", "all", ["get", "worldview"]],
    ["in", "US", ["get", "worldview"]],
  ];
  return { source: sourceId, "source-layer": "country_boundaries", filter };
}

export function addCountryBoundariesSource(map: MapboxMap, sourceId: string) {
  map.addSource(sourceId, { type: "vector", url: "mapbox://mapbox.country-boundaries-v1" });
}

// --- images -----------------------------------------------------------------

export function drawImage(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

/** A round avatar pin: the letter in white on the colour, with a white ring. */
export function avatarImage(letter: string, color: string): ImageData {
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
