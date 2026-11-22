import { getCountryName, type CountryVersusRow, type VersusNumbers, type VersusPoint } from "@geo-coach/shared";
import { formatNumber, formatPercent, unitLabel } from "./overview-text.js";

// Wording for the Versus Opponents section.

/** How many countries the takeaway names. */
const NAMED_COUNTRIES = 3;

export function versusHeadline(n: VersusNumbers): string {
  if (n.compared === 0) return "No Rounds where both teams placed a guess in this filter.";
  return (
    `Our best guess was the closer one in ${formatPercent(n.closerShare)} of ` +
    `${unitLabel("rounds", n.compared)}: median ${formatNumber(n.duoMedianKm)} km off against ` +
    `their ${formatNumber(n.opponentsMedianKm)} km.`
  );
}

/** Countries at or above the threshold, where the Opponents are closer most often first. */
export function outGuessedCountries(
  rows: readonly CountryVersusRow[],
  greyOutRounds: number,
): CountryVersusRow[] {
  return rows
    .filter((r) => r.rounds >= greyOutRounds && r.closerShare !== null)
    .sort((a, b) => a.closerShare! - b.closerShare! || b.rounds - a.rounds);
}

export function outGuessedTakeaway(rows: readonly CountryVersusRow[], greyOutRounds: number): string {
  const worst = outGuessedCountries(rows, greyOutRounds).filter((r) => r.closerShare! < 0.5);
  if (rows.every((r) => r.rounds < greyOutRounds)) {
    return `No country has ${unitLabel("rounds", greyOutRounds)} or more in this filter.`;
  }
  if (worst.length === 0) return "Our best guess is the closer one at least half the time in every country.";
  const named = worst
    .slice(0, NAMED_COUNTRIES)
    .map((r) => `${getCountryName(r.countryCode)} (ours closer ${formatPercent(r.closerShare)})`);
  const list = named.length <= 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `The Opponents out-guess us most in ${list}.`;
}

export function aheadTakeaway(points: readonly VersusPoint[], rounds: number, window: number): string {
  if (rounds < window) {
    return `Trends need at least ${unitLabel("rounds", window)}; this filter has ${formatNumber(rounds)}.`;
  }
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "No trend in this filter.";
  const delta = (last.closerShare ?? 0) - (first.closerShare ?? 0);
  const direction = Math.abs(delta) < 0.02 ? "holding level" : delta > 0 ? "pulling ahead" : "falling behind";
  return (
    `Over ${formatNumber(window)}-Round windows, we're ${direction}: our best guess was closer in ` +
    `${formatPercent(first.closerShare)} → ${formatPercent(last.closerShare)} of Rounds.`
  );
}
