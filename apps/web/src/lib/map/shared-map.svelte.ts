import { getContext, setContext } from "svelte";
import type { MapStyle } from "./mapbox-base.js";
import type { MapScene } from "./scene.js";

// The one Mapbox map every Duo page shares (#78). The Duo layout owns it and mounts its host once per tab.
// A page says where the map sits (an element with `use:mapSlot`, which the map's node moves into, so the
// WebGL context is never rebuilt) and what it shows (a scene, via `useMapScene`). With no slot on the
// page, the map is parked out of sight and takes no input.

export class SharedMap {
  /** What the map shows; null shows nothing. */
  scene = $state.raw<MapScene | null>(null);
  /** The element the map sits in; null parks it. */
  slot = $state.raw<HTMLElement | null>(null);
  /** The base map. Switching keeps every layer. */
  style = $state<MapStyle>("dark");
  /** Bumped once per frame while the camera moves: read it in a `$derived` with `project` to follow the map. */
  tick = $state(0);
  /** The map's size in CSS pixels, for overlays. */
  size = $state({ width: 0, height: 0 });
  /** Mapbox instances created in this tab (a dev counter: stays 1 across navigation). */
  instances = $state(0);
  /** Pages the current instance has been slotted into. */
  pagesServed = $state(0);

  /** Set by the host once the map exists. */
  projector: ((lng: number, lat: number) => { x: number; y: number } | null) | null = null;
  panner: ((lng: number, lat: number) => void) | null = null;

  /** Who published the current scene, so a page leaving never clears the next page's scene. */
  owner: symbol | null = null;

  /**
   * Where a point is inside the map element, in CSS pixels, or null before the map exists or when the
   * point is on the far side of the globe. Read `tick` alongside to follow camera moves.
   */
  project(lng: number, lat: number): { x: number; y: number } | null {
    return this.projector?.(lng, lat) ?? null;
  }

  /** Pans the camera to a point, keeping the zoom. */
  panTo(lng: number, lat: number) {
    this.panner?.(lng, lat);
  }
}

const KEY = Symbol("shared-map");
export const setSharedMap = (map: SharedMap) => setContext(KEY, map);
export function getSharedMap(): SharedMap {
  const map = getContext<SharedMap | undefined>(KEY);
  if (!map) throw new Error("getSharedMap: only Duo pages have the shared map");
  return map;
}

/**
 * Svelte action: the shared map fills this element while it's mounted. Give the element a size. The map
 * sits at z-index 0 inside it, so the page's overlays in the same element go on top with `z-index` ≥ 1.
 */
export function mapSlot(node: HTMLElement, map: SharedMap) {
  if (getComputedStyle(node).position === "static") node.style.position = "relative";
  map.slot = node;
  return {
    destroy() {
      if (map.slot === node) map.slot = null;
    },
  };
}

/**
 * Publishes the page's scene while the calling component is mounted, re-publishing whenever `build`'s
 * reactive reads change. Call during component init.
 */
export function useMapScene(map: SharedMap, build: () => MapScene | null) {
  const owner = Symbol("scene-owner");
  $effect(() => {
    const scene = build();
    map.owner = owner;
    map.scene = scene;
  });
  $effect(() => () => {
    if (map.owner === owner) {
      map.owner = null;
      map.scene = null;
    }
  });
}
