import type { StatsRound } from "./payload.js";

/** Both teams' HP at the start of a Game. */
export const STARTING_HP = 6000;

export interface TeamHp {
  duo: number;
  opponents: number;
}

/** Where a Game stood around one of its Rounds. */
export interface RoundGameState {
  roundNumber: number;
  /** The Game's Rounds in the payload. */
  roundCount: number;
  multiplier: number;
  /** HP going into the Round. */
  before: TeamHp;
  /** HP after it; overkill stops at 0. */
  after: TeamHp;
}

function applyRound(hp: TeamHp, round: StatsRound): TeamHp {
  return {
    duo: Math.max(0, hp.duo - Math.max(0, -round.hpDelta)),
    opponents: Math.max(0, hp.opponents - Math.max(0, round.hpDelta)),
  };
}

/**
 * Both teams' HP before and after a Round, rebuilt from its Game's earlier Rounds
 * from STARTING_HP. Pass the payload's Rounds, not the filtered ones, so a filter
 * that drops earlier Rounds of the Game doesn't change the answer.
 */
export function roundGameState(rounds: readonly StatsRound[], round: StatsRound): RoundGameState {
  const gameRounds = rounds
    .filter((r) => r.gameId === round.gameId)
    .sort((a, b) => a.roundNumber - b.roundNumber);
  let before: TeamHp = { duo: STARTING_HP, opponents: STARTING_HP };
  for (const r of gameRounds) {
    if (r.roundNumber >= round.roundNumber) break;
    before = applyRound(before, r);
  }
  return {
    roundNumber: round.roundNumber,
    roundCount: gameRounds.length,
    multiplier: round.damageMultiplier,
    before,
    after: applyRound(before, round),
  };
}
