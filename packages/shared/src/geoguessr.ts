import { isPartOfCountry } from "./overseas-regions.js";

export type RoundPhase = "play" | "countdown" | "results";

export interface RoundPhaseInterval {
  phase: RoundPhase;
  startedAt: Date;
  endedAt: Date;
}

/** Where a point is, as an offline geocoder sees it (ADR 0004). */
export interface GeocodedPoint {
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  /** ISO 3166-2 style Region code (GLOSSARY: Region), or null where the country has none. */
  regionCode: string | null;
}

/**
 * Reverse geocodes a point; null when it is in no country (open water). The
 * shared package holds no boundary data: the web server supplies a Natural
 * Earth geocoder, and tests a stub.
 */
export type Geocoder = (lat: number, lng: number) => GeocodedPoint | null;

export interface DerivedGuess {
  geoguessrPlayerId: string;
  playerId: string | null;
  nick: string | null;
  isDuo: boolean;
  /** Where the guess landed, from the geocoder; null for water or a missing pin. */
  countryCode: string | null;
  regionCode: string | null;
  lat: number | null;
  lng: number | null;
  score: number;
  distanceMeters: number | null;
  guessedAt: Date | null;
  guessedFirst: boolean;
  isBestForTeam: boolean;
  /** GLOSSARY: Timed-out guess. Made more than TIMED_OUT_AFTER_ROUND_END_MS after the Round's end. */
  timedOut: boolean;
}

export interface DerivedRound {
  roundNumber: number;
  /** GeoGuessr's own country for the location. */
  countryCode: string | null;
  /** The location's Region, from the geocoder; null when it disagrees on the country. */
  regionCode: string | null;
  lat: number | null;
  lng: number | null;
  panoId: string | null;
  damageMultiplier: number;
  startTime: Date;
  timerStartTime: Date | null;
  endTime: Date;
  resultsEndTime: Date;
  phases: RoundPhaseInterval[];
  duoBestScore: number;
  opponentBestScore: number;
  hpDelta: number;
  guesses: DerivedGuess[];
}

/** The movement rules a Game is played with (GLOSSARY: Mode). */
export type GameMode = "moving" | "nm" | "nmpz";

export const GAME_MODES: readonly GameMode[] = ["moving", "nm", "nmpz"];

export interface DerivedGame {
  geoguessrGameId: string;
  mapName: string | null;
  mode: GameMode | null;
  opponentRatingBefore: number | null;
  startedAt: Date;
  endedAt: Date;
  won: boolean | null;
  duoRatingBefore: number | null;
  duoRatingAfter: number | null;
  duoPositionBefore: number | null;
  duoPositionAfter: number | null;
  winStreak: number | null;
  duoFinalHealth: number | null;
  opponentFinalHealth: number | null;
  opponentTeamName: string | null;
  roundCount: number;
  rounds: DerivedRound[];
}

export const FINAL_ROUND_RESULTS_TAIL_MS = 15_000;

/**
 * A guess stamped this long after the Round's end was submitted by the timer,
 * not pressed (GLOSSARY: Timed-out guess). GeoGuessr stamps those about
 * 1.1–1.6 s after the end; pressed guesses land before it.
 */
export const TIMED_OUT_AFTER_ROUND_END_MS = 1_000;

interface RawGuess {
  roundNumber?: number;
  lat?: number;
  lng?: number;
  distance?: number;
  score?: number;
  created?: string;
}

interface RawTeamPlayer {
  playerId?: string;
  nick?: string;
  guesses?: RawGuess[];
  progressChange?: {
    rankedTeamDuelsProgress?: {
      ratingBefore?: number;
      ratingAfter?: number;
      positionBefore?: number;
      positionAfter?: number;
      winStreak?: number;
    };
  };
}

export interface RawTeam {
  id?: string;
  name?: string;
  health?: number;
  players?: RawTeamPlayer[];
}

interface RawRound {
  roundNumber?: number;
  panorama?: {
    panoId?: string;
    lat?: number;
    lng?: number;
    countryCode?: string;
    /** The starting camera: degrees, and GeoGuessr's zoom level (0 = widest). */
    heading?: number;
    pitch?: number;
    zoom?: number;
  };
  startTime?: string;
  timerStartTime?: string | null;
  endTime?: string;
  damageMultiplier?: number;
}

interface RawMovementOptions {
  forbidMoving?: boolean;
  forbidZooming?: boolean;
  forbidRotating?: boolean;
}

export interface RawDuelPayload {
  gameId?: string;
  status?: string;
  options?: {
    isTeamDuels?: boolean;
    isRated?: boolean;
    map?: { name?: string };
    movementOptions?: RawMovementOptions;
  };
  movementOptions?: RawMovementOptions;
  teams?: RawTeam[];
  rounds?: RawRound[];
  result?: {
    winningTeamId?: string;
    isDraw?: boolean;
  };
}

function parseIsoOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length === 2 ? trimmed : null;
}

function deriveMode(options: RawMovementOptions | undefined): GameMode | null {
  if (!options || typeof options !== "object") return null;
  if (!options.forbidMoving) return "moving";
  return options.forbidZooming && options.forbidRotating ? "nmpz" : "nm";
}

/**
 * The Duo's team within one Game. A duel's `teams[].id` is per Game, while the
 * Duo's ranked `teamId` is its two players' userIds joined by "-", so match on
 * the team's player ids (in either order).
 */
export function findDuoTeam(teams: readonly RawTeam[], duoTeamId: string): RawTeam | undefined {
  const duoPlayerIds = duoTeamId.split("-").sort().join("-");
  return teams.find(
    (t) =>
      t.id === duoTeamId ||
      (t.players ?? [])
        .map((p) => p.playerId ?? "")
        .sort()
        .join("-") === duoPlayerIds,
  );
}

export function isRankedTeamDuel(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const duel = raw as RawDuelPayload;
  return (
    duel.status === "Finished" &&
    duel.options?.isTeamDuels === true &&
    duel.options?.isRated === true
  );
}

/**
 * Pure derivation of Game summary, Rounds, phases, HP deltas, and per-Player guesses
 * from a raw GeoGuessr team-duels JSON payload. GeoGuessr gives guesses only as
 * coordinates and no Regions at all, so `geocoder` places them.
 */
export function deriveGameFromRawDuel(
  raw: unknown,
  duoTeamId: string,
  playerByGeoguessrId: Readonly<Record<string, string>>,
  geocoder: Geocoder,
): DerivedGame {
  const duel = (raw ?? {}) as RawDuelPayload;
  const teams = Array.isArray(duel.teams) ? duel.teams : [];
  const duoTeam =
    findDuoTeam(teams, duoTeamId) ??
    teams.find((t) =>
      (t.players ?? []).some((p) => p.playerId && playerByGeoguessrId[p.playerId]),
    ) ??
    teams[0];
  const oppTeam = teams.find((t) => t !== duoTeam);

  // Extract rating progress from either teammate on duoTeam
  let duoRatingBefore: number | null = null;
  let duoRatingAfter: number | null = null;
  let duoPositionBefore: number | null = null;
  let duoPositionAfter: number | null = null;
  let winStreak: number | null = null;

  for (const player of duoTeam?.players ?? []) {
    const prog = player.progressChange?.rankedTeamDuelsProgress;
    if (prog) {
      duoRatingBefore = prog.ratingBefore ?? duoRatingBefore;
      duoRatingAfter = prog.ratingAfter ?? duoRatingAfter;
      duoPositionBefore = prog.positionBefore ?? duoPositionBefore;
      duoPositionAfter = prog.positionAfter ?? duoPositionAfter;
      winStreak = prog.winStreak ?? winStreak;
      break;
    }
  }

  let opponentRatingBefore: number | null = null;
  for (const player of oppTeam?.players ?? []) {
    const before = player.progressChange?.rankedTeamDuelsProgress?.ratingBefore;
    if (typeof before === "number") {
      opponentRatingBefore = before;
      break;
    }
  }

  const winningTeamId = duel.result?.winningTeamId;
  let won: boolean | null = null;
  if (winningTeamId && duoTeam?.id) {
    won = winningTeamId === duoTeam.id;
  } else if (duoTeam?.health !== undefined && oppTeam?.health !== undefined) {
    won = duoTeam.health > oppTeam.health;
  }

  const rawRounds = [...(Array.isArray(duel.rounds) ? duel.rounds : [])].sort(
    (a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0),
  );

  // Index guesses by roundNumber
  const guessesByRound = new Map<number, DerivedGuess[]>();
  for (const team of teams) {
    const isDuo = team === duoTeam;
    for (const player of team.players ?? []) {
      const ggPlayerId = player.playerId ?? "unknown";
      const mappedPlayerId = isDuo ? (playerByGeoguessrId[ggPlayerId] ?? null) : null;
      for (const g of player.guesses ?? []) {
        if (typeof g.roundNumber !== "number") continue;
        const lat = typeof g.lat === "number" ? g.lat : null;
        const lng = typeof g.lng === "number" ? g.lng : null;
        const place = lat !== null && lng !== null ? geocoder(lat, lng) : null;
        const list = guessesByRound.get(g.roundNumber) ?? [];
        list.push({
          geoguessrPlayerId: ggPlayerId,
          playerId: mappedPlayerId,
          nick: player.nick ?? null,
          isDuo,
          countryCode: place?.countryCode ?? null,
          regionCode: place?.regionCode ?? null,
          lat,
          lng,
          score: typeof g.score === "number" ? g.score : 0,
          distanceMeters: typeof g.distance === "number" ? g.distance : null,
          guessedAt: parseIsoOrNull(g.created),
          guessedFirst: false,
          isBestForTeam: false,
          timedOut: false,
        });
        guessesByRound.set(g.roundNumber, list);
      }
    }
  }

  const derivedRounds: DerivedRound[] = rawRounds.map((r, index) => {
    const roundNumber = r.roundNumber ?? index + 1;
    const startTime = parseIsoOrNull(r.startTime) ?? new Date(0);
    const endTime = parseIsoOrNull(r.endTime) ?? startTime;
    const timerStartTime = parseIsoOrNull(r.timerStartTime);
    const nextRaw = rawRounds[index + 1];
    const nextStartTime = parseIsoOrNull(nextRaw?.startTime);
    const resultsEndTime =
      nextStartTime && nextStartTime.getTime() >= endTime.getTime()
        ? nextStartTime
        : new Date(endTime.getTime() + FINAL_ROUND_RESULTS_TAIL_MS);

    const phases: RoundPhaseInterval[] = [];
    if (
      timerStartTime &&
      timerStartTime.getTime() >= startTime.getTime() &&
      timerStartTime.getTime() <= endTime.getTime()
    ) {
      phases.push({ phase: "play", startedAt: startTime, endedAt: timerStartTime });
      phases.push({ phase: "countdown", startedAt: timerStartTime, endedAt: endTime });
    } else {
      phases.push({ phase: "play", startedAt: startTime, endedAt: endTime });
    }
    phases.push({ phase: "results", startedAt: endTime, endedAt: resultsEndTime });

    const guesses = guessesByRound.get(roundNumber) ?? [];
    for (const g of guesses) {
      g.timedOut =
        g.guessedAt !== null &&
        g.guessedAt.getTime() - endTime.getTime() > TIMED_OUT_AFTER_ROUND_END_MS;
    }
    // Identify earliest guess across all players
    let earliestMs = Number.POSITIVE_INFINITY;
    for (const g of guesses) {
      const ms = g.guessedAt?.getTime();
      if (ms !== undefined && ms < earliestMs) {
        earliestMs = ms;
      }
    }
    if (Number.isFinite(earliestMs)) {
      for (const g of guesses) {
        if (g.guessedAt?.getTime() === earliestMs) {
          g.guessedFirst = true;
        }
      }
    }

    const duoGuesses = guesses.filter((g) => g.isDuo);
    const oppGuesses = guesses.filter((g) => !g.isDuo);
    const duoBestScore = duoGuesses.reduce((max, g) => Math.max(max, g.score), 0);
    const opponentBestScore = oppGuesses.reduce((max, g) => Math.max(max, g.score), 0);

    let duoBestMarked = false;
    for (const g of duoGuesses) {
      if (!duoBestMarked && g.score === duoBestScore) {
        g.isBestForTeam = true;
        duoBestMarked = true;
      }
    }
    let oppBestMarked = false;
    for (const g of oppGuesses) {
      if (!oppBestMarked && g.score === opponentBestScore) {
        g.isBestForTeam = true;
        oppBestMarked = true;
      }
    }

    const damageMultiplier = typeof r.damageMultiplier === "number" ? r.damageMultiplier : 1;
    const hpDelta = Math.round((duoBestScore - opponentBestScore) * damageMultiplier);

    const countryCode = normalizeCountryCode(r.panorama?.countryCode);
    const lat = typeof r.panorama?.lat === "number" ? r.panorama.lat : null;
    const lng = typeof r.panorama?.lng === "number" ? r.panorama.lng : null;
    const place = lat !== null && lng !== null ? geocoder(lat, lng) : null;
    // The country is GeoGuessr's; a Region from a geocoder that disagrees on
    // the country would belong to another country. An overseas Region the
    // geocoder keeps as its own unit (GeoGuessr's FR is its GF) still counts.
    const regionCode =
      place && (countryCode === null || isPartOfCountry(place.countryCode, countryCode))
        ? place.regionCode
        : null;

    return {
      roundNumber,
      countryCode,
      regionCode,
      lat,
      lng,
      panoId: r.panorama?.panoId ?? null,
      damageMultiplier,
      startTime,
      timerStartTime,
      endTime,
      resultsEndTime,
      phases,
      duoBestScore,
      opponentBestScore,
      hpDelta,
      guesses,
    };
  });

  const startedAt = derivedRounds[0]?.startTime ?? new Date(0);
  const endedAt = derivedRounds[derivedRounds.length - 1]?.resultsEndTime ?? startedAt;

  return {
    geoguessrGameId: duel.gameId ?? "",
    mapName: typeof duel.options?.map?.name === "string" ? duel.options.map.name : null,
    mode: deriveMode(duel.options?.movementOptions ?? duel.movementOptions),
    opponentRatingBefore,
    startedAt,
    endedAt,
    won,
    duoRatingBefore,
    duoRatingAfter,
    duoPositionBefore,
    duoPositionAfter,
    winStreak,
    duoFinalHealth: typeof duoTeam?.health === "number" ? duoTeam.health : null,
    opponentFinalHealth: typeof oppTeam?.health === "number" ? oppTeam.health : null,
    opponentTeamName: oppTeam?.name ?? null,
    roundCount: derivedRounds.length,
    rounds: derivedRounds,
  };
}
