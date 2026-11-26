import type { Polygon } from "geojson";
import { isValidIsoCountryCode, regionName } from "@geo-coach/shared";
import { isUuid } from "../../uuid.js";
import { readListParam, readParam, setListParam, setParam } from "../../view-url.js";

// What the Map view is looking at, as plain data, and how Esc steps back out of it.

/**
 * The part of the Map view that is in the URL (#73): what is focused, never the camera (worked out from the
 * selection) or the drawing tool. Keys stay clear of the Stats filter's (`country` there filters every panel).
 */
export interface MapUrlView {
  /** ?focus=DE: the focused country. */
  country: string | null;
  /** ?region=DE-BY (repeated): its selected Regions. */
  regions: string[];
  /** ?round=<uuid>: the open Round card. */
  roundId: string | null;
  /** ?allRounds=1: "Show all x Rounds of this Game" for the open Round. */
  allRounds: boolean;
}

export const MAP_VIEW_PARAMS = { country: "focus", regions: "region", roundId: "round", allRounds: "allRounds" } as const;
/** ?rank=DE: the selected Rankings row. */
export const RANK_PARAM = "rank";

const isCountry = (v: string) => v.length === 2 && v === v.toUpperCase() && isValidIsoCountryCode(v);

/** Reads the Map view's params; a malformed or inconsistent one (a Region without its country) is ignored. */
export function parseMapView(params: URLSearchParams): MapUrlView {
  const country = readParam(params, MAP_VIEW_PARAMS.country, isCountry);
  const regions = country
    ? readListParam(params, MAP_VIEW_PARAMS.regions, (v) => v.startsWith(`${country}-`) && regionName(v) !== null)
    : [];
  const roundId = readParam(params, MAP_VIEW_PARAMS.roundId, isUuid)?.toLowerCase() ?? null;
  const allRounds = roundId !== null && params.get(MAP_VIEW_PARAMS.allRounds) === "1";
  return { country, regions, roundId, allRounds };
}

/** Writes the Map view's params, replacing any there were; fields left out are cleared. */
export function writeMapView(params: URLSearchParams, view: Partial<MapUrlView>): void {
  const roundId = view.roundId ?? null;
  setParam(params, MAP_VIEW_PARAMS.country, view.country ?? null);
  setListParam(params, MAP_VIEW_PARAMS.regions, view.country ? (view.regions ?? []) : []);
  setParam(params, MAP_VIEW_PARAMS.roundId, roundId);
  setParam(params, MAP_VIEW_PARAMS.allRounds, roundId !== null && Boolean(view.allRounds));
}

/** The URL part of an explorer view. */
export function mapUrlViewOf(view: ExplorerView): MapUrlView {
  return { country: view.country, regions: view.regions, roundId: view.roundId, allRounds: view.gameId !== null };
}

export function sameMapUrlView(a: MapUrlView, b: MapUrlView): boolean {
  return (
    a.country === b.country &&
    a.roundId === b.roundId &&
    a.allRounds === b.allRounds &&
    a.regions.length === b.regions.length &&
    a.regions.every((r, i) => r === b.regions[i])
  );
}

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
