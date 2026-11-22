import type { AreaMeasure, MapRoundClass, StatsPlayer } from "@geo-coach/shared";
import { MISTAKE_CLASS_LABELS, formatNumber, formatPercent, formatSigned } from "../overview-text.js";

// Colours and their legends for the Map view. Mapbox paints need real colours, not
// CSS variables, and they sit on a dark map whatever the page theme.

export const CLASS_COLOR: Record<MapRoundClass, string> = {
  "wrong-country": "#ef4444",
  far: "#f59e0b",
  close: "#38bdf8",
  won: "#22c55e",
};
/** A Round with no class (no best guess, or no country). */
export const NO_CLASS_COLOR = "#9ca3af";

export const CLASS_LABEL: Record<MapRoundClass, string> = { ...MISTAKE_CLASS_LABELS, won: "Round won" };

export const classColor = (cls: MapRoundClass | null) => (cls ? CLASS_COLOR[cls] : NO_CLASS_COLOR);

export const OPPONENT_COLOR = "#8b5cf6";
/** Used when the Players share a colour (both on the default), so their avatars differ. */
const FALLBACK_PLAYER_COLORS = ["#ec4899", "#f59e0b"];

/** Each Player's avatar colour: their own, unless two Players share one. */
export function playerColors(players: readonly StatsPlayer[]): string[] {
  const distinct = new Set(players.map((p) => p.avatarColor.toLowerCase())).size === players.length;
  return players.map((p, i) =>
    distinct ? p.avatarColor : (FALLBACK_PLAYER_COLORS[i] ?? FALLBACK_PLAYER_COLORS[0]!),
  );
}

export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

export interface MeasureScale {
  /** Value → colour stops; green is always good. */
  stops: [number, string][];
  label: string;
  option: string;
  format: (value: number) => string;
}

// Strong red → orange → yellow → green.
const RED = "#dc2626";
const ORANGE = "#f97316";
const YELLOW = "#facc15";
const LIME = "#84cc16";
const GREEN = "#16a34a";

export const MEASURE_SCALE: Record<AreaMeasure, MeasureScale> = {
  gap: {
    stops: [[-1200, RED], [-300, ORANGE], [0, YELLOW], [300, LIME], [1200, GREEN]],
    label: "Score gap vs Opponents per Round",
    option: "Score gap",
    format: formatSigned,
  },
  damage: {
    stops: [[0, GREEN], [500, YELLOW], [1500, ORANGE], [3000, RED]],
    label: "Damage taken per Round",
    option: "Damage taken",
    format: (v) => formatNumber(v),
  },
  "wrong-country": {
    stops: [[0, GREEN], [0.15, YELLOW], [0.35, ORANGE], [0.6, RED]],
    label: "Wrong-country rate",
    option: "Wrong country",
    format: formatPercent,
  },
};

/** The scale as a CSS gradient, for the legend. */
export function scaleGradient(measure: AreaMeasure): string {
  return `linear-gradient(to right, ${MEASURE_SCALE[measure].stops.map(([, c]) => c).join(", ")})`;
}
