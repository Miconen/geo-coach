import type { WorkbenchClaim, WorkbenchData, WorkbenchRound, WorkbenchUtterance } from "./view-model.js";

/** Review's payload: `claims` ships empty (a Country's come through reviewCountryClaims); claimCount counts them all. */
export type ReviewData = WorkbenchData & { claimCount: number };

/**
 * Review's payload: the derivation without the Duo's speech or its Claim bank. Rounds keep their scalar fields (titles,
 * links, the manual Learning picker) but ship with empty guesses, phases and utteranceIds; the only utterances shipped
 * are those a Learning cites, and the only Claims those a Learning rests on. Round cards fetch their full Rounds and
 * speech on demand through reviewRounds.
 */
export function reviewView(wb: WorkbenchData): ReviewData {
  const utterancesById: Record<string, WorkbenchUtterance> = {};
  const claimsById: Record<string, WorkbenchClaim> = {};
  for (const l of wb.learnings) {
    for (const id of l.utteranceIds) {
      const u = wb.utterancesById[id];
      if (u) utterancesById[id] = u;
    }
    const claim = l.claimId ? wb.claimsById[l.claimId] : undefined;
    if (claim) claimsById[claim.id] = claim;
  }
  const roundsById: Record<string, WorkbenchRound> = {};
  for (const [id, r] of Object.entries(wb.roundsById)) roundsById[id] = { ...r, guesses: [], phases: [], utteranceIds: [] };
  return { ...wb, utterances: [], utterancesById, roundsById, claims: [], claimsById, claimCount: wb.claims.length };
}

/** The Claims tagged with a Country (upper-case ISO code), for Review's Country dossier. */
export function reviewCountryClaims(wb: WorkbenchData, country: string): WorkbenchClaim[] {
  return wb.claims.filter((c) => c.countries.includes(country));
}

export interface ReviewRounds {
  roundsById: Record<string, WorkbenchRound>;
  utterancesById: Record<string, WorkbenchUtterance>;
}

/** Full Rounds of this Duo's derivation with their speech; unknown ids are skipped. */
export function reviewRounds(wb: WorkbenchData, roundIds: string[]): ReviewRounds {
  const out: ReviewRounds = { roundsById: {}, utterancesById: {} };
  for (const id of roundIds) {
    const r = wb.roundsById[id];
    if (!r) continue;
    out.roundsById[id] = r;
    for (const uId of r.utteranceIds) {
      const u = wb.utterancesById[uId];
      if (u) out.utterancesById[uId] = u;
    }
  }
  return out;
}
