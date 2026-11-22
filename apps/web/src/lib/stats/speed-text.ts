import type { FirstTeam, ScoreByTimeRow, SpeedPoint, SpeedSpread, SpeedStats } from "@geo-coach/shared";
import { formatNumber, formatPercent, formatSeconds, unitLabel } from "./overview-text.js";
import type { NameOf } from "./players-text.js";

// Wording for the Speed section: group and bucket labels, and the takeaways.

/** Buckets with fewer guesses than this are drawn faint and left out of takeaways. */
export const MIN_BUCKET_GUESSES = 5;

export const FIRST_TEAM_LABELS: Record<FirstTeam, string> = {
  duo: "We pressed first",
  opponents: "They pressed first",
  tie: "Same moment",
  nobody: "Nobody pressed",
};

export function spreadLabel(s: SpeedSpread, nameOf: NameOf): string {
  switch (s.group.kind) {
    case "duo-first":
      return "Our first guess";
    case "opponents-first":
      return "Their first guess";
    case "player":
      return nameOf(s.group.playerId);
    case "opponent-each":
      return "Each Opponent";
  }
}

/** "0–10 s", "90 s+", or "Timed out". */
export function bucketLabel(row: Pick<ScoreByTimeRow, "from" | "to" | "timedOut">): string {
  if (row.timedOut || row.from === null) return "Timed out";
  return row.to === null ? `${row.from} s+` : `${row.from}–${row.to} s`;
}

const medianOf = (stats: SpeedStats, kind: "duo-first" | "opponents-first") =>
  stats.spreads.find((s) => s.group.kind === kind)?.median ?? null;

export function slowerTakeaway(stats: SpeedStats): string {
  const ours = medianOf(stats, "duo-first");
  const theirs = medianOf(stats, "opponents-first");
  if (ours === null || theirs === null) return "Not enough pressed guesses on both sides in this filter.";
  const diff = ours - theirs;
  const verdict =
    Math.abs(diff) < 0.5
      ? "as fast as them"
      : `${formatSeconds(Math.abs(diff))} ${diff > 0 ? "slower" : "faster"}`;
  return (
    `Our first guess comes at a median ${formatSeconds(ours)}, the Opponents' at ${formatSeconds(theirs)}: ` +
    `we're ${verdict}.`
  );
}

export function firstTeamTakeaway(stats: SpeedStats): string {
  const ours = stats.firstTeams.find((f) => f.team === "duo");
  const theirs = stats.firstTeams.find((f) => f.team === "opponents");
  if (!ours || !theirs || stats.rounds === 0) return "No Rounds in this filter.";
  const win = (rate: number | null, n: number) =>
    rate === null || n === 0 ? "" : ` and win ${formatPercent(rate)} of them`;
  return (
    `We press guess first in ${formatPercent(ours.share)} of ${unitLabel("rounds", stats.rounds)}` +
    `${win(ours.roundWinRate, ours.rounds)}; when they press first we win ` +
    `${formatPercent(theirs.roundWinRate)}.`
  );
}

export function speedPaysTakeaway(rows: readonly ScoreByTimeRow[]): string {
  const ours = rows.filter((r) => r.side === "duo" && !r.timedOut && r.guesses >= MIN_BUCKET_GUESSES);
  const fast = ours[0];
  const slow = ours.at(-1);
  if (!fast || !slow || fast === slow || fast.avgScore === null || slow.avgScore === null) {
    return `Need at least two time buckets with ${MIN_BUCKET_GUESSES}+ of our guesses.`;
  }
  const timedOut = rows.find((r) => r.side === "duo" && r.timedOut);
  const timedOutPart =
    timedOut && timedOut.guesses >= MIN_BUCKET_GUESSES
      ? `, and timed-out guesses ${formatNumber(timedOut.avgScore)}`
      : "";
  return (
    `Our guesses at ${bucketLabel(fast)} average ${formatNumber(fast.avgScore)} points, ` +
    `at ${bucketLabel(slow)} ${formatNumber(slow.avgScore)}${timedOutPart}.`
  );
}

export function fasterTrendTakeaway(points: readonly SpeedPoint[], rounds: number, window: number): string {
  if (rounds < window) {
    return `Trends need at least ${unitLabel("rounds", window)}; this filter has ${formatNumber(rounds)}.`;
  }
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "No trend in this filter.";
  return (
    `Over ${formatNumber(window)}-Round windows, our first guess went ${formatSeconds(first.duoMedian)} → ` +
    `${formatSeconds(last.duoMedian)}, theirs ${formatSeconds(first.opponentsMedian)} → ` +
    `${formatSeconds(last.opponentsMedian)}.`
  );
}
