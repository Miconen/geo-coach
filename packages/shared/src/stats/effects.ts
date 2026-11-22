// "What happens when…": a generic two-stage comparison for the statistics page.
// Pick a condition on a Round (or on what came before it) and an outcome; the
// outcome is compared between Rounds where the condition holds and where it
// doesn't, with a 95% interval, optionally split by country, Mode or Map so a
// confounder like "easy countries are also fast ones" can be seen through.

import { duoFirstGuesser } from "./first-guesser.js";
import { STARTING_HP } from "./game-state.js";
import { hedgeKind } from "./hedge.js";
import { groupBy, mean } from "./math.js";
import type { StatsGame, StatsPayload, StatsRound } from "./payload.js";
import { isPlayerBest, type PlayerRef } from "./players.js";
import { isSlow, mistakeClass, scoreGap, slowThreshold } from "./rounds.js";
import { firstPressSeconds, firstTeam } from "./speed.js";
import { duoCloser } from "./versus.js";

/** A Game counts as "previous" only if it started within this long before. */
export const PREVIOUS_GAME_MAX_GAP_MS = 2 * 60 * 60 * 1000;

/** Groups smaller than this are shown but never called a real difference. */
export const MIN_EFFECT_ROUNDS = 10;

/** z for a two-sided 95% interval. */
const Z95 = 1.96;

/** The automatic scan tests many pairs, so it asks for a much stronger signal. */
export const SCAN_MIN_Z = 3.5;

/** Everything a condition or outcome may read besides the Round itself. */
export interface EffectContext {
  gameOf: Map<string, StatsGame>;
  /** The Duo's Game played just before (within PREVIOUS_GAME_MAX_GAP_MS), or null. */
  previousGameOf: Map<string, StatsGame | null>;
  /** Duo HP minus Opponents' HP going into each Round, from the whole payload. */
  hpLeadBefore: Map<string, number>;
  slowThresholdSeconds: number | null;
}

/** Built once from the whole payload, so a filter never changes what came before. */
export function effectContext(payload: StatsPayload): EffectContext {
  const games = [...payload.games].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const previousGameOf = new Map<string, StatsGame | null>();
  games.forEach((g, i) => {
    const prev = games[i - 1];
    previousGameOf.set(
      g.id,
      prev && g.startedAtMs - prev.startedAtMs <= PREVIOUS_GAME_MAX_GAP_MS ? prev : null,
    );
  });
  const hpLeadBefore = new Map<string, number>();
  for (const rounds of groupBy(payload.rounds, (r) => r.gameId).values()) {
    let duo = STARTING_HP;
    let opponents = STARTING_HP;
    for (const r of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
      hpLeadBefore.set(r.id, duo - opponents);
      duo = Math.max(0, duo - Math.max(0, -r.hpDelta));
      opponents = Math.max(0, opponents - Math.max(0, r.hpDelta));
    }
  }
  return {
    gameOf: new Map(payload.games.map((g) => [g.id, g])),
    previousGameOf,
    hpLeadBefore,
    slowThresholdSeconds: slowThreshold(payload.rounds),
  };
}

/** A yes/no question about a Round; null when it doesn't apply (the Round is left out). */
export interface EffectCondition {
  id: string;
  label: string;
  test: (round: StatsRound, ctx: EffectContext) => boolean | null;
  /** Outcome ids this condition implies by definition; the automatic scan skips them. */
  obvious?: string[];
}

export type EffectFormat = "percent" | "points" | "seconds";

/** A number per Round (0/1 for a rate); null when the Round has none. */
export interface EffectOutcome {
  id: string;
  label: string;
  format: EffectFormat;
  value: (round: StatsRound, ctx: EffectContext) => number | null;
}

const yesNo = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0);
const duoHedge = (r: StatsRound) => hedgeKind(r.guesses.filter((g) => g.isDuo));

export function effectConditions(players: readonly (PlayerRef & { displayName?: string })[]): EffectCondition[] {
  const name = (p: PlayerRef & { displayName?: string }) => p.displayName ?? p.id;
  return [
    ...players.map((p) => ({
      id: `first:${p.id}`,
      label: `${name(p)} pressed guess first (in the Duo)`,
      test: (r: StatsRound) => {
        const f = duoFirstGuesser(r.guesses);
        return f.kind === "player" ? f.playerId === p.id : null;
      },
    })),
    { id: "duo-first", label: "We pressed guess before the Opponents", obvious: ["first-press"], test: (r) => {
      const t = firstTeam(r);
      return t === "duo" ? true : t === "opponents" ? false : null;
    } },
    { id: "split", label: "We Split", test: (r) => (duoHedge(r) === null ? null : duoHedge(r) === "split") },
    { id: "committed", label: "We Committed", test: (r) => (duoHedge(r) === null ? null : duoHedge(r) === "committed") },
    { id: "called", label: "The Split or Spread was a Call", test: (r) => (r.call === null ? null : r.call === "called") },
    { id: "slow", label: "Our best guess was slow", obvious: ["first-press"], test: (r, c) => (c.slowThresholdSeconds === null ? null : isSlow(r, c.slowThresholdSeconds)) },
    { id: "multiplier", label: "Damage multiplier above 1", test: (r) => r.damageMultiplier > 1 },
    { id: "behind", label: "We were behind on HP going in", test: (r, c) => {
      const lead = c.hpLeadBefore.get(r.id);
      return lead === undefined || lead === 0 ? null : lead < 0;
    } },
    { id: "late", label: "Round 5 or later", test: (r) => r.roundNumber >= 5 },
    { id: "nmpz", label: "NMPZ Game", test: (r, c) => {
      const mode = c.gameOf.get(r.gameId)?.mode;
      return mode ? mode === "nmpz" : null;
    } },
    { id: "rated-above", label: "Opponents rated above us", test: (r, c) => {
      const g = c.gameOf.get(r.gameId);
      return g?.opponentRatingBefore == null || g.ratingBefore == null ? null : g.opponentRatingBefore > g.ratingBefore;
    } },
    { id: "after-loss", label: "The previous Game was a loss", test: (r, c) => {
      const prev = c.previousGameOf.get(r.gameId);
      return prev?.won == null ? null : !prev.won;
    } },
    { id: "in-session", label: "Played in a recorded Session", test: (r, c) => c.gameOf.get(r.gameId)?.sessionId != null },
  ];
}

export function effectOutcomes(players: readonly (PlayerRef & { displayName?: string })[]): EffectOutcome[] {
  const name = (p: PlayerRef & { displayName?: string }) => p.displayName ?? p.id;
  return [
    { id: "round-won", label: "Round win rate", format: "percent", value: (r) => (r.hpDelta === 0 ? null : r.hpDelta > 0 ? 1 : 0) },
    { id: "net-damage", label: "Net damage per Round", format: "points", value: (r) => r.hpDelta },
    { id: "score", label: "Our best score", format: "points", value: (r) => r.duoBestScore },
    { id: "score-gap", label: "Score gap vs Opponents", format: "points", value: scoreGap },
    { id: "wrong-country", label: "Wrong-country rate", format: "percent", value: (r) => {
      const c = mistakeClass(r);
      return c === null ? null : c === "wrong-country" ? 1 : 0;
    } },
    { id: "closer", label: "Our best guess closer than theirs", format: "percent", value: (r) => yesNo(duoCloser(r)) },
    { id: "first-press", label: "Seconds to our first guess", format: "seconds", value: (r) => firstPressSeconds(r, true) },
    ...players.map((p) => ({
      id: `best:${p.id}`,
      label: `${name(p)} had our best guess`,
      format: "percent" as const,
      value: (r: StatsRound) => (r.guesses.some((g) => g.isDuo && g.isBestForTeam) ? yesNo(isPlayerBest(r, p.id)) : null),
    })),
  ];
}

/** One side of a comparison. */
export interface EffectGroup {
  n: number;
  value: number | null;
  /** Standard error of the mean. */
  se: number | null;
}

export interface EffectResult {
  when: EffectGroup;
  otherwise: EffectGroup;
  /** when − otherwise, with its 95% interval. */
  diff: number | null;
  low: number | null;
  high: number | null;
  z: number | null;
  /** Both groups big enough and the interval clear of zero. */
  real: boolean;
}

function group(values: readonly number[]): EffectGroup {
  const m = mean(values);
  if (m === null) return { n: 0, value: null, se: null };
  const variance = values.length > 1 ? values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1) : 0;
  return { n: values.length, value: m, se: Math.sqrt(variance / values.length) };
}

/** The outcome where the condition holds against where it doesn't. */
export function compareEffect(
  rounds: readonly StatsRound[],
  condition: EffectCondition,
  outcome: EffectOutcome,
  ctx: EffectContext,
): EffectResult {
  const yes: number[] = [];
  const no: number[] = [];
  for (const r of rounds) {
    const holds = condition.test(r, ctx);
    const v = holds === null ? null : outcome.value(r, ctx);
    if (v === null || holds === null) continue;
    (holds ? yes : no).push(v);
  }
  const when = group(yes);
  const otherwise = group(no);
  if (when.value === null || otherwise.value === null) {
    return { when, otherwise, diff: null, low: null, high: null, z: null, real: false };
  }
  const diff = when.value - otherwise.value;
  const se = Math.sqrt(when.se! ** 2 + otherwise.se! ** 2);
  // No spread on either side: any difference is as clear as it gets.
  const z = se > 0 ? diff / se : diff === 0 ? 0 : Math.sign(diff) * Infinity;
  return {
    when,
    otherwise,
    diff,
    low: diff - Z95 * se,
    high: diff + Z95 * se,
    z,
    real: when.n >= MIN_EFFECT_ROUNDS && otherwise.n >= MIN_EFFECT_ROUNDS && z !== null && Math.abs(z) >= Z95,
  };
}

export type EffectSplit = "country" | "mode" | "map";

/** The comparison within each country, Mode or Map, biggest groups first. */
export function splitEffect(
  rounds: readonly StatsRound[],
  condition: EffectCondition,
  outcome: EffectOutcome,
  ctx: EffectContext,
  by: EffectSplit,
): { key: string; result: EffectResult }[] {
  const keyOf = (r: StatsRound): string | null => {
    const g = ctx.gameOf.get(r.gameId);
    return by === "country" ? r.countryCode : by === "mode" ? (g?.mode ?? null) : (g?.mapName ?? null);
  };
  return [...groupBy(rounds, keyOf)]
    .filter(([key]) => key !== null)
    .map(([key, rs]) => ({ key: key!, result: compareEffect(rs, condition, outcome, ctx) }))
    .filter((s) => s.result.diff !== null)
    .sort((a, b) => b.result.when.n + b.result.otherwise.n - (a.result.when.n + a.result.otherwise.n));
}

export interface ScanFinding {
  condition: EffectCondition;
  outcome: EffectOutcome;
  result: EffectResult;
}

/**
 * Every condition against every outcome, keeping only strong signals
 * (|z| ≥ SCAN_MIN_Z, both groups ≥ MIN_EFFECT_ROUNDS), strongest first. Many
 * pairs are tested, so these are leads to check, not findings.
 */
export function scanEffects(
  rounds: readonly StatsRound[],
  conditions: readonly EffectCondition[],
  outcomes: readonly EffectOutcome[],
  ctx: EffectContext,
): ScanFinding[] {
  return conditions
    .flatMap((condition) =>
      outcomes
        .filter((outcome) => !condition.obvious?.includes(outcome.id))
        .map((outcome) => ({ condition, outcome, result: compareEffect(rounds, condition, outcome, ctx) })),
    )
    .filter(
      ({ result: r }) =>
        r.z !== null && Math.abs(r.z) >= SCAN_MIN_Z && r.when.n >= MIN_EFFECT_ROUNDS && r.otherwise.n >= MIN_EFFECT_ROUNDS,
    )
    .sort((a, b) => Math.abs(b.result.z!) - Math.abs(a.result.z!));
}
