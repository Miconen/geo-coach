// Smoothing for the time-series charts on the statistics page: one page-wide
// level, stored in the URL next to the filter (it never narrows the Rounds, so
// it is not part of StatsFilter). A level maps to a trailing rolling window
// over points, Games or Rounds depending on the chart, never over time: gaps
// between Sessions would leave time windows empty.

export const SMOOTHING_LEVELS = ["off", "light", "medium", "heavy"] as const;
export type SmoothingLevel = (typeof SMOOTHING_LEVELS)[number];

/** Medium keeps the 50-Round window the Players trends always had. */
export const DEFAULT_SMOOTHING: SmoothingLevel = "medium";

/** The URL param the level lives in; absent means the default. */
export const SMOOTHING_PARAM = "smooth";

export type SmoothingUnit = "games" | "rounds";

/**
 * Points per window. A Round-level share (best-guess share, closer share) is
 * 0 or 1 on a single Round, so "off" still keeps a small Round window.
 */
const WINDOWS: Record<SmoothingLevel, Record<SmoothingUnit, number>> = {
  off: { games: 1, rounds: 10 },
  light: { games: 5, rounds: 25 },
  medium: { games: 10, rounds: 50 },
  heavy: { games: 25, rounds: 100 },
};

export function smoothingWindow(level: SmoothingLevel, unit: SmoothingUnit): number {
  return WINDOWS[level][unit];
}

export function parseSmoothing(params: URLSearchParams): SmoothingLevel {
  const value = params.get(SMOOTHING_PARAM);
  return SMOOTHING_LEVELS.includes(value as SmoothingLevel) ? (value as SmoothingLevel) : DEFAULT_SMOOTHING;
}

/**
 * The trailing mean of each full window of `window` values, aligned with the
 * input: null before the first full window, and null where every value in the
 * window is null. Nulls inside a window are skipped.
 */
export function rollingMean(values: readonly (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    const present = values.slice(i + 1 - window, i + 1).filter((v): v is number => v !== null);
    return present.length ? present.reduce((sum, v) => sum + v, 0) / present.length : null;
  });
}

export interface RollingWindow<T> {
  /** The 1-based position of the window's last item. */
  end: number;
  items: T[];
}

/** Every full trailing window of `window` items, in order; empty with fewer items. */
export function rollingWindows<T>(items: readonly T[], window: number): RollingWindow<T>[] {
  const windows: RollingWindow<T>[] = [];
  for (let end = window; end <= items.length; end += 1) {
    windows.push({ end, items: items.slice(end - window, end) });
  }
  return windows;
}
