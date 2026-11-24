import { intervalsOverlap, type TimeInterval } from "./linking.js";

/*
 * Game bounds and Round windows (#56 1a-derivation). Computed at read time from Rounds as stored (X7); nothing
 * is migrated. GeoGuessr's missing start is stored as the epoch, and a genuine epoch counts as missing too; a
 * missing end is stored as the start, so it reads as a point.
 */

/** A Round time GeoGuessr did not give (stored as the epoch). */
export function isMissingTime(d: Date | number): boolean {
  return (typeof d === "number" ? d : d.getTime()) === 0;
}

export interface RoundTimes {
  roundNumber: number;
  startTime: Date;
  endTime: Date;
  /** Stored: the successor's start when valid and at or after this Round's end, else end + 15 s. */
  resultsEndTime: Date;
}

export interface RoundWindows {
  /** [start, end): where a Call can be spoken. Never clamped (results speech makes no Call). */
  guessing: TimeInterval;
  /** [start, effective results end): play, countdown and results. */
  full: TimeInterval;
}

function byNumber<T extends RoundTimes>(rounds: readonly T[]): T[] {
  return [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * Windows for each Round of ONE Game, in the input order; null for a Round with a missing start (its span is
 * empty). The full window ends at the stored results end, clamped to the Round's own end when the successor's
 * start is missing, so no window reaches across it: speech in that gap stays Session-level.
 */
export function gameRoundWindows<T extends RoundTimes>(gameRounds: readonly T[]): Map<T, RoundWindows | null> {
  const sorted = byNumber(gameRounds);
  const out = new Map<T, RoundWindows | null>();
  sorted.forEach((r, i) => {
    if (isMissingTime(r.startTime)) {
      out.set(r, null);
      return;
    }
    const next = sorted[i + 1];
    const fullEnd = next && isMissingTime(next.startTime) ? r.endTime : r.resultsEndTime;
    out.set(r, {
      guessing: { startedAt: r.startTime, endedAt: r.endTime },
      full: { startedAt: r.startTime, endedAt: fullEnd },
    });
  });
  return out;
}

/** Windows for Rounds of any number of Games, keyed by Round id; pass every Round of each Game (siblings). */
export function roundWindowsById<T extends RoundTimes & { id: string; gameId: string }>(
  rounds: readonly T[],
): Map<string, RoundWindows | null> {
  const byGame = new Map<string, T[]>();
  for (const r of rounds) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
  const out = new Map<string, RoundWindows | null>();
  for (const list of byGame.values()) {
    for (const [r, w] of gameRoundWindows(list)) out.set(r.id, w);
  }
  return out;
}

export interface GameBounds {
  /** First start to last end (display). */
  raw: TimeInterval | null;
  /** First start to last stored results end (display, incl. the 15 s tail). */
  results: TimeInterval | null;
  /**
   * What relates a Game to Sessions, Recordings and runs: first start to the latest own end of Rounds with a
   * valid start, without the results tail. Null when the first Round's start is missing: such a Game relates
   * to Sessions only through Round links.
   */
  relationship: TimeInterval | null;
}

export function gameBounds(gameRounds: readonly RoundTimes[]): GameBounds {
  const sorted = byNumber(gameRounds);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return { raw: null, results: null, relationship: null };
  const valid = sorted.filter((r) => !isMissingTime(r.startTime));
  const relationship =
    isMissingTime(first.startTime) || valid.length === 0
      ? null
      : {
          startedAt: first.startTime,
          endedAt: new Date(Math.max(...valid.map((r) => r.endTime.getTime()))),
        };
  return {
    raw: { startedAt: first.startTime, endedAt: last.endTime },
    results: { startedAt: first.startTime, endedAt: last.resultsEndTime },
    relationship,
  };
}

/**
 * Whether a Game relates to a time span (a Session, a Recording, a run range) by time. The one overlap helper
 * shared by the workbench, Stats and MCP: a missing or epoch-start Game never overlaps; points follow
 * intervalsOverlap's point rule (inside or at the inclusive start; coincident points do not match).
 */
export function gameOverlaps(relationship: TimeInterval | null, span: TimeInterval): boolean {
  if (!relationship || isMissingTime(relationship.startedAt)) return false;
  return intervalsOverlap(relationship, span);
}

/** Milliseconds two intervals share (0 for points or disjoint intervals). */
export function overlapMs(a: TimeInterval, b: TimeInterval): number {
  const start = Math.max(a.startedAt.getTime(), b.startedAt.getTime());
  const end = Math.min(a.endedAt.getTime(), b.endedAt.getTime());
  return Math.max(0, end - start);
}

/**
 * ADR 0008: a Game's rating delta goes to the one overlapping Session with the greatest overlap of its
 * relationship bounds; ties go to the latest-ended Session, then the lowest id. Null when none overlaps.
 */
export function ratingSessionFor(
  relationship: TimeInterval | null,
  sessions: ReadonlyArray<{ id: string; startedAt: Date; endedAt: Date }>,
): string | null {
  if (!relationship) return null;
  let best: { id: string; overlap: number; endedAt: number } | null = null;
  for (const s of sessions) {
    if (!gameOverlaps(relationship, s)) continue;
    const cand = { id: s.id, overlap: overlapMs(relationship, s), endedAt: s.endedAt.getTime() };
    if (
      !best ||
      cand.overlap > best.overlap ||
      (cand.overlap === best.overlap &&
        (cand.endedAt > best.endedAt || (cand.endedAt === best.endedAt && cand.id < best.id)))
    ) {
      best = cand;
    }
  }
  return best?.id ?? null;
}

/**
 * Range status (ADR 0002 ranges): stale if any stale range overlaps, else unprocessed if any unprocessed
 * range overlaps, else processed. Order of the ranges does not matter.
 */
export function rangeStatus(
  span: TimeInterval,
  ranges: ReadonlyArray<{ startedAt: Date; endedAt: Date; reason: "unprocessed" | "stale" }>,
): "processed" | "stale" | "unprocessed" {
  let unprocessed = false;
  for (const r of ranges) {
    if (!intervalsOverlap(span, r)) continue;
    if (r.reason === "stale") return "stale";
    unprocessed = true;
  }
  return unprocessed ? "unprocessed" : "processed";
}

export interface SessionSpan {
  id: string;
  startedAt: Date;
  endedAt: Date;
  /** The Session's Recordings (a live one up to now). */
  recordings: readonly TimeInterval[];
}

/**
 * Recording overlap: the Sessions a Game was played in, 0..N, in the given order. A Game relates to a Session
 * when its relationship bounds overlap one of the Session's Recordings (not just the Session's span, which can
 * hold gaps nobody recorded).
 */
export function gameSessionIds(relationship: TimeInterval | null, sessions: readonly SessionSpan[]): string[] {
  return sessions
    .filter((s) => s.recordings.some((rec) => gameOverlaps(relationship, rec)))
    .map((s) => s.id);
}

/** ADR 0008 over recording overlap: the rating Session among the Sessions the Game was played in. */
export function gameRatingSessionId(
  relationship: TimeInterval | null,
  sessions: readonly SessionSpan[],
): string | null {
  const related = new Set(gameSessionIds(relationship, sessions));
  return ratingSessionFor(
    relationship,
    sessions.filter((s) => related.has(s.id)),
  );
}
