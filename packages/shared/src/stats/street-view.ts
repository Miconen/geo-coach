import type { RawDuelPayload } from "../geoguessr.js";
import type { PanoView } from "./payload.js";

// Links from a Round to Google Street View and Google Maps. The answer opens its own
// pano with GeoGuessr's starting camera; a guess has no pano, so the browser looks up
// the nearest official one (within NEAREST_PANO_RADIUS_M) and opens it with
// `panoStreetViewUrl`.

/** How far from a guess the nearest official Street View pano may be. */
export const NEAREST_PANO_RADIUS_M = 50_000;

const PANO_ID_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Google's pano id from GeoGuessr's stored one, which hex-encodes it
 * ("74634A51" → "tcJQ"). An id that isn't hex-encoded is kept as it is.
 */
export function decodePanoId(stored: string): string {
  if (stored.length === 0 || stored.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(stored)) {
    return stored;
  }
  const decoded = stored.replace(/../g, (pair) => String.fromCharCode(parseInt(pair, 16)));
  return PANO_ID_CHARS.test(decoded) ? decoded : stored;
}

/** Street View's field of view for GeoGuessr's zoom: 90° at 0, halved per step, within 10–100°. */
export function panoFieldOfView(zoom: number): number {
  return Math.min(100, Math.max(10, 90 / 2 ** zoom));
}

function streetViewUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({ api: "1", map_action: "pano", ...params });
  return `https://www.google.com/maps/@?${query}`;
}

/**
 * Street View for a Round's answer: its own pano, facing where GeoGuessr dropped the
 * Duo. Without a pano id, Google opens the nearest pano to the point. Null without a
 * location.
 */
export function answerStreetViewUrl(round: {
  lat: number | null;
  lng: number | null;
  panoId: string | null;
  panoView: PanoView | null;
}): string | null {
  if (round.lat === null || round.lng === null) return null;
  const params: Record<string, string> = {};
  if (round.panoId) params.pano = decodePanoId(round.panoId);
  params.viewpoint = `${round.lat},${round.lng}`;
  if (round.panoView) {
    params.heading = String(round.panoView.heading);
    params.pitch = String(round.panoView.pitch);
    params.fov = String(Math.round(panoFieldOfView(round.panoView.zoom)));
  }
  return streetViewUrl(params);
}

/** Street View at a pano found by a lookup. */
export function panoStreetViewUrl(pano: { panoId: string; lat: number; lng: number }): string {
  return streetViewUrl({ pano: pano.panoId, viewpoint: `${pano.lat},${pano.lng}` });
}

/** The plain Google map, pinned at a point. */
export function googleMapsPointUrl(lat: number, lng: number): string {
  const query = new URLSearchParams({ api: "1", query: `${lat},${lng}` });
  return `https://www.google.com/maps/search/?${query}`;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Each Round's starting camera from a raw duel, by Round number. A Round whose
 * panorama gives no camera at all is left out; a missing pitch or zoom is 0.
 */
export function panoViewsByRound(raw: RawDuelPayload): Map<number, PanoView> {
  const views = new Map<number, PanoView>();
  for (const round of raw.rounds ?? []) {
    const p = round.panorama;
    if (typeof round.roundNumber !== "number" || !p) continue;
    const heading = finite(p.heading);
    const pitch = finite(p.pitch);
    const zoom = finite(p.zoom);
    if (heading === null && pitch === null && zoom === null) continue;
    views.set(round.roundNumber, { heading: heading ?? 0, pitch: pitch ?? 0, zoom: zoom ?? 0 });
  }
  return views;
}
