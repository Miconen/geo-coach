import { getCountryName, overseasRegionOf, regionName, type CountryRow } from "@geo-coach/shared";
import { formatNumber, formatSigned, unitLabel } from "./overview-text.js";

// Wording for the Rankings section: place names and the computed takeaways.

/**
 * A place as a confusion pair names it: a country, an overseas Region counted as
 * its own country (`FR-GUF`), or the water (null).
 */
export function placeName(code: string | null): string {
  if (code === null) return "the water";
  return overseasRegionOf(null, code)?.name ?? getCountryName(code);
}

/** The table row (GeoGuessr's country) a confusion pair's actual place belongs to. */
export function rowCountryOf(code: string): string {
  return overseasRegionOf(null, code)?.countryCode ?? code;
}

export function regionLabel(code: string | null): string {
  return code === null ? "unknown Region" : (regionName(code) ?? code);
}

/** "3× · −1,234", or just "3×" when no Damage was taken. */
export function countAndDamage({ count, damage }: { count: number; damage: number }): string {
  return damage > 0 ? `${count}× · −${formatNumber(damage)}` : `${count}×`;
}

/** "+123 per Round over 8 Rounds" */
function gapPhrase(row: CountryRow): string {
  return `${formatSigned(row.gap)} per Round over ${unitLabel("rounds", row.rounds)}`;
}

/** The takeaway above the gap chart, from its rows (best first). */
export function gapTakeaway(chartRows: readonly CountryRow[], greyOutRounds: number): string {
  const carry = chartRows.filter((r) => r.gap > 0);
  const cost = chartRows.filter((r) => r.gap < 0);
  if (chartRows.length === 0) {
    return `No country has ${unitLabel("rounds", greyOutRounds)} or more in this filter.`;
  }
  const parts: string[] = [];
  if (cost.length > 0) {
    const worst = cost.at(-1)!;
    parts.push(`${getCountryName(worst.countryCode)} costs us most (${gapPhrase(worst)})`);
  }
  if (carry.length > 0) {
    const best = carry[0]!;
    parts.push(`${getCountryName(best.countryCode)} carries us most (${gapPhrase(best)})`);
  }
  const lead = parts.length > 0 ? `${parts.join("; ")}.` : "Every country is level with the Opponents.";
  return `${lead} Score gap against the Opponents, pulled toward our mean; countries with fewer than ${unitLabel("rounds", greyOutRounds)} left out.`;
}

/** The takeaway above a country's Round timeline. */
export function learningTakeaway(row: CountryRow): string {
  if (row.firstLearningAtMs === null) {
    return `No Learning names ${getCountryName(row.countryCode)} yet.`;
  }
  const { beforeLearning: before, afterLearning: after } = row;
  const side = (s: typeof before) =>
    s.rounds === 0 ? "no Rounds" : `${formatNumber(s.avgScore)} over ${unitLabel("rounds", s.rounds)}`;
  return `Average score before the first Learning: ${side(before)}; after: ${side(after)}.`;
}
