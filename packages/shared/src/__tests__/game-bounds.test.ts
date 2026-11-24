import { describe, expect, it } from "vitest";
import {
  gameBounds,
  gameOverlaps,
  gameRoundWindows,
  intervalsOverlap,
  rangeStatus,
  ratingSessionFor,
  type RoundTimes,
} from "../index.js";

// One fixture table for Game bounds (#56 1a-derivation). Times are seconds after 19:00.
const t = (s: number) => new Date(Date.UTC(2026, 10, 20, 19, 0, s));
const EPOCH = new Date(0);
const TAIL = 15;

function round(n: number, start: number | null, end: number | null, nextStart: number | null | "last"): RoundTimes {
  const startTime = start === null ? EPOCH : t(start);
  const endTime = end === null ? startTime : t(end);
  const resultsEndTime =
    nextStart !== "last" && nextStart !== null && t(nextStart).getTime() >= endTime.getTime()
      ? t(nextStart)
      : new Date(endTime.getTime() + TAIL * 1000);
  return { roundNumber: n, startTime, endTime, resultsEndTime };
}
const span = (a: number, b: number) => ({ startedAt: t(a), endedAt: t(b) });

describe("Game bounds fixture table", () => {
  it("all timestamps present", () => {
    const rounds = [round(1, 0, 40, 60), round(2, 60, 100, 120), round(3, 120, 160, "last")];
    const b = gameBounds(rounds);
    expect(b.raw).toEqual(span(0, 160));
    expect(b.results).toEqual(span(0, 160 + TAIL));
    expect(b.relationship).toEqual(span(0, 160));
    const w = gameRoundWindows(rounds);
    expect(w.get(rounds[0]!)).toEqual({ guessing: span(0, 40), full: span(0, 60) });
    expect(w.get(rounds[2]!)!.full).toEqual(span(120, 160 + TAIL));
  });

  it("(a) a missing FIRST start relates by Round links only", () => {
    const rounds = [round(1, null, null, 60), round(2, 60, 100, "last")];
    const b = gameBounds(rounds);
    expect(b.relationship).toBeNull();
    expect(b.raw!.startedAt.getTime()).toBe(0);
    // An unrelated earlier Session never matches the epoch start.
    expect(gameOverlaps(b.relationship, { startedAt: new Date(0), endedAt: t(500) })).toBe(false);
    expect(gameOverlaps({ startedAt: EPOCH, endedAt: t(100) }, span(-100, 500))).toBe(false);
    const w = gameRoundWindows(rounds);
    expect(w.get(rounds[0]!)).toBeNull();
    expect(w.get(rounds[1]!)).not.toBeNull();
  });

  it("(b) a missing MIDDLE start: empty span, the predecessor's window stops at its own end", () => {
    const rounds = [round(1, 0, 40, null), round(2, null, 90, 120), round(3, 120, 160, "last")];
    const w = gameRoundWindows(rounds);
    expect(w.get(rounds[1]!)).toBeNull();
    // Stored results end keeps the tail; the effective window ends at Round 1's own end.
    expect(rounds[0]!.resultsEndTime).toEqual(t(40 + TAIL));
    expect(w.get(rounds[0]!)!.full).toEqual(span(0, 40));
    expect(gameBounds(rounds).relationship).toEqual(span(0, 160));
  });

  it("(c) a trailing Round missing start and end: stored end is 1970, relationship recovers", () => {
    const rounds = [round(1, 0, 40, 60), round(2, 60, 100, null), round(3, null, null, "last")];
    const b = gameBounds(rounds);
    expect(b.raw!.endedAt.getTime()).toBe(0);
    expect(b.relationship).toEqual(span(0, 100));
    expect(gameOverlaps(b.relationship, span(50, 70))).toBe(true);
    // The trailing Round's predecessor stops at its own end, not the tail.
    expect(gameRoundWindows(rounds).get(rounds[1]!)!.full).toEqual(span(60, 100));
  });

  it("(d) a zero-length Game follows the point rule", () => {
    const rounds = [round(1, 10, null, "last")];
    const rel = gameBounds(rounds).relationship!;
    expect(rel).toEqual(span(10, 10));
    expect(gameOverlaps(rel, span(0, 20))).toBe(true); // strictly inside
    expect(gameOverlaps(rel, span(10, 20))).toBe(true); // at the inclusive start
    expect(gameOverlaps(rel, span(0, 10))).toBe(false); // at the exclusive end
    expect(gameOverlaps(rel, span(10, 10))).toBe(false); // coincident points
    // A missing end reads exactly like a zero-length Round.
    expect(round(1, 10, null, "last")).toEqual(round(1, 10, 10, "last"));
  });

  it("the 15 s tail never relates a Session to the Game", () => {
    const rounds = [round(1, 0, 40, "last")];
    expect(gameOverlaps(gameBounds(rounds).relationship, span(45, 300))).toBe(false);
    expect(gameOverlaps(gameBounds(rounds).relationship, span(39, 300))).toBe(true);
  });

  it("an inverted interval overlaps nothing", () => {
    expect(intervalsOverlap(span(10, 5), span(0, 20))).toBe(false);
    expect(intervalsOverlap(span(0, 20), span(10, 5))).toBe(false);
  });
});

describe("ADR 0008 rating Session", () => {
  const game = span(100, 200);
  it("goes to the greatest overlap, then the latest-ended, then the lowest id", () => {
    expect(
      ratingSessionFor(game, [
        { id: "b", ...span(0, 130) },
        { id: "a", ...span(130, 400) },
      ]),
    ).toBe("a");
    expect(
      ratingSessionFor(game, [
        { id: "b", ...span(0, 150) },
        { id: "a", ...span(150, 300) },
      ]),
    ).toBe("a");
    expect(
      ratingSessionFor(game, [
        { id: "b", ...span(150, 300) },
        { id: "a", ...span(150, 300) },
      ]),
    ).toBe("a");
    expect(ratingSessionFor(game, [{ id: "a", ...span(300, 400) }])).toBeNull();
    expect(ratingSessionFor(null, [{ id: "a", ...span(0, 400) }])).toBeNull();
  });
});

describe("range status", () => {
  it("reads stale when an unprocessed range is listed before an overlapping stale one", () => {
    const ranges = [
      { ...span(0, 100), reason: "unprocessed" as const },
      { ...span(50, 150), reason: "stale" as const },
    ];
    expect(rangeStatus(span(60, 70), ranges)).toBe("stale");
    expect(rangeStatus(span(10, 20), ranges)).toBe("unprocessed");
    expect(rangeStatus(span(200, 210), ranges)).toBe("processed");
  });
});
