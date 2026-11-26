import type { LearningKind } from "@geo-coach/shared";
import { gameNumbers } from "$lib/game-number.js";
import type { MapRound } from "$lib/map/scene.js";
import { links } from "$lib/links.js";
import { formatSigned } from "$lib/stats/overview-text.js";
import type { WorkbenchData, WorkbenchGame, WorkbenchRound } from "./workbench/view-model.js";

// Duo Home (#84): lookup first. Everything the page shows, built from the cited-speech workbench (so it shares
// the Games list's cache entry, #72): the latest Session card, open Study items, recent mistakes by answer
// country, the rating after each Game, a dossier per country played, and the map Rounds they refer to.

/** "Wrong lately" covers the last this-many days of play, counted back from the newest Game. */
export const RECENT_DAYS = 30;

export interface HomeLatest {
  id: string;
  startedAt: string;
  href: string;
  won: number;
  lost: number;
  ratingDelta: number;
  rounds: number;
  learnings: number;
  /** Answer countries the Duo missed in this Session, most missed first. */
  missed: Array<{ code: string; name: string; count: number }>;
}

export interface HomeMistake {
  code: string;
  name: string;
  count: number;
  lastAt: string;
  /** Where the Duo's best guess went instead, most common first. */
  guessedInstead: Array<{ code: string; count: number }>;
  learnings: number;
  roundIds: string[];
}

export interface HomeStudy {
  id: string;
  text: string;
  countries: string[];
  href: string;
}

export interface HomeDossier {
  code: string;
  name: string;
  roundsPlayed: number;
  missCount: number;
  avgScore: number | null;
  netHpDelta: number;
  claimCount: number;
  learnings: Array<{ id: string; kind: LearningKind; text: string }>;
  /** Every Round played there, and the ones the Duo missed (the map focuses only those). */
  roundIds: string[];
  missedRoundIds: string[];
  reviewHref: string;
}

export interface Home {
  latest: HomeLatest | null;
  study: HomeStudy[];
  /** Most missed first, then the most recent. */
  mistakes: HomeMistake[];
  /** Rating after each Game, oldest first. */
  rating: Array<{ at: string; rating: number }>;
  /** The countries the Duo has played, most played first. */
  dossiers: HomeDossier[];
  rounds: MapRound[];
}

const DAY_MS = 86_400_000;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Neither Duo guess landed in the answer country. */
export const missedAnswer = (r: Pick<WorkbenchRound, "countryCode" | "guesses">) =>
  r.countryCode !== null && !r.guesses.some((g) => g.isDuo && g.countryCode === r.countryCode);

/** `timeZone` groups unrecorded Games by day for "Game N", as the Games list does (#81). */
export function buildHome(wb: WorkbenchData, duoId: string, timeZone?: string): Home {
  const current = wb.learnings.filter((l) => l.status === "current" && !l.dismissed);
  const games = Object.values(wb.gamesById).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const numbers = gameNumbers(games, wb.sessions, timeZone);
  const roundsOf = (g: WorkbenchGame) =>
    g.roundIds
      .flatMap((id) => (wb.roundsById[id] ? [wb.roundsById[id]!] : []))
      .filter((r) => r.roundNumber > 0)
      .sort((a, b) => a.roundNumber - b.roundNumber);
  const initial = (playerId: string | null) => (playerId ? (wb.players[playerId]?.displayName.trim()[0]?.toUpperCase() ?? "?") : "?");

  const rounds = new Map<string, MapRound>();
  for (const g of games) {
    for (const r of roundsOf(g)) {
      if (r.lat === null || r.lng === null) continue;
      const won = r.duoBestScore >= r.opponentBestScore;
      rounds.set(r.id, {
        id: r.id,
        gameId: g.id,
        label: `R${r.roundNumber}`,
        title: `${shortDate(g.startedAt)} · Game ${numbers.get(g.id)} · Round ${r.roundNumber}`,
        detail: `${r.countryName ?? "?"} · ${won ? "won" : "lost"} · ${formatSigned(r.hpDelta)}`,
        lat: r.lat,
        lng: r.lng,
        countryCode: r.countryCode,
        won,
        guesses: r.guesses.flatMap((x) =>
          x.lat !== null && x.lng !== null
            ? [
                {
                  lat: x.lat,
                  lng: x.lng,
                  countryCode: x.countryCode,
                  isDuo: x.isDuo,
                  playerId: x.playerId,
                  color: x.isDuo && x.playerId ? wb.players[x.playerId]?.avatarColor : undefined,
                  initial: x.isDuo ? initial(x.playerId) : undefined,
                  score: x.score,
                  distanceMeters: x.distanceMeters,
                },
              ]
            : [],
        ),
        learningCountries: [...new Set(current.filter((l) => l.roundIds.includes(r.id)).flatMap((l) => l.countries))],
      });
    }
  }

  // The latest Session: the evening in one glance.
  const s = [...wb.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  let latest: HomeLatest | null = null;
  if (s) {
    const sg = s.gameIds.flatMap((id) => (wb.gamesById[id] ? [wb.gamesById[id]!] : []));
    const missed = new Map<string, { code: string; name: string; count: number }>();
    const sr = sg.flatMap(roundsOf);
    for (const r of sr) {
      if (!missedAnswer(r)) continue;
      const m = missed.get(r.countryCode!) ?? { code: r.countryCode!, name: r.countryName ?? r.countryCode!, count: 0 };
      m.count += 1;
      missed.set(m.code, m);
    }
    latest = {
      id: s.id,
      startedAt: s.startedAt,
      href: links.session(duoId, s.id),
      won: sg.filter((g) => g.won === true).length,
      lost: sg.filter((g) => g.won === false).length,
      ratingDelta: s.ratingDelta,
      rounds: sr.length,
      learnings: current.filter((l) => l.sessionIds.includes(s.id)).length,
      missed: [...missed.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }

  // Wrong lately: Rounds of the last RECENT_DAYS days of play where neither Duo guess hit the answer country.
  const newest = games.at(-1)?.startedAt;
  const from = newest ? new Date(Date.parse(newest) - RECENT_DAYS * DAY_MS).toISOString() : null;
  const mistakes = new Map<string, HomeMistake>();
  for (const g of games) {
    if (!from || g.startedAt < from) continue;
    for (const r of roundsOf(g)) {
      if (!missedAnswer(r)) continue;
      const code = r.countryCode!;
      const m = mistakes.get(code) ?? { code, name: r.countryName ?? code, count: 0, lastAt: r.startTime, guessedInstead: [], learnings: 0, roundIds: [] };
      m.count += 1;
      if (r.startTime > m.lastAt) m.lastAt = r.startTime;
      m.roundIds.push(r.id);
      const best = r.guesses.filter((x) => x.isDuo).sort((a, b) => b.score - a.score)[0];
      if (best?.countryCode) {
        const gi = m.guessedInstead.find((x) => x.code === best.countryCode);
        if (gi) gi.count += 1;
        else m.guessedInstead.push({ code: best.countryCode, count: 1 });
      }
      mistakes.set(code, m);
    }
  }
  for (const m of mistakes.values()) {
    m.guessedInstead.sort((a, b) => b.count - a.count);
    m.learnings = current.filter((l) => l.countries.includes(m.code)).length;
  }

  const study = current
    .filter((l) => l.kind === "study" && !l.done)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => ({ id: l.id, text: l.text, countries: l.countries, href: links.review(duoId, { learning: l.id }) }));

  const dossiers: HomeDossier[] = wb.countryDossiers
    .filter((d) => d.roundsPlayed > 0)
    .map((d) => {
      const roundIds = d.roundIds.filter((id) => rounds.has(id));
      return {
        code: d.code,
        name: d.name,
        roundsPlayed: d.roundsPlayed,
        missCount: d.missCount,
        avgScore: d.avgScore,
        netHpDelta: d.netHpDelta,
        claimCount: d.claimCount,
        learnings: current.filter((l) => l.countries.includes(d.code)).map((l) => ({ id: l.id, kind: l.kind, text: l.text })),
        roundIds,
        missedRoundIds: roundIds.filter((id) => wb.roundsById[id] && missedAnswer(wb.roundsById[id]!)),
        reviewHref: links.review(duoId, { country: d.code }),
      };
    })
    .sort((a, b) => b.roundsPlayed - a.roundsPlayed || a.name.localeCompare(b.name));

  return {
    latest,
    study,
    mistakes: [...mistakes.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)),
    rating: games.flatMap((g) => (g.duoRatingAfter !== null ? [{ at: g.startedAt, rating: g.duoRatingAfter }] : [])),
    dossiers,
    rounds: [...rounds.values()],
  };
}

