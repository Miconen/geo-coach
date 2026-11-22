// The Speed section of the statistics page (#42): are we slower than the
// Opponents, who guesses first, and does guessing fast pay? Timed-out guesses
// (GLOSSARY) never count as a time to guess: their time is just the timer.
// They get their own bucket in the score-by-time rows instead.

import type { FilteredStats } from "./filter.js";
import { hedgeKind } from "./hedge.js";
import { mean, median, quantile } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";
import type { PlayerRef } from "./players.js";
import { inRoundOrder } from "./rounds.js";
import { rollingWindows } from "./smoothing.js";

const isPressed = (g: StatsGuess): g is StatsGuess & { secondsToGuess: number } =>
  !g.timedOut && g.secondsToGuess !== null;

/**
 * Seconds to the first pressed guess of one side in the Round, or null when
 * nobody on that side pressed guess.
 */
export function firstPressSeconds(round: StatsRound, isDuo: boolean): number | null {
  const times = round.guesses.filter((g) => g.isDuo === isDuo && isPressed(g)).map((g) => g.secondsToGuess!);
  return times.length ? Math.min(...times) : null;
}

/**
 * The team that pressed guess first in the Round, so put the other team on the
 * countdown. "tie" when both pressed at the same moment; "nobody" when neither
 * team pressed guess.
 */
export type FirstTeam = "duo" | "opponents" | "tie" | "nobody";

export const FIRST_TEAMS: readonly FirstTeam[] = ["duo", "opponents", "tie", "nobody"];

export function firstTeam(round: StatsRound): FirstTeam {
  const duo = firstPressSeconds(round, true);
  const opponents = firstPressSeconds(round, false);
  if (duo === null && opponents === null) return "nobody";
  if (opponents === null || (duo !== null && duo < opponents)) return "duo";
  if (duo === null || opponents < duo) return "opponents";
  return "tie";
}

/** The Rounds won by whichever team pressed guess first. */
export interface FirstTeamOutcome {
  team: FirstTeam;
  rounds: number;
  share: number | null;
  /** Rounds the Duo dealt Damage in, over the Rounds either side did (ties left out). */
  roundWinRate: number | null;
  /** Damage dealt minus taken per Round. */
  avgNetDamage: number | null;
  avgDuoScore: number | null;
  avgOpponentScore: number | null;
}

function firstTeamOutcomes(rounds: readonly StatsRound[]): FirstTeamOutcome[] {
  return FIRST_TEAMS.map((team) => {
    const rs = rounds.filter((r) => firstTeam(r) === team);
    const decided = rs.filter((r) => r.hpDelta !== 0);
    return {
      team,
      rounds: rs.length,
      share: rounds.length ? rs.length / rounds.length : null,
      roundWinRate: decided.length ? decided.filter((r) => r.hpDelta > 0).length / decided.length : null,
      avgNetDamage: mean(rs.map((r) => r.hpDelta)),
      avgDuoScore: mean(rs.map((r) => r.duoBestScore)),
      avgOpponentScore: mean(rs.map((r) => r.opponentBestScore)),
    };
  });
}

/** Who a time-to-guess spread is for. */
export type SpeedGroup =
  | { kind: "duo-first" }
  | { kind: "opponents-first" }
  | { kind: "player"; playerId: string }
  | { kind: "opponent-each" };

/** How spread out one group's times to guess are, over pressed guesses. */
export interface SpeedSpread {
  group: SpeedGroup;
  count: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

function spread(group: SpeedGroup, seconds: readonly number[]): SpeedSpread {
  return {
    group,
    count: seconds.length,
    p25: quantile(seconds, 0.25),
    median: median(seconds),
    p75: quantile(seconds, 0.75),
  };
}

/** The time buckets of the score-by-time rows: [from, to) seconds, the last open-ended. */
export const SPEED_BUCKETS: readonly { from: number; to: number | null }[] = [
  { from: 0, to: 10 },
  { from: 10, to: 20 },
  { from: 20, to: 30 },
  { from: 30, to: 45 },
  { from: 45, to: 60 },
  { from: 60, to: 90 },
  { from: 90, to: null },
];

export type SpeedSide = "duo" | "opponents";

/** One side's guesses in one time bucket, or its timed-out guesses (`from` null). */
export interface ScoreByTimeRow {
  side: SpeedSide;
  /** Bucket bounds in seconds; both null for the timed-out row. */
  from: number | null;
  to: number | null;
  timedOut: boolean;
  guesses: number;
  avgScore: number | null;
  medianKm: number | null;
}

/** A side's placed guesses on Rounds where that side didn't Split: a Split's other guess is a hedge. */
function sideGuessesNotSplit(rounds: readonly StatsRound[], isDuo: boolean): StatsGuess[] {
  return rounds.flatMap((r) => {
    const side = r.guesses.filter((g) => g.isDuo === isDuo);
    if (hedgeKind(side) === "split") return [];
    return side.filter((g) => g.lat !== null && g.lng !== null);
  });
}

function scoreRow(side: SpeedSide, from: number | null, to: number | null, timedOut: boolean, gs: StatsGuess[]): ScoreByTimeRow {
  return {
    side,
    from,
    to,
    timedOut,
    guesses: gs.length,
    avgScore: mean(gs.map((g) => g.score)),
    medianKm: median(gs.flatMap((g) => (g.distanceMeters === null ? [] : [g.distanceMeters / 1000]))),
  };
}

/** Every placed guess's points by how long it took, per side, Splits left out. Empty buckets are kept. */
export function scoreByTime(rounds: readonly StatsRound[]): ScoreByTimeRow[] {
  return (["duo", "opponents"] as const).flatMap((side) => {
    const gs = sideGuessesNotSplit(rounds, side === "duo");
    const pressed = gs.filter(isPressed);
    return [
      ...SPEED_BUCKETS.map(({ from, to }) =>
        scoreRow(
          side,
          from,
          to,
          false,
          pressed.filter((g) => g.secondsToGuess! >= from && (to === null || g.secondsToGuess! < to)),
        ),
      ),
      scoreRow(side, null, null, true, gs.filter((g) => g.timedOut)),
    ];
  });
}

/** One point of the speed trend: medians over a window of Rounds, in play order. */
export interface SpeedPoint {
  /** The 1-based position, in Round order, of the window's last Round. */
  roundIndex: number;
  /** Median seconds to each team's first pressed guess over the window. */
  duoMedian: number | null;
  opponentsMedian: number | null;
  /** Rounds in the window where the Duo pressed guess first. */
  duoFirstShare: number;
}

export function speedSeries(rounds: readonly StatsRound[], window: number): SpeedPoint[] {
  const firstTimes = (rs: readonly StatsRound[], isDuo: boolean) =>
    rs.flatMap((r) => {
      const s = firstPressSeconds(r, isDuo);
      return s === null ? [] : [s];
    });
  return rollingWindows(inRoundOrder(rounds), window).map(({ end, items }) => ({
    roundIndex: end,
    duoMedian: median(firstTimes(items, true)),
    opponentsMedian: median(firstTimes(items, false)),
    duoFirstShare: items.filter((r) => firstTeam(r) === "duo").length / items.length,
  }));
}

/** Everything the Speed section shows, over the filtered Rounds. */
export interface SpeedStats {
  rounds: number;
  /** In order: the Duo's first press, the Opponents' first press, each Player, each Opponent. */
  spreads: SpeedSpread[];
  firstTeams: FirstTeamOutcome[];
  scoreByTime: ScoreByTimeRow[];
  series: SpeedPoint[];
}

export function speedStats(
  filtered: FilteredStats,
  players: readonly PlayerRef[],
  window: number,
): SpeedStats {
  const { rounds } = filtered;
  const firsts = (isDuo: boolean) =>
    rounds.flatMap((r) => {
      const s = firstPressSeconds(r, isDuo);
      return s === null ? [] : [s];
    });
  const pressedBy = (match: (g: StatsGuess) => boolean) =>
    rounds.flatMap((r) => r.guesses.filter((g) => match(g) && isPressed(g)).map((g) => g.secondsToGuess!));
  return {
    rounds: rounds.length,
    spreads: [
      spread({ kind: "duo-first" }, firsts(true)),
      spread({ kind: "opponents-first" }, firsts(false)),
      ...players.map(({ id }) =>
        spread({ kind: "player", playerId: id }, pressedBy((g) => g.isDuo && g.playerId === id)),
      ),
      spread({ kind: "opponent-each" }, pressedBy((g) => !g.isDuo)),
    ],
    firstTeams: firstTeamOutcomes(rounds),
    scoreByTime: scoreByTime(rounds),
    series: speedSeries(rounds, window),
  };
}
