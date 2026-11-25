import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { greatCircleMeters } from "@geo-coach/shared";
import { formatKm } from "$lib/stats/map/features.js";

// The shared map's scene (#78): what a Duo page asks the one persistent map to show.
// Everything here is pure, so the host only turns it into Mapbox calls.

export interface MapGuess {
  lat: number;
  lng: number;
  countryCode: string | null;
  isDuo: boolean;
  playerId: string | null;
  /** The Player's colour, resolved by the page (ignored for Opponents, who are always neutral). */
  color?: string;
  /** The Player's initial for the avatar pin (Opponents always show "O"). */
  initial?: string;
  score: number;
  distanceMeters: number | null;
}

export interface MapRound {
  id: string;
  gameId: string;
  /** The pin label in a Game-sized scope ("R3"). */
  label: string;
  /** The tooltip's first line ("Game 4 · Round 2"). */
  title: string;
  /** The tooltip's second line ("Malaysia · lost · −1,388"). */
  detail: string;
  lat: number;
  lng: number;
  countryCode: string | null;
  won: boolean;
  guesses: MapGuess[];
  /** Countries named in this Round's Learnings (yellow in the Outcome lens). */
  learningCountries: readonly string[];
  /** A Player named the answer aloud but the Duo didn't guess it (#80): the answer is striped green and violet. */
  saidAloud?: boolean;
}

export type Padding = number | { top: number; bottom: number; left: number; right: number };

export interface MapScene {
  /** The scope header inside the map ("9 Games tonight", "Game 4 · Loss"). */
  header: string;
  sub?: string;
  /** Every Round the map shows: an answer pin each, coloured by result. */
  rounds: readonly MapRound[];
  /** Rounds in focus: their guesses, lines, km labels and Outcome lens. The rest dim. */
  focusRoundIds: readonly string[];
  /** Lights some Rounds and fades the rest (a hovered row). Never moves the camera. */
  highlight?: { gameIds?: readonly string[]; roundId?: string | null } | null;
  /**
   * Guess pins with nothing in focus: the Duo's guesses for every Round ("all", the default), only
   * for the highlighted Games or Round ("highlighted"), or none.
   */
  guessPins?: "all" | "highlighted" | "none";
  /** Label answer pins ("R3"): on in a Game-sized scope only. */
  labelPins?: boolean;
  /** km labels on the lines (at most three focused Rounds). Off when the page draws its own callouts. */
  kmLabels?: boolean;
  /** Recall: answers, lines, km labels and lens fills stay hidden; only guess pins and a Reveal control show. */
  masked: boolean;
  onReveal?: () => void;
  onRoundClick?: (roundId: string) => void;
  /** A click on a country (not on an answer pin), with where it landed on the map and on screen. */
  onCountryClick?: (code: string, at: { lng: number; lat: number }, point: { x: number; y: number }) => void;
  /** Camera padding, so the page's floating panels don't cover what's framed (also insets edge markers). */
  padding?: Padding;
  /** The page draws its own header, style toggle and Reveal control. */
  chromeless?: boolean;
  /** Where the legend sits (bottom-left by default, above the style toggle). */
  legend?: "bottom-left" | "bottom-right" | "top-right" | "hidden";
}

export const OPPONENT_GUESS_COLOR = "#9ca3af";
const UNKNOWN_PLAYER_COLOR = "#60a5fa";

export const ANSWER_WON = "#22c55e";
export const ANSWER_LOST = "#ef4444";

/** A focused Round's frame takes in the Duo's guesses within this distance of the answer. */
export const FRAME_NEARBY_GUESS_KM = 3000;

export const guessColor = (g: MapGuess) => (g.isDuo ? (g.color ?? UNKNOWN_PLAYER_COLOR) : OPPONENT_GUESS_COLOR);
export const guessInitial = (g: MapGuess) => (g.isDuo ? (g.initial ?? "?") : "O");
/** The avatar image id for a guess; one image per colour and letter. */
export const avatarId = (g: MapGuess) => `av:${guessColor(g)}:${guessInitial(g)}`;

// --- Outcome lens -------------------------------------------------------------

/** g: the answer · r: a Duo wrong guess · y: named in Learnings · s: said aloud, not guessed. */
export type LensKind = "g" | "r" | "y" | "s";
export const LENS_ORDER: readonly LensKind[] = ["g", "r", "y", "s"];
export const LENS_COLOR: Record<LensKind, string> = { g: "#22c55e", r: "#ef4444", y: "#facc15", s: "#a78bfa" };

const duoHit = (r: MapRound) => r.countryCode !== null && r.guesses.some((g) => g.isDuo && g.countryCode === r.countryCode);

/**
 * Each country's lens categories across the focused Rounds, in LENS_ORDER. One category is a plain fill;
 * several are striped. No precedence: the answer is plain green even when Learnings name it, and only the
 * Duo's wrong guesses paint red. Nothing is filled under Recall.
 */
export function lensCategories(rounds: readonly MapRound[], masked: boolean): Map<string, LensKind[]> {
  const found = new Map<string, Set<LensKind>>();
  if (masked) return new Map();
  const mark = (code: string, kind: LensKind) => found.set(code, (found.get(code) ?? new Set()).add(kind));
  for (const r of rounds) {
    if (r.countryCode) {
      mark(r.countryCode, "g");
      if (r.saidAloud && !duoHit(r)) mark(r.countryCode, "s");
    }
    for (const g of r.guesses) {
      if (g.isDuo && g.countryCode && g.countryCode !== r.countryCode) mark(g.countryCode, "r");
    }
    for (const c of r.learningCountries) if (c !== r.countryCode) mark(c, "y");
  }
  return new Map([...found].map(([code, kinds]) => [code, LENS_ORDER.filter((k) => kinds.has(k))]));
}

/** The fill pattern image for a set of categories ("lens-g", "lens-ry"…). */
export const lensPatternId = (kinds: readonly LensKind[]) => `lens-${kinds.join("")}`;

// --- dimming --------------------------------------------------------------------

/** The Rounds lit right now, or null when every Round is lit. */
export function litRoundIds(scene: MapScene): Set<string> | null {
  const focus = scene.focusRoundIds;
  const hlRound = scene.highlight?.roundId ?? null;
  const hlGames = scene.highlight?.gameIds ?? [];
  if (focus.length > 0) return new Set(hlRound ? [...focus, hlRound] : focus);
  if (hlRound) return new Set([hlRound]);
  if (hlGames.length > 0) {
    const games = new Set(hlGames);
    return new Set(scene.rounds.filter((r) => games.has(r.gameId)).map((r) => r.id));
  }
  return null;
}

export const DIM_OPACITY = 0.12;

/**
 * Each Round's opacity partway (t from 0 to 1) through a fade from what's shown now (`from`: each dimmed
 * Round's opacity; absent means 1) to the `to` lit set. Rounds lit before and after never change, so
 * moving between adjacent rows has no flash. Returns the opacity of each Round not fully lit.
 */
export function fadeOpacities(
  roundIds: readonly string[],
  from: ReadonlyMap<string, number>,
  to: Set<string> | null,
  t: number,
): Map<string, number> {
  const k = Math.min(1, Math.max(0, t));
  const dimmed = new Map<string, number>();
  for (const id of roundIds) {
    const a = from.get(id) ?? 1;
    const b = to === null || to.has(id) ? 1 : DIM_OPACITY;
    const o = a + (b - a) * k;
    if (o < 1) dimmed.set(id, o);
  }
  return dimmed;
}

/**
 * A Mapbox value for a per-Round opacity: 1 when nothing is dimmed, else a `match` on `roundId` with Rounds
 * grouped by (rounded) opacity, so the expression stays short mid-fade.
 */
export function opacityByRound(dimmed: ReadonlyMap<string, number>): number | unknown[] {
  if (dimmed.size === 0) return 1;
  const groups = new Map<number, string[]>();
  for (const [id, o] of dimmed) {
    const key = Math.round(o * 100) / 100;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return ["match", ["get", "roundId"], ...[...groups].flatMap(([o, ids]) => [ids, o]), 1];
}

/** Fades take this long. */
export const FADE_MS = 250;
/** Clearing a highlight waits this long, so moving from one row to the next never lights everything between. */
export const CLEAR_HIGHLIGHT_DELAY_MS = 120;

// --- camera ---------------------------------------------------------------------

/** [[west, south], [east, north]]; east may pass 180 when the frame crosses the antimeridian. */
export type Bounds = [[number, number], [number, number]];

/** Bounds of points, taking the shorter way round the globe: a frame across the antimeridian stays narrow. */
export function boundsAround(points: readonly [number, number][]): Bounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p[1]);
  const plain = points.map((p) => p[0]);
  const shifted = plain.map((lng) => (lng < 0 ? lng + 360 : lng));
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const lngs = span(shifted) < span(plain) ? shifted : plain;
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

const guessKm = (r: MapRound, g: MapGuess) =>
  (g.distanceMeters ?? greatCircleMeters({ lat: r.lat, lng: r.lng }, { lat: g.lat, lng: g.lng })) / 1000;

/**
 * The points the camera frames. A focused Round: its answer plus the Duo's guesses within
 * FRAME_NEARBY_GUESS_KM, so a guess on another continent doesn't swing the globe away. Under Recall the
 * answer is hidden, so the Duo's guesses frame it. Nothing focused: every answer.
 */
export function framePoints(scene: MapScene): [number, number][] {
  const focus = new Set(scene.focusRoundIds);
  const focused = scene.rounds.filter((r) => focus.has(r.id));
  if (focused.length === 0) return scene.rounds.map((r) => [r.lng, r.lat]);
  return focused.flatMap((r) => {
    const duo = r.guesses.filter((g) => g.isDuo);
    if (scene.masked) {
      const pts = duo.map((g): [number, number] => [g.lng, g.lat]);
      // No Duo guess to frame: fall back to the answer rather than the whole world.
      return pts.length ? pts : [[r.lng, r.lat] as [number, number]];
    }
    return [
      [r.lng, r.lat] as [number, number],
      ...duo.filter((g) => guessKm(r, g) <= FRAME_NEARBY_GUESS_KM).map((g): [number, number] => [g.lng, g.lat]),
    ];
  });
}

/** The camera moves only when this changes: the selection, never the highlight. */
export function cameraKey(scene: MapScene): string {
  return `${scene.rounds.map((r) => r.id).join(",")}|${scene.focusRoundIds.join(",")}|${scene.masked}`;
}

export function paddingBox(p: Padding | undefined, fallback = 60) {
  const v = p ?? fallback;
  return typeof v === "number" ? { top: v, bottom: v, left: v, right: v } : v;
}

// --- edge markers -----------------------------------------------------------------

export interface EdgeMarker {
  x: number;
  y: number;
  /** Arrow direction in degrees, clockwise from pointing right (screen x). */
  angle: number;
}

/**
 * Where to put an arrow for an off-screen point: on the edge of the inset viewport, along the ray from its
 * centre towards the point. `dir` is that direction in screen terms (x right, y down); returns null when
 * the point is on screen.
 */
export function edgeMarker(
  view: { width: number; height: number },
  inset: { top: number; bottom: number; left: number; right: number },
  dir: { x: number; y: number },
  onScreen: boolean,
): EdgeMarker | null {
  if (onScreen) return null;
  const left = inset.left;
  const right = view.width - inset.right;
  const top = inset.top;
  const bottom = view.height - inset.bottom;
  if (right <= left || bottom <= top) return null;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  // The nearest box side the ray reaches.
  const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
  const ty = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The initial great-circle bearing from one point to another, in degrees clockwise from north. */
export function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const φ1 = from.lat * rad;
  const φ2 = to.lat * rad;
  const Δλ = (to.lng - from.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/** Screen direction (x right, y down) of a compass bearing on a north-up map. */
export const bearingToScreen = (deg: number) => ({
  x: Math.sin((deg * Math.PI) / 180),
  y: -Math.cos((deg * Math.PI) / 180),
});

/** The Duo guesses that get an edge marker when off screen: the focused Rounds' only, never the Opponents'. */
export function edgeCandidates(scene: MapScene): { round: MapRound; guess: MapGuess }[] {
  const focus = new Set(scene.focusRoundIds);
  return scene.rounds
    .filter((r) => focus.has(r.id))
    .flatMap((round) => round.guesses.filter((g) => g.isDuo).map((guess) => ({ round, guess })));
}

// --- features -----------------------------------------------------------------------

const collection = <G extends Point | LineString>(features: Feature<G>[]): FeatureCollection<G> => ({
  type: "FeatureCollection",
  features,
});

export interface SceneFeatures {
  answers: FeatureCollection<Point>;
  guesses: FeatureCollection<Point>;
  lines: FeatureCollection<LineString>;
  km: FeatureCollection<Point>;
}

/** The GeoJSON behind the map's pins, lines and km labels. */
export function sceneFeatures(scene: MapScene): SceneFeatures {
  const focus = new Set(scene.focusRoundIds);
  const focused = scene.rounds.filter((r) => focus.has(r.id));
  const masked = scene.masked;

  const answers = masked
    ? []
    : scene.rounds.map(
        (r): Feature<Point> => ({
          type: "Feature",
          properties: { roundId: r.id, gameId: r.gameId, won: r.won, label: scene.labelPins ? r.label : "" },
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        }),
      );

  // Focused: every guess of the focused Rounds, the Opponents' too. Otherwise the Duo's guesses, per guessPins.
  let guessRounds: readonly MapRound[];
  if (focused.length > 0) guessRounds = focused;
  else if (scene.guessPins === "none") guessRounds = [];
  else if (scene.guessPins === "highlighted") {
    const lit = litRoundIds(scene);
    guessRounds = lit ? scene.rounds.filter((r) => lit.has(r.id)) : [];
  } else guessRounds = scene.rounds;
  const guesses = guessRounds.flatMap((r) =>
    r.guesses
      .filter((g) => focused.length > 0 || g.isDuo)
      .map(
        (g): Feature<Point> => ({
          type: "Feature",
          properties: { roundId: r.id, gameId: r.gameId, icon: avatarId(g), duo: g.isDuo },
          geometry: { type: "Point", coordinates: [g.lng, g.lat] },
        }),
      ),
  );

  const lines = masked
    ? []
    : focused.flatMap((r) =>
        r.guesses.map(
          (g): Feature<LineString> => ({
            type: "Feature",
            properties: { roundId: r.id, color: guessColor(g) },
            geometry: { type: "LineString", coordinates: [[r.lng, r.lat], [unwrapLng(r.lng, g.lng), g.lat]] },
          }),
        ),
      );

  const showKm = !masked && focused.length > 0 && focused.length <= 3 && scene.kmLabels !== false;
  const km = showKm
    ? focused.flatMap((r) =>
        r.guesses.map(
          (g): Feature<Point> => ({
            type: "Feature",
            properties: { roundId: r.id, text: formatKm(g.distanceMeters) },
            geometry: { type: "Point", coordinates: midpoint([r.lng, r.lat], [g.lng, g.lat]) },
          }),
        ),
      )
    : [];

  return { answers: collection(answers), guesses: collection(guesses), lines: collection(lines), km: collection(km) };
}

/** `lng` shifted by 360° when that brings it nearer `ref`, so a line takes the short way round. */
export function unwrapLng(ref: number, lng: number): number {
  if (lng - ref > 180) return lng - 360;
  if (ref - lng > 180) return lng + 360;
  return lng;
}

/** Halfway along a line, the short way round the antimeridian. */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  let lng = (a[0] + unwrapLng(a[0], b[0])) / 2;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return [lng, (a[1] + b[1]) / 2];
}
