// "Game N" (#81): one numbering for the Games list, the Session page and the Game and Round pages. A Game is
// numbered in play order inside its home Session: the one its rating change counts toward (ADR 0008), so a Game
// two Sessions share sits under one of them. A Game no Session overlaps (no one recorded) is numbered inside the
// day it was played instead.

export interface NumberedGame {
  id: string;
  startedAt: string;
  /** Every Session the Game was played in. */
  sessionIds: readonly string[];
  /** The Session its rating change counts toward (ADR 0008). */
  ratingSessionId: string | null;
}

export interface NumberingSession {
  id: string;
  /** Every Game played in the Session, the shared ones included. */
  gameIds: readonly string[];
}

/** Play order: start time, then id, so two Games starting together keep one order everywhere. */
const byPlay = (a: { id: string; startedAt: string }, b: { id: string; startedAt: string }) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id);

/** "Game N" for a set of Games played together (one Session's, or one day's): 1 for the first played. */
export function numberInPlayOrder(games: readonly { id: string; startedAt: string }[]): Map<string, number> {
  return new Map([...games].sort(byPlay).map((g, i) => [g.id, i + 1]));
}

/** The calendar day ("2026-11-21") an unrecorded Game groups under, in the given time zone (default: local). */
export function playDay(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

/** The Session a Game is listed and numbered under, or null when no listed Session holds it. */
export function homeSessionId(game: NumberedGame, sessionIds: ReadonlySet<string>): string | null {
  if (game.ratingSessionId && sessionIds.has(game.ratingSessionId)) return game.ratingSessionId;
  return game.sessionIds.find((id) => sessionIds.has(id)) ?? null;
}

/**
 * "Game N" for every Game: its position in its home Session's play order (counting every Game of that Session,
 * so the number matches the Session page), or in its day's play order among the unrecorded Games.
 */
export function gameNumbers(
  games: readonly NumberedGame[],
  sessions: readonly NumberingSession[],
  timeZone?: string,
): Map<string, number> {
  const byId = new Map(games.map((g) => [g.id, g]));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const numbers = new Map<string, number>();
  const unrecorded = new Map<string, NumberedGame[]>();
  for (const g of games) {
    if (homeSessionId(g, sessionIds) !== null) continue;
    const day = playDay(g.startedAt, timeZone);
    unrecorded.set(day, [...(unrecorded.get(day) ?? []), g]);
  }
  for (const s of sessions) {
    const inSession = numberInPlayOrder(s.gameIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
    for (const [id, n] of inSession) if (homeSessionId(byId.get(id)!, sessionIds) === s.id) numbers.set(id, n);
  }
  for (const day of unrecorded.values()) for (const [id, n] of numberInPlayOrder(day)) numbers.set(id, n);
  return numbers;
}
