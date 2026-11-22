import type { Polygon } from "geojson";

// What the Map view is looking at, as plain data, and how Esc steps back out of it.

/** Press-drag-release drawing tools; "pan" is the map's own dragging. */
export type DrawTool = "pan" | "lasso" | "box";

/** What a drawn area lists: the answers inside it, or the Duo's guesses inside it. */
export type AreaTarget = "answers" | "guesses";

export interface ExplorerView {
  /** The focused country (ISO alpha-2), or null on the world view. */
  country: string | null;
  /** Selected Regions of the focused country; empty shows all its Rounds. */
  regions: string[];
  /** The open Round card. */
  roundId: string | null;
  /** A Game shown whole from the Round card. */
  gameId: string | null;
  tool: DrawTool;
  area: Polygon | null;
}

export const WORLD_VIEW: ExplorerView = {
  country: null,
  regions: [],
  roundId: null,
  gameId: null,
  tool: "pan",
  area: null,
};

/**
 * One Esc: closes the Round (and its Game view), then the drawing tool, then the
 * area, then the Region selection, then the focused country. Null when already on
 * the plain world view.
 */
export function stepBack(view: ExplorerView): ExplorerView | null {
  if (view.roundId || view.gameId) return { ...view, roundId: null, gameId: null };
  if (view.tool !== "pan") return { ...view, tool: "pan" };
  if (view.area) return { ...view, area: null };
  if (view.regions.length) return { ...view, regions: [] };
  if (view.country) return backToWorld(view);
  return null;
}

/** Leaves the focused country and the Round and Game it had open; a drawn area stays. */
export function backToWorld(view: ExplorerView): ExplorerView {
  return { ...view, country: null, regions: [], roundId: null, gameId: null };
}

export function focusCountry(view: ExplorerView, country: string): ExplorerView {
  return { ...view, country, regions: [], roundId: null, gameId: null };
}

/**
 * A click on a Region selects only it (or clears it when it was the only one);
 * with `add` (shift or ctrl) it's added to or removed from the selection.
 */
export function clickRegion(view: ExplorerView, code: string, add: boolean): ExplorerView {
  const has = view.regions.includes(code);
  const regions = add
    ? has
      ? view.regions.filter((c) => c !== code)
      : [...view.regions, code]
    : has && view.regions.length === 1
      ? []
      : [code];
  return { ...view, regions, roundId: null };
}
