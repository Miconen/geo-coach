import {
  getCountryName,
  regionName,
  roundGameState,
  slowerDuoGuess,
  type GameMode,
  type PanoView,
  type StatsGuess,
  type StatsRound,
} from "@geo-coach/shared";
import type { Debrief, DebriefGame, DebriefGuess, DebriefLine, DebriefPlayer, DebriefRound } from "$lib/debrief/types.js";
import { namesCountry } from "../country-mentions.js";
import type { WorkbenchData, WorkbenchLearning, WorkbenchRound } from "../workbench/view-model.js";

/** What a Game adds beyond the workbench: its mode and map, and each Round's starting camera (from the raw duel). */
export interface DebriefGameMeta {
  mode: GameMode | null;
  mapName: string | null;
  panoViews: ReadonlyMap<number, PanoView>;
}

export interface DebriefInput {
  wb: Pick<WorkbenchData, "players" | "gamesById" | "roundsById" | "utterancesById" | "learnings">;
  /** The Games to show, each with its "Game N" ($lib/game-number.ts). */
  games: ReadonlyArray<{ id: string; number: number }>;
  meta: ReadonlyMap<string, DebriefGameMeta>;
  /** The Session shown, for its Learnings that cite no Round; null for a Game with no Session. */
  sessionId: string | null;
}

const ms = (iso: string | Date) => new Date(iso).getTime();

/** The workbench Round as the Stats shape, so the Stats helpers (HP, slower guess) apply unchanged. */
function asStatsRound(r: WorkbenchRound, panoView: PanoView | null): StatsRound {
  const start = ms(r.startTime);
  return {
    id: r.id,
    gameId: r.gameId,
    roundNumber: r.roundNumber,
    startedAtMs: start,
    countryCode: r.countryCode,
    regionCode: r.regionCode,
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    panoView,
    damageMultiplier: r.damageMultiplier,
    hpDelta: r.hpDelta,
    duoBestScore: r.duoBestScore,
    opponentBestScore: r.opponentBestScore,
    guesses: r.guesses.map((g) => {
      const at = g.guessedAt ? ms(g.guessedAt) : null;
      return {
        playerId: g.isDuo ? g.playerId : null,
        isDuo: g.isDuo,
        lat: g.lat,
        lng: g.lng,
        countryCode: g.countryCode ?? null,
        regionCode: g.regionCode ?? null,
        distanceMeters: g.distanceMeters,
        score: g.score,
        guessedFirst: g.guessedFirst,
        isBestForTeam: g.isBestForTeam,
        timedOut: g.timedOut ?? false,
        secondsToGuess: at !== null && !Number.isNaN(at) ? (at - start) / 1000 : null,
      };
    }),
    call: null,
  };
}

function debriefPlayers(wb: DebriefInput["wb"]): Record<string, DebriefPlayer> {
  return Object.fromEntries(
    Object.values(wb.players).map((p) => [
      p.id,
      { id: p.id, name: p.displayName, color: p.avatarColor, initial: (p.displayName.trim().charAt(0) || "?").toUpperCase() },
    ]),
  );
}

/**
 * The debrief view's data (#79) for a set of Games: each Round with its scores, guess times, HP before and after,
 * mode and map, transcript (whatever speech `wb` holds for it), and the current Learnings that cite it. Pure.
 */
export function buildDebrief(input: DebriefInput): Debrief {
  const { wb, meta } = input;
  const current = wb.learnings.filter((l) => l.status === "current");
  const learnings: Record<string, WorkbenchLearning> = {};
  const cited = new Set<string>();
  const games: DebriefGame[] = [];
  const rounds: DebriefRound[] = [];

  for (const { id, number } of [...input.games].sort((a, b) => a.number - b.number)) {
    const g = wb.gamesById[id];
    if (!g) continue;
    const m = meta.get(id);
    const all = g.roundIds.flatMap((rid) => (wb.roundsById[rid] ? [wb.roundsById[rid]!] : []));
    const stats = all.map((r) => asStatsRound(r, m?.panoViews.get(r.roundNumber) ?? null));
    const shown = stats.filter((s) => s.roundNumber > 0).sort((a, b) => a.roundNumber - b.roundNumber);
    const gameRounds: DebriefRound[] = shown.map((s) => {
      const r = wb.roundsById[s.id]!;
      const own = current.filter((l) => l.roundIds.includes(r.id));
      for (const l of own) {
        learnings[l.id] = l;
        cited.add(l.id);
      }
      return debriefRound(r, s, stats, number, shown.length, m, own, wb.utterancesById);
    });
    rounds.push(...gameRounds);
    games.push({
      id,
      number,
      won: g.won,
      ratingDelta: g.ratingDelta,
      startedAt: g.startedAt,
      roundIds: gameRounds.map((r) => r.id),
      learningCount: new Set(gameRounds.flatMap((r) => r.learningIds)).size,
    });
  }

  const sessionLearningIds: string[] = [];
  if (input.sessionId) {
    for (const l of current) {
      if (!l.sessionIds.includes(input.sessionId) || cited.has(l.id)) continue;
      learnings[l.id] = l;
      sessionLearningIds.push(l.id);
    }
  }
  return { players: debriefPlayers(wb), games, rounds, learnings, sessionLearningIds, recorded: input.sessionId !== null };
}

function debriefRound(
  r: WorkbenchRound,
  s: StatsRound,
  gameStats: readonly StatsRound[],
  gameNumber: number,
  roundCount: number,
  m: DebriefGameMeta | undefined,
  own: WorkbenchLearning[],
  utterancesById: WorkbenchData["utterancesById"],
): DebriefRound {
  const state = roundGameState(gameStats, s);
  const slower = slowerDuoGuess(s);
  const order = (g: StatsGuess) => (g.isDuo ? 0 : 1);
  const guesses: DebriefGuess[] = [...s.guesses]
    .sort((a, b) => order(a) - order(b) || b.score - a.score)
    .map((g) => ({
      playerId: g.playerId,
      isDuo: g.isDuo,
      lat: g.lat,
      lng: g.lng,
      countryCode: g.countryCode,
      distanceMeters: g.distanceMeters,
      score: g.score,
      secondsToGuess: g.secondsToGuess,
      timedOut: g.timedOut,
      guessedFirst: g.guessedFirst,
      isBestForTeam: g.isBestForTeam,
      slower: slower === g,
    }));
  const best = guesses.find((g) => g.isDuo) ?? null;
  const start = ms(r.startTime);
  const end = ms(r.endTime);
  const transcript: DebriefLine[] = r.utteranceIds
    .flatMap((id) => {
      const u = utterancesById[id];
      if (!u || u.historical) return [];
      const at = ms(u.startedAt);
      return [{ id, playerId: u.playerId, text: u.text, atS: (at - start) / 1000, afterEnd: at >= end }];
    })
    .sort((a, b) => a.atS - b.atS);
  const missedAnswer = r.countryCode !== null && !guesses.some((g) => g.isDuo && g.countryCode === r.countryCode);
  return {
    id: r.id,
    gameId: r.gameId,
    gameNumber,
    roundNumber: r.roundNumber,
    roundCount,
    countryCode: r.countryCode,
    countryName: r.countryName ?? (r.countryCode ? getCountryName(r.countryCode) : null),
    regionName: r.regionName ?? regionName(r.regionCode),
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    panoView: s.panoView,
    won: r.duoBestScore >= r.opponentBestScore,
    hpDelta: r.hpDelta,
    damageMultiplier: r.damageMultiplier,
    duoBestScore: r.duoBestScore,
    opponentBestScore: r.opponentBestScore,
    hpBefore: state.before,
    hpAfter: state.after,
    mode: m?.mode ?? null,
    mapName: m?.mapName ?? null,
    guesses,
    bestCountry: best?.countryCode ?? null,
    bestKm: best?.distanceMeters != null ? Math.round(best.distanceMeters / 1000) : null,
    wrongCountry: best !== null && best.countryCode !== r.countryCode,
    missedAnswer,
    learningIds: own.map((l) => l.id),
    transcript,
    endS: (end - start) / 1000,
    countdownS: r.timerStartTime ? (ms(r.timerStartTime) - start) / 1000 : null,
    saidAloud: missedAnswer ? saidAloud(transcript, r.countryCode!) : [],
  };
}

/**
 * The Utterances that named the answer country while guessing was still on (#80). Speech after guessing ends is a
 * reaction to the reveal, so it never counts.
 */
export function saidAloud(transcript: readonly DebriefLine[], answerCode: string): DebriefLine[] {
  return transcript.filter((l) => !l.afterEnd && namesCountry(l.text, answerCode));
}
