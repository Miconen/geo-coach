import { isValidIsoCountryCode } from "../countries.js";
import { GAME_MODES, type GameMode } from "../geoguessr.js";
import type { StatsGame, StatsPayload, StatsRound } from "./payload.js";

/**
 * The one filter for the whole statistics page. It narrows Games first, then
 * Rounds; every panel computes on what's left. Player is deliberately not a
 * filter: panels show the Duo and each Player side by side.
 */
export interface StatsFilter {
  /** First local day included, as YYYY-MM-DD. */
  from: string | null;
  /** Last local day included, as YYYY-MM-DD. */
  to: string | null;
  sessionIds: string[];
  mapNames: string[];
  modes: GameMode[];
  opponentRatingMin: number | null;
  opponentRatingMax: number | null;
  countryCodes: string[];
}

export const EMPTY_STATS_FILTER: StatsFilter = {
  from: null,
  to: null,
  sessionIds: [],
  mapNames: [],
  modes: [],
  opponentRatingMin: null,
  opponentRatingMax: null,
  countryCodes: [],
};

const PARAM = {
  from: "from",
  to: "to",
  session: "session",
  map: "map",
  mode: "mode",
  oppMin: "oppMin",
  oppMax: "oppMax",
  country: "country",
} as const;

/** The URL params the filter owns, so callers can clear them before re-serializing. */
export const STATS_FILTER_PARAMS: readonly string[] = Object.values(PARAM);

function parseDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : value;
}

function parseRating(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function parseStatsFilter(params: URLSearchParams): StatsFilter {
  return {
    from: parseDay(params.get(PARAM.from)),
    to: parseDay(params.get(PARAM.to)),
    sessionIds: unique(params.getAll(PARAM.session).filter(Boolean)),
    mapNames: unique(params.getAll(PARAM.map).filter(Boolean)),
    modes: unique(
      params.getAll(PARAM.mode).filter((m): m is GameMode => GAME_MODES.includes(m as GameMode)),
    ),
    opponentRatingMin: parseRating(params.get(PARAM.oppMin)),
    opponentRatingMax: parseRating(params.get(PARAM.oppMax)),
    countryCodes: unique(
      params
        .getAll(PARAM.country)
        .map((c) => c.toUpperCase())
        .filter((c) => c.length === 2 && isValidIsoCountryCode(c)),
    ),
  };
}

/** The filter's URL params only; merge them with page params such as `duo`. */
export function serializeStatsFilter(filter: StatsFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.from) params.set(PARAM.from, filter.from);
  if (filter.to) params.set(PARAM.to, filter.to);
  for (const id of filter.sessionIds) params.append(PARAM.session, id);
  for (const name of filter.mapNames) params.append(PARAM.map, name);
  for (const mode of filter.modes) params.append(PARAM.mode, mode);
  if (filter.opponentRatingMin !== null) params.set(PARAM.oppMin, String(filter.opponentRatingMin));
  if (filter.opponentRatingMax !== null) params.set(PARAM.oppMax, String(filter.opponentRatingMax));
  for (const code of filter.countryCodes) params.append(PARAM.country, code);
  return params;
}

export interface FilteredStats {
  games: StatsGame[];
  rounds: StatsRound[];
}

/** Local midnight starting `day` (YYYY-MM-DD), plus `offsetDays`; DST-safe. */
function localMidnightMs(day: string, offsetDays = 0): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + offsetDays).getTime();
}

function gamePasses(game: StatsGame, filter: StatsFilter): boolean {
  if (filter.from && game.startedAtMs < localMidnightMs(filter.from)) return false;
  if (filter.to && game.startedAtMs >= localMidnightMs(filter.to, 1)) return false;
  if (filter.sessionIds.length > 0 && !filter.sessionIds.includes(game.sessionId ?? "")) {
    return false;
  }
  if (filter.mapNames.length > 0 && !filter.mapNames.includes(game.mapName ?? "")) return false;
  if (filter.modes.length > 0 && (!game.mode || !filter.modes.includes(game.mode))) return false;
  if (filter.opponentRatingMin !== null || filter.opponentRatingMax !== null) {
    const rating = game.opponentRatingBefore;
    if (rating === null) return false;
    if (filter.opponentRatingMin !== null && rating < filter.opponentRatingMin) return false;
    if (filter.opponentRatingMax !== null && rating > filter.opponentRatingMax) return false;
  }
  return true;
}

/**
 * Narrows the payload to what the filter keeps. A Round is kept only if its Game
 * passes the Game-level filters; with a Round-level filter (country), a Game is
 * kept only if at least one of its Rounds is.
 */
export function applyFilter(payload: StatsPayload, filter: StatsFilter): FilteredStats {
  const keptGames = payload.games.filter((g) => gamePasses(g, filter));
  const keptGameIds = new Set(keptGames.map((g) => g.id));
  const rounds = payload.rounds.filter(
    (r) =>
      keptGameIds.has(r.gameId) &&
      (filter.countryCodes.length === 0 ||
        (r.countryCode !== null && filter.countryCodes.includes(r.countryCode))),
  );
  if (filter.countryCodes.length === 0) {
    return { games: keptGames, rounds };
  }
  const gameIdsWithRounds = new Set(rounds.map((r) => r.gameId));
  return { games: keptGames.filter((g) => gameIdsWithRounds.has(g.id)), rounds };
}
