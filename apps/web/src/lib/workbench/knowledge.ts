import { getCountryName, type ClaimStatus } from "@geo-coach/shared";
import type {
  WorkbenchClaim,
  WorkbenchData,
  WorkbenchEvidence,
} from "$lib/server/workbench/view-model.js";

/** How each derived status reads. A speculated Claim is never presented as fact. */
export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; hint: string }> = {
  speculated: { label: "Unconfirmed", hint: "No Evidence yet: a guess, not a fact" },
  verified: { label: "Verified", hint: "Evidence for it, none against" },
  disproved: { label: "Disproved", hint: "Evidence against it, none for" },
  disputed: { label: "Disputed", hint: "Evidence both for and against" },
};

export const CLAIM_STATUSES: ClaimStatus[] = ["speculated", "verified", "disproved", "disputed"];

export interface ClaimFilters {
  status: ClaimStatus | "all";
  topic: string | "all";
  query: string;
  /** Only Claims about this country. */
  country: string | null;
  /** Recall (#56 X4): a Claim still masked matches no query, so a search never hints at hidden text. */
  masked?: (claimId: string) => boolean;
}

export function filterWorkbenchClaims(claims: WorkbenchClaim[], f: ClaimFilters): WorkbenchClaim[] {
  const q = f.query.trim().toLowerCase();
  return claims.filter((c) => {
    if (f.status !== "all" && c.status !== f.status) return false;
    if (f.topic !== "all" && !c.topics.includes(f.topic)) return false;
    if (f.country && !c.countries.includes(f.country)) return false;
    if (q) {
      if (f.masked?.(c.id)) return false;
      const hay = [c.text, ...c.countries, ...c.countries.map(getCountryName), ...c.regions.map((r) => r.name), ...c.topics]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface ClaimCountryGroup {
  /** `null` for Claims about no particular country. */
  code: string | null;
  name: string;
  claims: WorkbenchClaim[];
}

/**
 * Groups Claims by country, by country name, with country-less Claims last.
 * A Claim about several countries (a distinguisher) appears under each, or
 * only under `onlyCountry` when given.
 */
export function groupClaimsByCountry(claims: WorkbenchClaim[], onlyCountry: string | null = null): ClaimCountryGroup[] {
  const byCode = new Map<string, WorkbenchClaim[]>();
  const general: WorkbenchClaim[] = [];
  for (const c of claims) {
    const codes = onlyCountry ? c.countries.filter((code) => code === onlyCountry) : c.countries;
    if (codes.length === 0) general.push(c);
    for (const code of codes) {
      const list = byCode.get(code) ?? [];
      list.push(c);
      byCode.set(code, list);
    }
  }
  const groups: ClaimCountryGroup[] = [...byCode.entries()]
    .map(([code, list]) => ({ code, name: getCountryName(code), claims: list }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (general.length > 0) groups.push({ code: null, name: "General", claims: general });
  return groups;
}

export function countByStatus(claims: WorkbenchClaim[]): Record<ClaimStatus, number> {
  const counts: Record<ClaimStatus, number> = { speculated: 0, verified: 0, disproved: 0, disputed: 0 };
  for (const c of claims) counts[c.status] += 1;
  return counts;
}

/** What a piece of Evidence points at, in words: which Round, which Player, which Source section. */
export function describeEvidence(
  e: WorkbenchEvidence,
  wb: Pick<WorkbenchData, "roundsById" | "gamesById" | "players">,
): string {
  if (e.kind === "round") {
    const round = e.roundId ? wb.roundsById[e.roundId] : null;
    if (!round) return "A Round";
    const game = wb.gamesById[round.gameId];
    const where = [round.countryName ?? round.countryCode, round.regionName].filter(Boolean).join(" / ");
    const when = game ? new Date(game.startedAt).toLocaleDateString() : "";
    return `Round ${round.roundNumber}${when ? ` (${when})` : ""}: ${where || "location"}`;
  }
  if (e.kind === "player") {
    const name = e.playerId ? (wb.players[e.playerId]?.displayName ?? "A Player") : "A Player";
    return `${name} ${e.direction === "for" ? "confirmed" : "rejected"} it`;
  }
  if (!e.source) return "A Source section";
  return `${e.source.title} v${e.source.versionNo} § ${e.source.heading}`;
}
