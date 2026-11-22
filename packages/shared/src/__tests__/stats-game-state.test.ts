import { describe, expect, it } from "vitest";
import { STARTING_HP, roundGameState } from "../index.js";
import { makeRound } from "./stats-fixtures.js";

// One Game of four Rounds: the Duo takes 1,500, deals 2,000, takes 3,000 (×1.5), then deals 4,500 (×2).
const game = [
  makeRound("r1", "g", { roundNumber: 1, hpDelta: -1500, damageMultiplier: 1 }),
  makeRound("r2", "g", { roundNumber: 2, hpDelta: 2000, damageMultiplier: 1 }),
  makeRound("r3", "g", { roundNumber: 3, hpDelta: -3000, damageMultiplier: 1.5 }),
  makeRound("r4", "g", { roundNumber: 4, hpDelta: 4500, damageMultiplier: 2 }),
];
// Another Game's Round must never count.
const other = makeRound("x1", "other", { roundNumber: 1, hpDelta: -5000 });

describe("roundGameState", () => {
  it("starts both teams at 6,000 HP in the first Round", () => {
    expect(STARTING_HP).toBe(6000);
    const s = roundGameState([...game, other], game[0]!);
    expect(s.before).toEqual({ duo: 6000, opponents: 6000 });
    expect(s.after).toEqual({ duo: 4500, opponents: 6000 });
  });

  it("rebuilds HP going into a Round mid-Game from the Game's earlier Rounds", () => {
    const s = roundGameState([other, ...game].reverse(), game[2]!);
    expect(s.roundNumber).toBe(3);
    expect(s.roundCount).toBe(4);
    expect(s.multiplier).toBe(1.5);
    expect(s.before).toEqual({ duo: 4500, opponents: 4000 });
    expect(s.after).toEqual({ duo: 1500, opponents: 4000 });
  });

  it("clamps overkill in the last Round at 0 HP", () => {
    const s = roundGameState(game, game[3]!);
    expect(s.roundCount).toBe(4);
    expect(s.before).toEqual({ duo: 1500, opponents: 4000 });
    // 4,500 Damage against 4,000 HP left: the Opponents end on 0, not −500.
    expect(s.after).toEqual({ duo: 1500, opponents: 0 });
  });

  it("counts the Game's Rounds even when the page filter dropped some", () => {
    // Pass the payload's Rounds, not the filtered ones: Round 3 alone still knows Rounds 1–2.
    const s = roundGameState(game, game[2]!);
    expect(s.before.duo).toBe(4500);
  });
});
