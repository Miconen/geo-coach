import { mean, median } from "./math.js";
import type { StatsRound } from "./payload.js";
import { damageDealt, damageTaken } from "./rounds.js";

export interface RoundHeadline {
  rounds: number;
  /** Rounds where the Duo dealt Damage. */
  roundsWon: number;
  /** Rounds where either side dealt Damage (ties left out). */
  roundsDecided: number;
  roundWinRate: number | null;
  avgDuoScore: number | null;
  avgOpponentScore: number | null;
  /** Damage dealt and taken per Round, overkill counted. */
  avgDamageDealt: number | null;
  avgDamageTaken: number | null;
  /** Median seconds to guess over every guess of each side. */
  medianDuoSecondsToGuess: number | null;
  medianOpponentSecondsToGuess: number | null;
}

/** The Round-level headline numbers, over whatever Rounds the filter kept. */
export function roundHeadline(rounds: readonly StatsRound[]): RoundHeadline {
  const decided = rounds.filter((r) => r.hpDelta !== 0);
  const roundsWon = decided.filter((r) => r.hpDelta > 0).length;
  const seconds = (isDuo: boolean) =>
    rounds.flatMap((r) =>
      r.guesses.flatMap((g) => (g.isDuo === isDuo && g.secondsToGuess !== null ? [g.secondsToGuess] : [])),
    );
  return {
    rounds: rounds.length,
    roundsWon,
    roundsDecided: decided.length,
    roundWinRate: decided.length > 0 ? roundsWon / decided.length : null,
    avgDuoScore: mean(rounds.map((r) => r.duoBestScore)),
    avgOpponentScore: mean(rounds.map((r) => r.opponentBestScore)),
    avgDamageDealt: mean(rounds.map(damageDealt)),
    avgDamageTaken: mean(rounds.map(damageTaken)),
    medianDuoSecondsToGuess: median(seconds(true)),
    medianOpponentSecondsToGuess: median(seconds(false)),
  };
}
