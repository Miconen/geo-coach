import { describe, expect, it } from "vitest";
import type { DebriefRound } from "../types.js";
import { hpStrip, hpY } from "../view.js";

const round = (id: string, n: number, before: [number, number], after: [number, number]) =>
  ({
    id,
    roundNumber: n,
    hpBefore: { duo: before[0], opponents: before[1] },
    hpAfter: { duo: after[0], opponents: after[1] },
  }) as DebriefRound;

describe("Game page HP strip (#82)", () => {
  const rounds = [round("a", 1, [6000, 6000], [6000, 4429]), round("b", 2, [6000, 4429], [5200, 4429]), round("c", 3, [5200, 4429], [5200, 0])];

  it("has one point per Round, both teams' HP after it, in play order", () => {
    const { points, max } = hpStrip(rounds);
    expect(points).toEqual([
      { roundId: "a", roundNumber: 1, us: 6000, them: 4429 },
      { roundId: "b", roundNumber: 2, us: 5200, them: 4429 },
      { roundId: "c", roundNumber: 3, us: 5200, them: 0 },
    ]);
    expect(max).toBe(6000);
  });

  it("scales HP into the strip: full HP at the top, none at the bottom, out of range clamped", () => {
    expect(hpY(6000, 6000, 56)).toBe(4);
    expect(hpY(0, 6000, 56)).toBe(52);
    expect(hpY(3000, 6000, 56)).toBe(28);
    expect(hpY(-50, 6000, 56)).toBe(52);
    expect(hpY(9000, 6000, 56)).toBe(4);
  });

  it("copes with a Game that has no Rounds", () => {
    expect(hpStrip([])).toEqual({ points: [], max: 1 });
  });
});
