/** Page titles and chip labels for entities (UTC dates, so server and browser render the same text). */

const day = (iso: string) => iso.slice(0, 10);
const minute = (iso: string) => iso.slice(11, 16);

export function gameTitle(g: { opponentTeamName: string | null; startedAt: string }): string {
  return `vs ${g.opponentTeamName ?? "Opponents"} · ${day(g.startedAt)}`;
}

export function sessionTitle(s: { startedAt: string }): string {
  return `Session ${day(s.startedAt)} ${minute(s.startedAt)}`;
}

/** X7: every stored Round number renders; only positive ones link. */
export function roundLabel(r: { roundNumber: number; countryCode?: string | null }): string {
  return `Round ${r.roundNumber}${r.countryCode ? ` · ${r.countryCode}` : ""}`;
}
