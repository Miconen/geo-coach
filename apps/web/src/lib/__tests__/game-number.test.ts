import { describe, expect, it } from "vitest";
import { gameNumbers, homeSessionId, numberInPlayOrder, playDay, type NumberedGame } from "../game-number.js";

const at = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h, m)).toISOString();
const game = (id: string, startedAt: string, sessionIds: string[] = [], ratingSessionId: string | null = sessionIds[0] ?? null): NumberedGame => ({
  id,
  startedAt,
  sessionIds,
  ratingSessionId,
});

describe("numberInPlayOrder", () => {
  it("numbers by start time, ties by id", () => {
    const n = numberInPlayOrder([
      { id: "c", startedAt: at(23, 20) },
      { id: "b", startedAt: at(23, 19) },
      { id: "a", startedAt: at(23, 19) },
    ]);
    expect([...n]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
});

describe("gameNumbers", () => {
  it("numbers each Session's Games in play order, from 1 in every Session", () => {
    const games = [game("g1", at(23, 18), ["s1"]), game("g2", at(23, 19), ["s1"]), game("g3", at(24, 18), ["s2"])];
    const n = gameNumbers(games, [
      { id: "s1", gameIds: ["g2", "g1"] },
      { id: "s2", gameIds: ["g3"] },
    ]);
    expect(Object.fromEntries(n)).toEqual({ g1: 1, g2: 2, g3: 1 });
  });

  it("a Game two Sessions share counts in both, numbered under its rating Session (ADR 0008)", () => {
    const games = [game("a", at(23, 18), ["s1"]), game("shared", at(23, 19), ["s1", "s2"], "s2"), game("b", at(23, 20), ["s2"])];
    const sessions = [
      { id: "s1", gameIds: ["a", "shared"] },
      { id: "s2", gameIds: ["shared", "b"] },
    ];
    expect(Object.fromEntries(gameNumbers(games, sessions))).toEqual({ a: 1, shared: 1, b: 2 });
    expect(homeSessionId(games[1]!, new Set(["s1", "s2"]))).toBe("s2");
  });

  it("numbers unrecorded Games inside the day they were played", () => {
    const games = [game("x", at(21, 10)), game("y", at(21, 12)), game("z", at(22, 10))];
    expect(Object.fromEntries(gameNumbers(games, [], "UTC"))).toEqual({ x: 1, y: 2, z: 1 });
  });

  it("falls back to another listed Session when the rating Session isn't listed", () => {
    const g = game("g", at(23, 18), ["s1", "gone"], "gone");
    expect(homeSessionId(g, new Set(["s1"]))).toBe("s1");
    expect(homeSessionId(g, new Set())).toBeNull();
  });
});

describe("playDay", () => {
  it("is the calendar day in the given time zone", () => {
    expect(playDay("2026-11-21T23:30:00.000Z", "UTC")).toBe("2026-11-21");
    expect(playDay("2026-11-21T23:30:00.000Z", "Europe/Helsinki")).toBe("2026-11-22");
  });
});
