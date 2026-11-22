import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { Polygon } from "geojson";
import type { DrawTool } from "./view-state.js";

// Lasso and Box: press, drag, release. While a tool is on the map doesn't pan, and
// the release doesn't also count as a click on the map. Drawn on our own GeoJSON
// source, so it survives style switches (the page re-adds it on every style load).

/** A click this soon after a release belongs to the drawing, not to the map. */
const RELEASE_CLICK_MS = 400;

export interface DrawingOptions {
  tool: () => DrawTool;
  /** The shape while it's drawn; null to clear it. */
  preview: (ring: [number, number][] | null) => void;
  /** The finished area, or null when the drag was too small to make one. */
  done: (area: Polygon | null) => void;
}

export interface Drawing {
  /** True right after a release, so the map's click handler can ignore that click. */
  justReleased(): boolean;
  /** Turns map panning off while a tool is on. */
  setTool(tool: DrawTool): void;
}

export function attachDrawing(map: MapboxMap, options: DrawingOptions): Drawing {
  let points: [number, number][] | null = null;
  let start = { x: 0, y: 0 };
  let releasedAt = 0;

  const toLngLat = (x: number, y: number): [number, number] => {
    const ll = map.unproject([x, y]);
    return [ll.lng, ll.lat];
  };

  map.on("mousedown", (e: MapMouseEvent) => {
    if (options.tool() === "pan") return;
    e.preventDefault();
    start = { x: e.point.x, y: e.point.y };
    points = [[e.lngLat.lng, e.lngLat.lat]];
  });

  map.on("mousemove", (e: MapMouseEvent) => {
    if (!points) return;
    if (options.tool() === "box") {
      const { x, y } = e.point;
      points = [toLngLat(start.x, start.y), toLngLat(x, start.y), toLngLat(x, y), toLngLat(start.x, y)];
    } else {
      points.push([e.lngLat.lng, e.lngLat.lat]);
    }
    options.preview([...points, points[0]!]);
  });

  map.on("mouseup", () => {
    if (!points) return;
    const ring = points;
    points = null;
    releasedAt = Date.now();
    options.done(ring.length >= 3 ? { type: "Polygon", coordinates: [[...ring, ring[0]!]] } : null);
  });

  return {
    justReleased: () => Date.now() - releasedAt < RELEASE_CLICK_MS,
    setTool(tool) {
      if (tool === "pan") map.dragPan.enable();
      else map.dragPan.disable();
      map.getCanvas().style.cursor = tool === "pan" ? "" : "crosshair";
    },
  };
}
