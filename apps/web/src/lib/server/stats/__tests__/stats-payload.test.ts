import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duoMemberships, duos, games, players } from "../../db/schema.js";
import {
  rebuildDerivedGamesForDuo,
  startRecording,
  stopRecording,
  upsertRawGame,
} from "../../services/index.js";
import { buildStatsPayload } from "../payload.js";

// Made-up duel in the real payload's shape (see #37): no real Opponents.
const rawDuel = {
  gameId: "gg_duel_stats",
  status: "Finished",
  options: {
    isTeamDuels: true,
    isRated: true,
    map: { name: "A Pro World" },
    movementOptions: { forbidMoving: true, forbidZooming: true, forbidRotating: true },
  },
  teams: [
    {
      id: "gg_team_duo",
      name: "Road to Champ",
      health: 5000,
      players: [
        {
          playerId: "gg_p1",
          nick: "MikoGeo",
          guesses: [
            {
              roundNumber: 1,
              lat: 42.7,
              lng: 25.4,
              distance: 10_000,
              score: 4950,
              created: "2026-11-20T19:05:12.500Z",
            },
          ],
          progressChange: { rankedTeamDuelsProgress: { ratingBefore: 1170, ratingAfter: 1185 } },
        },
      ],
    },
    {
      id: "gg_team_opp",
      name: "Balkan Bosses",
      health: 0,
      players: [
        {
          playerId: "gg_opp_secret",
          nick: "OpponentNick",
          guesses: [
            {
              roundNumber: 1,
              lat: 44.4,
              lng: 26.1,
              distance: 300_000,
              score: 3500,
              created: "2026-11-20T19:05:20.000Z",
            },
          ],
          progressChange: { rankedTeamDuelsProgress: { ratingBefore: 1240, ratingAfter: 1225 } },
        },
      ],
    },
  ],
  rounds: [
    {
      roundNumber: 1,
      panorama: { panoId: "p1", lat: 42.69, lng: 25.32, countryCode: "bg" },
      startTime: "2026-11-20T19:05:00.000Z",
      timerStartTime: "2026-11-20T19:05:12.500Z",
      endTime: "2026-11-20T19:05:27.500Z",
      damageMultiplier: 1,
    },
  ],
  result: { winningTeamId: "gg_team_duo" },
};

describe("buildStatsPayload", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    await handle.db.insert(duos).values({
      id: duoId,
      name: "Road to Champ",
      geoguessrTeamId: "gg_team_duo",
      hotwords: [],
    });
    await handle.db.insert(players).values({
      id: mikoId,
      discordId: "discord_miko",
      displayName: "Miko",
      geoguessrUserId: "gg_p1",
      geoguessrName: "MikoGeo",
    });
    await handle.db.insert(duoMemberships).values({ duoId, playerId: mikoId });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("sends compact Game and Round rows linked to the Session they were played in", async () => {
    const recordingId = uuidv7();
    const { sessionId } = await startRecording(handle.db, mikoId, {
      recordingId,
      transcriptVersionId: uuidv7(),
      duoId,
      startedAt: "2026-11-20T19:00:00.000Z",
      clockAnchorMs: Date.parse("2026-11-20T19:00:00.000Z"),
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    await stopRecording(handle.db, mikoId, recordingId, {
      stoppedAt: "2026-11-20T19:30:00.000Z",
      stopReason: "stop",
    });
    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_stats",
      fetchedAt: "2026-11-20T19:10:00.000Z",
      rawDuel,
    });

    const payload = await buildStatsPayload(handle.db, duoId);

    expect(payload.players).toEqual([{ id: mikoId, displayName: "Miko" }]);
    expect(payload.sessions.map((s) => s.id)).toEqual([sessionId]);
    expect(payload.games).toHaveLength(1);
    expect(payload.games[0]).toMatchObject({
      won: true,
      ratingBefore: 1170,
      ratingAfter: 1185,
      mapName: "A Pro World",
      mode: "nmpz",
      opponentRatingBefore: 1240,
      sessionId,
    });

    const [round] = payload.rounds;
    expect(round).toMatchObject({ countryCode: "BG", duoBestScore: 4950, opponentBestScore: 3500 });
    const duoGuess = round!.guesses.find((g) => g.isDuo)!;
    expect(duoGuess).toMatchObject({ playerId: mikoId, secondsToGuess: 12.5, guessedFirst: true });
    const opponentGuess = round!.guesses.find((g) => !g.isDuo)!;
    expect(opponentGuess).toMatchObject({ playerId: null, score: 3500, secondsToGuess: 20 });
  });

  it("carries no Opponent nickname, GeoGuessr ID or team name", async () => {
    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_stats",
      fetchedAt: "2026-11-20T19:10:00.000Z",
      rawDuel,
    });

    const json = JSON.stringify(await buildStatsPayload(handle.db, duoId));

    expect(json).not.toContain("OpponentNick");
    expect(json).not.toContain("gg_opp_secret");
    expect(json).not.toContain("Balkan Bosses");
  });

  it("fills Map, Mode and the Opponents' rating for stored Games when derived data is rebuilt", async () => {
    const { gameId } = await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_stats",
      fetchedAt: "2026-11-20T19:10:00.000Z",
      rawDuel,
    });
    // As a Game stored before these columns existed.
    await handle.db
      .update(games)
      .set({ mapName: null, mode: null, opponentRatingBefore: null })
      .where(eq(games.id, gameId));

    await rebuildDerivedGamesForDuo(handle.db, duoId);

    const row = await handle.db.query.games.findFirst({ where: eq(games.id, gameId) });
    expect(row).toMatchObject({ mapName: "A Pro World", mode: "nmpz", opponentRatingBefore: 1240 });
  });
});
