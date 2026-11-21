import { isRankedTeamDuel, type RawDuelPayload } from "@geo-coach/shared";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReplayCandidate {
  geoguessrGameId: string;
  geoguessrPlayerId: string;
  roundNumber: number;
}

export interface GeoguessrPollerDeps {
  delayBetweenRequestsMs?: number;
  maxFeedPages?: number;
  fetchGeoguessr: (url: string, ncfaCookie: string) => Promise<Response>;
  checkMissing: (
    gameIds: string[],
    replayCandidates: ReplayCandidate[],
    includeStoredReplayBackfill?: boolean,
  ) => Promise<{
    missingGameIds: string[];
    missingReplays: ReplayCandidate[];
  }>;
  uploadGame: (gameId: string, rawDuel: Record<string, unknown>) => Promise<void>;
  uploadReplay: (
    gameId: string,
    playerId: string,
    roundNumber: number,
    rawEvents: unknown[],
  ) => Promise<void>;
}

export interface SyncSummary {
  authPaused: boolean;
  gamesUploaded: number;
  replaysUploaded: number;
  warning: string | null;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTeamDuelIdsFromFeed(feedJson: unknown): string[] {
  if (!feedJson || typeof feedJson !== "object") return [];
  const entries = (feedJson as { entries?: unknown[] }).entries;
  if (!Array.isArray(entries)) return [];

  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      try {
        const parsed = JSON.parse(node);
        walk(parsed);
      } catch {
        // plain string
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (rec.gameMode === "TeamDuels" && typeof rec.gameId === "string" && rec.gameId) {
        ids.add(rec.gameId);
      }
      for (const val of Object.values(rec)) {
        if (val && (typeof val === "object" || (typeof val === "string" && val.startsWith("{")))) {
          walk(val);
        }
      }
    }
  };

  walk(entries);
  return [...ids];
}

export class GeoguessrPoller {
  public authPaused = false;
  public lastWarning: string | null = null;
  private readonly delayMs: number;

  constructor(private readonly deps: GeoguessrPollerDeps) {
    this.delayMs = deps.delayBetweenRequestsMs ?? 750;
  }

  private async pacedFetch(url: string, ncfaCookie: string): Promise<Response | null> {
    const res = await this.deps.fetchGeoguessr(url, ncfaCookie);
    if (this.delayMs > 0) await sleep(this.delayMs);

    if (res.status === 401 || res.status === 403 || res.status === 503) {
      this.authPaused = true;
      this.lastWarning =
        res.status === 401
          ? "GeoGuessr _ncfa cookie expired (401). Update it in Companion settings."
          : `GeoGuessr blocked/challenged request (${res.status}). Polling paused.`;
      return null;
    }
    return res;
  }

  async syncOnce(opts: {
    duoTeamId: string;
    ncfaCookie: string;
    includeOlderReplays?: boolean;
  }): Promise<SyncSummary> {
    this.authPaused = false;
    this.lastWarning = null;
    let gamesUploaded = 0;
    let replaysUploaded = 0;

    // 1. Paginate feed/private sequentially to gather full ranked Game history
    const maxPages = this.deps.maxFeedPages ?? 25;
    const candidateGameSet = new Set<string>();
    let paginationToken: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const feedUrl = paginationToken
        ? `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${encodeURIComponent(paginationToken)}`
        : "https://www.geoguessr.com/api/v4/feed/private";
      const feedRes = await this.pacedFetch(feedUrl, opts.ncfaCookie);
      if (!feedRes) {
        return { authPaused: true, gamesUploaded, replaysUploaded, warning: this.lastWarning };
      }
      if (!feedRes.ok) {
        return {
          authPaused: false,
          gamesUploaded,
          replaysUploaded,
          warning: `Feed request returned ${feedRes.status}`,
        };
      }

      const feedJson = (await feedRes.json()) as {
        entries?: unknown[];
        paginationToken?: string | null;
      };
      for (const id of extractTeamDuelIdsFromFeed(feedJson)) {
        candidateGameSet.add(id);
      }
      if (!feedJson.paginationToken || !feedJson.entries?.length) {
        break;
      }
      paginationToken = feedJson.paginationToken;
    }

    const candidateGameIds = [...candidateGameSet];

    // 2. Ask server which Games are missing (two-Companion dedup)
    const { missingGameIds } =
      candidateGameIds.length > 0
        ? await this.deps.checkMissing(candidateGameIds, [], false)
        : { missingGameIds: [] as string[] };
    const fetchedGames: Array<{ gameId: string; duel: RawDuelPayload }> = [];

    for (const gameId of missingGameIds) {
      const duelRes = await this.pacedFetch(
        `https://game-server.geoguessr.com/api/duels/${encodeURIComponent(gameId)}`,
        opts.ncfaCookie,
      );
      if (!duelRes) {
        return { authPaused: true, gamesUploaded, replaysUploaded, warning: this.lastWarning };
      }
      if (!duelRes.ok) continue;

      const duel = (await duelRes.json()) as RawDuelPayload;
      if (!isRankedTeamDuel(duel)) continue;

      const matchesDuo = (duel.teams ?? []).some((t) => t.id === opts.duoTeamId);
      if (!matchesDuo) continue;

      await this.deps.uploadGame(gameId, duel as unknown as Record<string, unknown>);
      gamesUploaded += 1;
      fetchedGames.push({ gameId, duel });
    }

    // 3. Build all-4-player replay candidates (30-day window unless manual backfill)
    const nowMs = Date.now();
    const replayCandidates: ReplayCandidate[] = [];
    for (const { gameId, duel } of fetchedGames) {
      const firstRoundMs = duel.rounds?.[0]?.startTime
        ? Date.parse(duel.rounds[0].startTime)
        : nowMs;
      if (!opts.includeOlderReplays && nowMs - firstRoundMs > THIRTY_DAYS_MS) {
        continue;
      }

      const playerIds = (duel.teams ?? []).flatMap((t) =>
        (t.players ?? []).map((p) => p.playerId).filter((id): id is string => Boolean(id)),
      );
      const roundNumbers = (duel.rounds ?? [])
        .map((r) => r.roundNumber)
        .filter((n): n is number => typeof n === "number");

      for (const roundNumber of roundNumbers) {
        for (const geoguessrPlayerId of playerIds) {
          replayCandidates.push({
            geoguessrGameId: gameId,
            geoguessrPlayerId,
            roundNumber,
          });
        }
      }
    }

    if (replayCandidates.length > 0 || opts.includeOlderReplays) {
      const { missingReplays } = await this.deps.checkMissing(
        [],
        replayCandidates,
        Boolean(opts.includeOlderReplays),
      );
      for (const req of missingReplays) {
        const repRes = await this.pacedFetch(
          `https://game-server.geoguessr.com/api/replays/${encodeURIComponent(req.geoguessrPlayerId)}/${encodeURIComponent(req.geoguessrGameId)}/${req.roundNumber}`,
          opts.ncfaCookie,
        );
        if (!repRes) {
          return { authPaused: true, gamesUploaded, replaysUploaded, warning: this.lastWarning };
        }
        if (!repRes.ok) continue;

        const rawEvents = await repRes.json();
        const eventsArray = Array.isArray(rawEvents) ? rawEvents : [];
        await this.deps.uploadReplay(
          req.geoguessrGameId,
          req.geoguessrPlayerId,
          req.roundNumber,
          eventsArray,
        );
        replaysUploaded += 1;
      }
    }

    return { authPaused: false, gamesUploaded, replaysUploaded, warning: null };
  }
}
