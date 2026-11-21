import { findDuoTeam, isRankedTeamDuel, type RawDuelPayload } from "@geo-coach/shared";

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
  /**
   * Finished Games already checked and found not to be this Duo's ranked team
   * duels (another partner, unrated). The server never stores them, so without
   * this they'd be fetched again on every sync.
   */
  loadSkippedGameIds?: (duoTeamId: string) => Set<string>;
  saveSkippedGameIds?: (duoTeamId: string, ids: Set<string>) => void;
}

export interface SyncProgress {
  phase: "feed" | "games" | "replays";
  feedPages: number;
  newGames: number;
  gamesDone: number;
  replaysDone: number;
  replaysTotal: number;
}

/** What a sync looked at, so "0 Games" can say why */
export interface SyncScan {
  feedPages: number;
  /** Team duels found on the feed pages read */
  teamDuelsSeen: number;
  /** Already on the server */
  alreadyStored: number;
  /** Not this Duo's ranked team duels (other partners, unrated), known or found now */
  notThisDuo: number;
  /** Still being played; checked again next sync */
  unfinished: number;
  /** Paging stopped at a page with nothing new (rather than the end of the feed) */
  stoppedEarly: boolean;
}

export interface SyncSummary {
  authPaused: boolean;
  gamesUploaded: number;
  replaysUploaded: number;
  scan: SyncScan;
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
        // Some entry payloads are JSON strings of an array, not an object
        if (val && (typeof val === "object" || (typeof val === "string" && /^[[{]/.test(val)))) {
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
  /** Live progress of the running sync, null when idle */
  public progress: SyncProgress | null = null;
  private running: Promise<SyncSummary> | null = null;
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

  /** Runs one sync, or joins the one already running (auto-poll and manual sync can overlap) */
  syncOnce(opts: {
    duoTeamId: string;
    ncfaCookie: string;
    includeOlderReplays?: boolean;
  }): Promise<SyncSummary> {
    this.running ??= this.runSync(opts).finally(() => {
      this.running = null;
      this.progress = null;
    });
    return this.running;
  }

  private async runSync(opts: {
    duoTeamId: string;
    ncfaCookie: string;
    includeOlderReplays?: boolean;
  }): Promise<SyncSummary> {
    this.authPaused = false;
    this.lastWarning = null;
    let gamesUploaded = 0;
    let replaysUploaded = 0;

    const progress: SyncProgress = {
      phase: "feed",
      feedPages: 0,
      newGames: 0,
      gamesDone: 0,
      replaysDone: 0,
      replaysTotal: 0,
    };
    this.progress = progress;
    const scan: SyncScan = {
      feedPages: 0,
      teamDuelsSeen: 0,
      alreadyStored: 0,
      notThisDuo: 0,
      unfinished: 0,
      stoppedEarly: false,
    };
    const skipped = this.deps.loadSkippedGameIds?.(opts.duoTeamId) ?? new Set<string>();

    // 1. Page through feed/private (newest first) until a page has nothing new.
    // Games are fetched oldest first below, so an interrupted sync leaves the
    // unfetched ones newest, and the next sync reaches them before stopping.
    // A backfill reads the whole feed.
    const maxPages = this.deps.maxFeedPages ?? 25;
    const seen = new Set<string>();
    const newGameIds: string[] = [];
    let paginationToken: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const feedUrl = paginationToken
        ? `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${encodeURIComponent(paginationToken)}`
        : "https://www.geoguessr.com/api/v4/feed/private";
      const feedRes = await this.pacedFetch(feedUrl, opts.ncfaCookie);
      if (!feedRes) {
        return { authPaused: true, gamesUploaded, replaysUploaded, scan, warning: this.lastWarning };
      }
      if (!feedRes.ok) {
        return {
          authPaused: false,
          gamesUploaded,
          replaysUploaded,
          scan,
          warning: `Feed request returned ${feedRes.status}`,
        };
      }
      progress.feedPages = page + 1;
      scan.feedPages = page + 1;

      const feedJson = (await feedRes.json()) as {
        entries?: unknown[];
        paginationToken?: string | null;
      };
      const pageIds = extractTeamDuelIdsFromFeed(feedJson).filter((id) => !seen.has(id));
      for (const id of pageIds) seen.add(id);

      // 2. Ask the server which are missing (two-Companion dedup)
      const unknown = pageIds.filter((id) => !skipped.has(id));
      const { missingGameIds } =
        unknown.length > 0
          ? await this.deps.checkMissing(unknown, [], false)
          : { missingGameIds: [] as string[] };
      newGameIds.push(...missingGameIds);
      scan.teamDuelsSeen += pageIds.length;
      scan.notThisDuo += pageIds.length - unknown.length;
      scan.alreadyStored += unknown.length - missingGameIds.length;
      progress.newGames = newGameIds.length;

      const nothingNew = pageIds.length > 0 && missingGameIds.length === 0;
      if (!feedJson.paginationToken || !feedJson.entries?.length) break;
      if (nothingNew && !opts.includeOlderReplays) {
        scan.stoppedEarly = true;
        break;
      }
      paginationToken = feedJson.paginationToken;
    }

    progress.phase = "games";
    const fetchedGames: Array<{ gameId: string; duel: RawDuelPayload }> = [];

    for (const gameId of newGameIds.reverse()) {
      const duelRes = await this.pacedFetch(
        `https://game-server.geoguessr.com/api/duels/${encodeURIComponent(gameId)}`,
        opts.ncfaCookie,
      );
      if (!duelRes) {
        return { authPaused: true, gamesUploaded, replaysUploaded, scan, warning: this.lastWarning };
      }
      progress.gamesDone += 1;
      if (!duelRes.ok) continue;

      const duel = (await duelRes.json()) as RawDuelPayload;
      if (duel.status !== "Finished") {
        scan.unfinished += 1; // check again next sync
        continue;
      }
      if (!isRankedTeamDuel(duel) || !findDuoTeam(duel.teams ?? [], opts.duoTeamId)) {
        skipped.add(gameId);
        scan.notThisDuo += 1;
        this.deps.saveSkippedGameIds?.(opts.duoTeamId, skipped);
        continue;
      }

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
      progress.phase = "replays";
      progress.replaysTotal = missingReplays.length;
      for (const req of missingReplays) {
        const repRes = await this.pacedFetch(
          `https://game-server.geoguessr.com/api/replays/${encodeURIComponent(req.geoguessrPlayerId)}/${encodeURIComponent(req.geoguessrGameId)}/${req.roundNumber}`,
          opts.ncfaCookie,
        );
        if (!repRes) {
          return { authPaused: true, gamesUploaded, replaysUploaded, scan, warning: this.lastWarning };
        }
        progress.replaysDone += 1;
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

    return { authPaused: false, gamesUploaded, replaysUploaded, scan, warning: null };
  }
}
