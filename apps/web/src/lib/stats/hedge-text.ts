import type { HedgeKind, HedgeKindStats, HedgeSummary, TeamHedgeSummary } from "@geo-coach/shared";
import { formatNumber, formatPercent, formatSigned, unitLabel } from "./overview-text.js";

// Wording for "How do we place our two guesses?" (GLOSSARY: Committed, Spread,
// Split, Call). Takeaways describe what happened in those Rounds; they never say
// that a way of placing the guesses caused the outcome.

export const HEDGE_KIND_LABELS: Record<HedgeKind, string> = {
  committed: "Committed",
  spread: "Spread",
  split: "Split",
};

export const HEDGE_KIND_HINTS: Record<HedgeKind, string> = {
  committed: "Both guesses in one Region",
  spread: "Both guesses in one country, different Regions",
  split: "The guesses in different countries",
};

export function kindOf(team: TeamHedgeSummary, kind: HedgeKind): HedgeKindStats {
  return team.kinds.find((k) => k.kind === kind)!;
}

/** "1,234 km apart, 0.48× the country's size" for tooltips; the ratio only appears here. */
export function distancePhrase(k: Pick<HedgeKindStats, "medianDistanceKm" | "medianSpread">): string {
  if (k.medianDistanceKm === null) return "No distance between the guesses";
  const ratio = k.medianSpread === null ? "" : `, ${k.medianSpread.toFixed(2)}× the country's size`;
  return `Median ${formatNumber(k.medianDistanceKm)} km between the guesses${ratio}`;
}

/** The tooltip for one team's kind. */
export function kindTitle(k: HedgeKindStats, team: "We" | "Opponents"): string {
  return [
    `${team}: ${HEDGE_KIND_LABELS[k.kind]} in ${unitLabel("rounds", k.rounds)} (${formatPercent(k.share)})`,
    `Score gap ${formatSigned(k.avgScoreGap)} · Damage ${formatSigned(k.avgDamage)} per Round`,
    `Right country ${formatPercent(k.rightCountry)} · right Region ${formatPercent(k.rightRegion)}`,
    distancePhrase(k),
  ].join("\n");
}

const lower = (kind: HedgeKind) =>
  kind === "committed" ? "commit" : kind === "spread" ? "Spread" : "Split";

/** The takeaway above the subsection: shares against the Opponents, then what each kind's Rounds looked like. */
export function hedgeTakeaway(summary: HedgeSummary, greyOutRounds: number): string {
  const { duo, opponents } = summary;
  if (duo.classified === 0) return "No Rounds where both of our guesses were placed in this filter.";
  const shares = duo.kinds
    .map((k) => `${lower(k.kind)} in ${formatPercent(k.share)} (Opponents ${formatPercent(kindOf(opponents, k.kind).share)})`)
    .join(", ");
  const outcomes = duo.kinds
    .filter((k) => k.rounds >= greyOutRounds)
    .map((k, i) => `when we ${lower(k.kind)}, ${i === 0 ? "our score gap averages " : ""}${formatSigned(k.avgScoreGap)}`);
  const outcomeText = outcomes.length > 0 ? ` ${capitalise(outcomes.join("; "))}.` : "";
  return `Of ${unitLabel("rounds", duo.classified)}, we ${shares}.${outcomeText}`;
}

/** The note under the Call rows, so missing Transcripts never read as "not called". */
export function callsNote(summary: HedgeSummary): string {
  const { split, spread } = summary.calls;
  const total = split.called + split.notCalled + split.unlabelled + spread.called + spread.notCalled + spread.unlabelled;
  const unlabelled = split.unlabelled + spread.unlabelled;
  if (total === 0) return "No Splits or Spreads to label.";
  if (unlabelled === total) {
    return `None of our ${formatNumber(total)} Splits and Spreads has a Call label yet: no calls run has read them.`;
  }
  return `${formatNumber(total - unlabelled)} of ${formatNumber(total)} Splits and Spreads have a Call label; the rest are unlabelled, not "not called".`;
}

/** The takeaway in a country's detail pane: the kinds at or above the grey-out threshold. */
export function countryHedgeTakeaway(duo: TeamHedgeSummary, countryName: string, greyOutRounds: number): string {
  if (duo.classified === 0) return `No Rounds in ${countryName} where both of our guesses were placed.`;
  const shown = duo.kinds.filter((k) => k.rounds >= greyOutRounds);
  if (shown.length === 0) {
    return `No way of placing our guesses has ${unitLabel("rounds", greyOutRounds)} or more in ${countryName}.`;
  }
  const parts = shown.map(
    (k) => `${formatSigned(k.avgScoreGap)} when we ${lower(k.kind)} (${unitLabel("rounds", k.rounds)})`,
  );
  const last = parts.pop()!;
  const list = parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
  return `In ${countryName}, our score gap averages ${list}.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
