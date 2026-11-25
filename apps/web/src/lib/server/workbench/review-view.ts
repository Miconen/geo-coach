import type { WorkbenchData, WorkbenchRound, WorkbenchUtterance } from "./view-model.js";

/**
 * Review's payload: the derivation without the Duo's speech. Rounds keep their scalar fields (titles, links, the manual
 * Learning picker) but ship with empty guesses, phases and utteranceIds; the only utterances shipped are those a
 * Learning cites. Round cards fetch their full Rounds and speech on demand through reviewRounds.
 */
export function reviewView(wb: WorkbenchData): WorkbenchData {
  const utterancesById: Record<string, WorkbenchUtterance> = {};
  for (const l of wb.learnings) {
    for (const id of l.utteranceIds) {
      const u = wb.utterancesById[id];
      if (u) utterancesById[id] = u;
    }
  }
  const roundsById: Record<string, WorkbenchRound> = {};
  for (const [id, r] of Object.entries(wb.roundsById)) roundsById[id] = { ...r, guesses: [], phases: [], utteranceIds: [] };
  return { ...wb, utterances: [], utterancesById, roundsById };
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
