import { regionsOf, type ClaimStatus, type CluePrevalence } from "@geo-coach/shared";

// The Clue lens (#89, ADR 0009): what the Clues said in a Round mean for each country, from the Duo's Claims. Pure,
// so the debrief view only draws it. A Clue the Duo said wasn't there (#93) reads as unlikely where it's typical.

/**
 * A country's fill: ruled out (grey), typical (blue), unlikely (pale grey: typical there, but not seen this Round),
 * or in some areas (light blue).
 */
export type ClueFill = "out" | "typical" | "unlikely" | "some";

/** A Claim's link of a Clue to a country, or to a Region of it (#92), with the Claim's derived status. */
export interface ClueLensLink {
  claimId: string;
  clueId: string;
  country: string;
  /** The geocoder Region code when the link covers one Region; null for the whole country. */
  regionCode: string | null;
  prevalence: CluePrevalence;
  status: ClaimStatus;
}

export const CLUE_FILL_COLOR: Record<ClueFill, string> = { out: "#94a3b8", typical: "#3b82f6", unlikely: "#cbd5e1", some: "#93c5fd" };
export const CLUE_FILL_LABEL: Record<ClueFill, string> = {
  out: "Ruled out",
  typical: "Typical there",
  unlikely: "Unlikely: typical there, not seen this Round",
  some: "In some areas",
};
/** Strongest first (ADR 0009, #91): a seen Clue beats a missing one, and a missing one beats in some areas. */
export const CLUE_FILL_ORDER: readonly ClueFill[] = ["out", "typical", "unlikely", "some"];
const STRENGTH: Record<ClueFill, number> = { out: 4, typical: 3, unlikely: 2, some: 1 };

/**
 * What one link paints. Only a verified Claim rules out (lacks) or shows a Clue as typical; any other typical or
 * some link shows in some areas, so a speculated (or disputed) Claim never says more than that and never rules out.
 * A disproved Claim paints nothing. For a Clue not seen this Round, only a verified typical link paints: unlikely.
 */
function linkFill(l: Pick<ClueLensLink, "prevalence" | "status">, notSeen: boolean): ClueFill | null {
  if (l.status === "disproved") return null;
  const verified = l.status === "verified";
  if (notSeen) return l.prevalence === "typical" && verified ? "unlikely" : null;
  if (l.prevalence === "lacks") return verified ? "out" : null;
  if (l.prevalence === "typical" && verified) return "typical";
  return "some";
}

/**
 * What a link says about its whole country (#92, ADR 0009): a country link as it is; a Region link where the Region
 * has the Clue (typical or in some areas) counts as in some areas, and one where the Region lacks it says nothing.
 */
export function countryLevelLink<L extends ClueLensLink>(l: L): L | null {
  if (l.regionCode === null) return l;
  return l.prevalence === "lacks" ? null : { ...l, regionCode: null, prevalence: "some" };
}

/**
 * Each country's fill for the shown Clues: the strongest of every shown Clue's links there, ruled out first, then
 * typical, unlikely, and in some areas. `notSeen` holds the Clues the Round is tagged as not having. Region links
 * count as `countryLevelLink` says. A country no link covers is left out (neutral).
 */
export function clueLensFills(
  links: readonly ClueLensLink[],
  shown: ReadonlySet<string>,
  notSeen: ReadonlySet<string> = new Set(),
): Map<string, ClueFill> {
  const out = new Map<string, ClueFill>();
  for (const raw of links) {
    const l = countryLevelLink(raw);
    if (!l || !shown.has(l.clueId)) continue;
    const fill = linkFill(l, notSeen.has(l.clueId));
    if (!fill) continue;
    const held = out.get(l.country);
    if (!held || STRENGTH[fill] > STRENGTH[held]) out.set(l.country, fill);
  }
  return out;
}

/** What the map paints: country fills, and Region fills for the countries shaded Region by Region (#92). */
export interface ClueMapFills {
  /** Countries painted whole. */
  countries: Map<string, ClueFill>;
  /** Countries painted Region by Region instead, sorted. */
  regionCountries: string[];
  /** Their Regions' fills by geocoder code; a Region left out is neutral. */
  regions: Map<string, ClueFill>;
}

/**
 * The map's fills for the shown Clues (#92). A country with a Region link that paints is shaded Region by Region:
 * each of its Regions takes the strongest of its own links and the country's whole-country links, in the usual
 * order (a not seen Clue's typical Region reads unlikely), so a Region nothing covers stays neutral. Every other
 * country keeps its `clueLensFills` fill.
 */
export function clueLensMapFills(
  links: readonly ClueLensLink[],
  shown: ReadonlySet<string>,
  notSeen: ReadonlySet<string> = new Set(),
): ClueMapFills {
  const countries = clueLensFills(links, shown, notSeen);
  const stronger = (a: ClueFill | undefined, b: ClueFill | undefined) => (!a || (b && STRENGTH[b] > STRENGTH[a]) ? b : a);
  const whole = new Map<string, ClueFill>();
  const byCountry = new Map<string, Map<string, ClueFill>>();
  for (const l of links) {
    const fill = shown.has(l.clueId) ? linkFill(l, notSeen.has(l.clueId)) : null;
    if (!fill) continue;
    if (l.regionCode === null) {
      whole.set(l.country, stronger(whole.get(l.country), fill)!);
      continue;
    }
    const own = byCountry.get(l.country) ?? new Map<string, ClueFill>();
    own.set(l.regionCode, stronger(own.get(l.regionCode), fill)!);
    byCountry.set(l.country, own);
  }
  const regions = new Map<string, ClueFill>();
  for (const [country, own] of byCountry) {
    countries.delete(country);
    const codes = new Set([...regionsOf(country).map((r) => r.code), ...own.keys()]);
    for (const code of codes) {
      const fill = stronger(whole.get(country), own.get(code));
      if (fill) regions.set(code, fill);
    }
  }
  return { countries, regionCountries: [...byCountry.keys()].sort(), regions };
}

/** How many countries each fill covers, for the legend. */
export function clueFillCounts(fills: ReadonlyMap<string, ClueFill>): Record<ClueFill, number> {
  const counts: Record<ClueFill, number> = { out: 0, typical: 0, unlikely: 0, some: 0 };
  for (const f of fills.values()) counts[f] += 1;
  return counts;
}

/**
 * The country popup's list: every shown Clue's link to the country, the strongest first; links that paint nothing
 * (disproved, an unverified lacks, or a not seen Clue's weaker links) come last, so the popup still says why.
 */
export function clueLensClaims(
  links: readonly ClueLensLink[],
  shown: ReadonlySet<string>,
  country: string,
  notSeen: ReadonlySet<string> = new Set(),
): ClueLensLink[] {
  const rank = (l: ClueLensLink) => {
    const f = linkFill(l, notSeen.has(l.clueId));
    return f ? STRENGTH[f] : 0;
  };
  return links.filter((l) => shown.has(l.clueId) && l.country === country).sort((a, b) => rank(b) - rank(a));
}
