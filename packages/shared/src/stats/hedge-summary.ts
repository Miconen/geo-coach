import { countrySizeMeters } from "../country-sizes.js";
import { mistakeCountryCode } from "../overseas-regions.js";
import type { FilteredStats } from "./filter.js";
import { roundHedge, type HedgeKind } from "./hedge.js";
import { mean, median } from "./math.js";
import type { StatsGuess, StatsRound } from "./payload.js";

/** The three hedge kinds in display order: most committed first. */
export const HEDGE_KINDS: readonly HedgeKind[] = ["committed", "spread", "split"];

/** The team a hedge summary describes; every number is from that team's side. */
export type HedgeTeam = "duo" | "opponents";

/** One team's Rounds of one hedge kind, with how they went for that team. */
export interface HedgeKindStats {
  kind: HedgeKind;
  rounds: number;
  /** Share of the team's classified Rounds; null when none is classified. */
  share: number | null;
  /** The team's best score minus the other team's best, per Round. */
  avgScoreGap: number | null;
  /** Damage dealt minus Damage taken by the team, per Round. */
  avgDamage: number | null;
  /**
   * Share of Rounds where one of the team's guesses was in the right country
   * (overseas Regions count as their own): whether the placement covered the
   * answer, as with #40's Splits caught.
   */
  rightCountry: number | null;
  /** Share of Rounds where one of the team's guesses was in the right Region. */
  rightRegion: number | null;
  /** Median distance between the team's two guesses, in km. */
  medianDistanceKm: number | null;
  /** Median of that distance ÷ the country's size (√area); for tooltips only. */
  medianSpread: number | null;
}

export interface TeamHedgeSummary {
  team: HedgeTeam;
  /** One entry per kind, in HEDGE_KINDS order, also when a kind has no Rounds. */
  kinds: HedgeKindStats[];
  /** Rounds with a hedge kind (the share's denominator). */
  classified: number;
  /** Rounds without: fewer than two placed guesses, or a country or Region missing. */
  unclassified: number;
}

/**
 * The Duo's Splits or Spreads by Call (GLOSSARY). `unlabelled` counts Rounds no
 * `calls` run has labelled: never fold it into `notCalled`.
 */
export interface CallBreakdown {
  called: number;
  notCalled: number;
  unlabelled: number;
}

export interface HedgeSummary {
  duo: TeamHedgeSummary;
  /** The baseline: the Opponents' guesses classified by the same rules. */
  opponents: TeamHedgeSummary;
  /** Calls are only read for the Duo. */
  calls: { split: CallBreakdown; spread: CallBreakdown };
}

/** One Round as one team placed its guesses. */
export interface TeamHedgeRound {
  round: StatsRound;
  kind: HedgeKind | null;
  distanceMeters: number | null;
  /** Distance between the guesses ÷ the country's size; null when unknown. */
  spread: number | null;
}

function teamGuesses(round: StatsRound, team: HedgeTeam): StatsGuess[] {
  return round.guesses.filter((g) => g.isDuo === (team === "duo"));
}

/** Classifies one team's guesses in a Round, normalised by the country sizes from #39. */
export function teamHedgeRound(round: StatsRound, team: HedgeTeam): TeamHedgeRound {
  return { round, ...roundHedge(round, teamGuesses(round, team), countrySizeMeters) };
}

function coversCountry(round: StatsRound, team: HedgeTeam): boolean {
  if (!round.countryCode) return false;
  const actual = mistakeCountryCode(round.countryCode, round.regionCode);
  return teamGuesses(round, team).some(
    (g) => g.lat !== null && g.lng !== null && mistakeCountryCode(g.countryCode, g.regionCode) === actual,
  );
}

function coversRegion(round: StatsRound, team: HedgeTeam): boolean {
  return (
    round.regionCode !== null &&
    teamGuesses(round, team).some((g) => g.lat !== null && g.regionCode === round.regionCode)
  );
}

function share(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function kindStats(
  kind: HedgeKind,
  hedges: readonly TeamHedgeRound[],
  team: HedgeTeam,
  classified: number,
): HedgeKindStats {
  const sign = team === "duo" ? 1 : -1;
  const rounds = hedges.map((h) => h.round);
  const nonNull = (values: (number | null)[]) => values.filter((v): v is number => v !== null);
  return {
    kind,
    rounds: rounds.length,
    share: share(rounds.length, classified),
    avgScoreGap: mean(rounds.map((r) => sign * (r.duoBestScore - r.opponentBestScore))),
    avgDamage: mean(rounds.map((r) => sign * r.hpDelta)),
    rightCountry: share(rounds.filter((r) => coversCountry(r, team)).length, rounds.length),
    rightRegion: share(rounds.filter((r) => coversRegion(r, team)).length, rounds.length),
    medianDistanceKm: median(nonNull(hedges.map((h) => h.distanceMeters)).map((m) => m / 1000)),
    medianSpread: median(nonNull(hedges.map((h) => h.spread))),
  };
}

/** How one team placed its guesses over the given Rounds, per hedge kind. */
export function teamHedgeSummary(
  rounds: readonly StatsRound[],
  team: HedgeTeam,
): TeamHedgeSummary {
  return summarize(rounds.map((r) => teamHedgeRound(r, team)), team);
}

function summarize(hedges: readonly TeamHedgeRound[], team: HedgeTeam): TeamHedgeSummary {
  const classified = hedges.filter((h) => h.kind !== null).length;
  return {
    team,
    kinds: HEDGE_KINDS.map((kind) =>
      kindStats(kind, hedges.filter((h) => h.kind === kind), team, classified),
    ),
    classified,
    unclassified: hedges.length - classified,
  };
}

function callBreakdown(rounds: readonly StatsRound[]): CallBreakdown {
  return {
    called: rounds.filter((r) => r.call === "called").length,
    notCalled: rounds.filter((r) => r.call === "not-called").length,
    unlabelled: rounds.filter((r) => r.call === null).length,
  };
}

/**
 * The "How do we place our two guesses?" numbers over the filtered Rounds: each
 * hedge kind for the Duo and for the Opponents (the baseline), and the Duo's
 * Splits and Spreads by Call. A Round panel, so the country filter applies.
 */
export function hedgeSummary(filtered: Pick<FilteredStats, "rounds">): HedgeSummary {
  const duo = filtered.rounds.map((r) => teamHedgeRound(r, "duo"));
  const ofKind = (kind: HedgeKind) => duo.filter((h) => h.kind === kind).map((h) => h.round);
  return {
    duo: summarize(duo, "duo"),
    opponents: teamHedgeSummary(filtered.rounds, "opponents"),
    calls: { split: callBreakdown(ofKind("split")), spread: callBreakdown(ofKind("spread")) },
  };
}
