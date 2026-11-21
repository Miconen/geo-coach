export interface ClockOffsetSample {
  offsetMs: number;
  rttMs: number;
}

export interface ComputedRecordingOffset {
  offsetMs: number;
  calibrated: boolean;
  source: "manual" | "measured" | "uncalibrated";
}

export const LOW_RTT_THRESHOLD_MS = 250;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Computes the effective PC-to-server clock offset for a Recording.
 * Manual override wins; otherwise median of low-RTT measurements (or all measurements if none are low-RTT);
 * falls back to 0 marked uncalibrated.
 */
export function computeRecordingOffsetMs(
  measurements: readonly ClockOffsetSample[],
  manualOverrideMs: number | null | undefined,
): ComputedRecordingOffset {
  if (manualOverrideMs !== null && manualOverrideMs !== undefined) {
    return { offsetMs: Math.round(manualOverrideMs), calibrated: true, source: "manual" };
  }

  if (measurements.length === 0) {
    return { offsetMs: 0, calibrated: false, source: "uncalibrated" };
  }

  const lowRtt = measurements.filter((m) => m.rttMs <= LOW_RTT_THRESHOLD_MS);
  const pool = lowRtt.length > 0 ? lowRtt : measurements;
  return {
    offsetMs: median(pool.map((m) => m.offsetMs)),
    calibrated: true,
    source: "measured",
  };
}

/**
 * Derives UTC start/end timestamps from the Recording's PC wall-clock anchor,
 * sample-based millisecond offsets, and the Recording's computed clock offset.
 */
export function deriveUtteranceUtc(
  clockAnchorMs: number,
  startSampleMs: number,
  endSampleMs: number,
  offsetMs: number,
): { startedAt: Date; endedAt: Date } {
  const startUtcMs = clockAnchorMs + startSampleMs + offsetMs;
  const endUtcMs = Math.max(startUtcMs, clockAnchorMs + endSampleMs + offsetMs);
  return {
    startedAt: new Date(startUtcMs),
    endedAt: new Date(endUtcMs),
  };
}
