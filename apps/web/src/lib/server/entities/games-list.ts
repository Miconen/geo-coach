import type { MapRound } from "$lib/map/scene.js";
import { gameNumbers, homeSessionId, playDay } from "$lib/game-number.js";
import { links } from "$lib/links.js";
import type { WorkbenchData } from "$lib/server/workbench/view-model.js";

// The Games list (#81): one compact row per Game, grouped under its Session (or, with no one recording, the day it
// was played), newest group first, plus every listed Game's Rounds for the shared map. Built from the cited-speech
// workbench, so it shares the Game page's cache entry (#72).

export interface GamesListRow {
  id: string;
  /** "Game N": play order inside the group, as on the Session page. */
  number: number;
  won: boolean | null;
  ratingDelta: number | null;
  rounds: number;
  /** Current Learnings tied to the Game's Rounds. */
  learnings: number;
  href: string;
}

export interface GamesListGroup {
  /** The Session's id, or `day:YYYY-MM-DD` for Games no one recorded. */
  key: string;
  sessionId: string | null;
  /** The Session's start, or the day's first Game's. */
  startedAt: string;
  href: string | null;
  won: number;
  lost: number;
  ratingDelta: number;
  games: GamesListRow[];
}

export interface GamesList {
  groups: GamesListGroup[];
  gameCount: number;
  sessionCount: number;
  /** Day groups: Games played with no one recording. */
  unrecordedDays: number;
  rounds: MapRound[];
  /** Each map Round's page, for a click on its answer pin. */
  roundHrefs: Record<string, string>;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString("en-US")}` : n < 0 ? `−${(-n).toLocaleString("en-US")}` : "0");

export function buildGamesList(
  wb: Pick<WorkbenchData, "gamesById" | "roundsById" | "sessions" | "learnings" | "players">,
  duoId: string,
  timeZone?: string,
): GamesList {
  const games = Object.values(wb.gamesById);
  const numbers = gameNumbers(games, wb.sessions, timeZone);
  const sessionsById = new Map(wb.sessions.map((s) => [s.id, s]));
  const sessionIds = new Set(sessionsById.keys());
  const current = wb.learnings.filter((l) => l.status === "current");

  const groups = new Map<string, GamesListGroup>();
  const rounds: MapRound[] = [];
  const roundHrefs: Record<string, string> = {};
  const byPlay = [...games].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
  for (const g of byPlay) {
    const sid = homeSessionId(g, sessionIds);
    const session = sid ? sessionsById.get(sid)! : null;
    const key = session ? session.id : `day:${playDay(g.startedAt, timeZone)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sessionId: session?.id ?? null,
        startedAt: session?.startedAt ?? g.startedAt,
        href: session ? links.session(duoId, session.id) : null,
        won: 0,
        lost: 0,
        // A Session's delta is the ADR 0008 one; a day's is summed below.
        ratingDelta: session?.ratingDelta ?? 0,
        games: [],
      };
      groups.set(key, group);
    }
    if (g.won === true) group.won += 1;
    if (g.won === false) group.lost += 1;
    if (!session) group.ratingDelta += g.ratingDelta ?? 0;

    const number = numbers.get(g.id) ?? group.games.length + 1;
    const gameRounds = g.roundIds
      .flatMap((id) => (wb.roundsById[id] ? [wb.roundsById[id]!] : []))
      .filter((r) => r.roundNumber > 0)
      .sort((a, b) => a.roundNumber - b.roundNumber);
    const roundIds = new Set(gameRounds.map((r) => r.id));
    for (const r of gameRounds) {
      if (r.lat === null || r.lng === null) continue;
      const won = r.hpDelta >= 0;
      const href = links.round(duoId, g.id, r.roundNumber);
      if (href) roundHrefs[r.id] = href;
      rounds.push({
        id: r.id,
        gameId: g.id,
        label: `R${r.roundNumber}`,
        title: `Game ${number} · Round ${r.roundNumber}`,
        detail: `${r.countryName ?? "Unknown"} · ${won ? "won" : "lost"} · ${signed(r.hpDelta)}`,
        lat: r.lat,
        lng: r.lng,
        countryCode: r.countryCode,
        won,
        guesses: r.guesses.flatMap((x) => {
          if (x.lat === null || x.lng === null) return [];
          const player = x.playerId ? wb.players[x.playerId] : undefined;
          return [
            {
              lat: x.lat,
              lng: x.lng,
              countryCode: x.countryCode,
              isDuo: x.isDuo,
              playerId: x.playerId,
              color: player?.avatarColor,
              initial: player?.displayName.slice(0, 1).toUpperCase(),
              score: x.score,
              distanceMeters: x.distanceMeters,
            },
          ];
        }),
      });
    }
    group.games.push({
      id: g.id,
      number,
      won: g.won,
      ratingDelta: g.ratingDelta,
      rounds: gameRounds.length,
      learnings: current.filter((l) => l.roundIds.some((id) => roundIds.has(id))).length,
      href: links.game(duoId, g.id),
    });
  }

  const list = [...groups.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return {
    groups: list,
    gameCount: games.length,
    sessionCount: list.filter((x) => x.sessionId).length,
    unrecordedDays: list.filter((x) => !x.sessionId).length,
    rounds,
    roundHrefs,
  };
}
