import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { guessedCountryLabel, isWrongCountry } from "$lib/round-countries.js";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  createManualLearning,
  finishProcessingRun,
  insertRunLearnings,
  startProcessingRun,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
  upsertRawReplay,
} from "../../services/index.js";
import { buildWorkbenchData, searchWorkbench } from "../view-model.js";

describe("Seam 6: A3 Atlas + Command Deck coaching workbench view-model", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;
  let soraId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    soraId = uuidv7();

    await handle.db.insert(duos).values({
      id: duoId,
      name: "Road to Champ",
      geoguessrTeamId: "gg_team_duo",
      targetRating: 1200,
      targetDivision: "Champion (1200)",
      hotwords: ["Bulgaria"],
    });
    await handle.db.insert(players).values([
      {
        id: mikoId,
        discordId: "discord_miko",
        displayName: "Miko",
        geoguessrUserId: "gg_p1",
        geoguessrName: "MikoGeo",
        avatarColor: "#2563eb",
      },
      {
        id: soraId,
        discordId: "discord_sora",
        displayName: "Sora",
        geoguessrUserId: "gg_p2",
        geoguessrName: "SoraMaps",
        avatarColor: "#7c3aed",
      },
    ]);
    await handle.db.insert(duoMemberships).values([
      { duoId, playerId: mikoId },
      { duoId, playerId: soraId },
    ]);
  });

  afterEach(async () => {
    await handle.close();
  });

  it("derives Country Dossiers, 0-Learning countries, Confusion Pairs, Replay badges, debrief links, and uncited speech search", async () => {
    const anchor = Date.parse("2026-11-20T19:00:00.000Z");
    const recId = uuidv7();
    const tvId = uuidv7();

    const started = await startRecording(handle.db, mikoId, {
      recordingId: recId,
      transcriptVersionId: tvId,
      duoId,
      startedAt: new Date(anchor).toISOString(),
      clockAnchorMs: anchor,
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });

    await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        {
          text: "Thought this was Romania but yellow bollards mean Bulgaria",
          startSampleMs: 10_000, // 19:00:10 (in Round 1)
          endSampleMs: 15_000,
          words: [],
        },
        {
          text: "Uncited comment about Kenyan snorkel trucks",
          startSampleMs: 70_000, // 19:01:10 (in Round 2, Kenya)
          endSampleMs: 75_000,
          words: [],
        },
        {
          text: "Between-game debrief: remember Bulgaria poles",
          startSampleMs: 130_000, // 19:02:10 (after Game 1)
          endSampleMs: 135_000,
          words: [],
        },
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tvId, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, {
      stoppedAt: new Date(anchor + 180_000).toISOString(),
      stopReason: "stop",
    });

    // Game with Round 1 (BG, guessed RO -> Confusion Pair BG↔RO + HP leak) and Round 2 (KE, 0 Learnings)
    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_wb_1",
      fetchedAt: "2026-11-20T19:02:30.000Z",
      rawDuel: {
        gameId: "gg_wb_1",
        status: "Finished",
        options: { isTeamDuels: true, isRated: true },
        teams: [
          {
            id: "gg_team_duo",
            name: "Road to Champ",
            health: 4100,
            players: [
              {
                playerId: "gg_p1",
                nick: "MikoGeo",
                guesses: [
                  {
                    roundNumber: 1,
                    lat: 44.4,
                    lng: 26.1,
                    distance: 280_000,
                    score: 3700,
                    created: "2026-11-20T19:00:20.000Z",
                  },
                  {
                    roundNumber: 2,
                    lat: -1.3,
                    lng: 36.8,
                    distance: 30_000,
                    score: 4850,
                    created: "2026-11-20T19:01:20.000Z",
                  },
                ],
                progressChange: {
                  rankedTeamDuelsProgress: { ratingBefore: 1165, ratingAfter: 1179 },
                },
              },
            ],
          },
          {
            id: "gg_team_opp",
            name: "Rivals",
            health: 3200,
            players: [
              {
                playerId: "gg_opp1",
                nick: "Opp1",
                guesses: [
                  {
                    roundNumber: 1,
                    lat: 42.7,
                    lng: 25.4,
                    distance: 20_000,
                    score: 4900,
                    created: "2026-11-20T19:00:22.000Z",
                  },
                  {
                    roundNumber: 2,
                    lat: -1.5,
                    lng: 37.0,
                    distance: 50_000,
                    score: 4700,
                    created: "2026-11-20T19:01:25.000Z",
                  },
                ],
              },
            ],
          },
        ],
        rounds: [
          {
            roundNumber: 1,
            panorama: { panoId: "p1", lat: 42.69, lng: 25.32, countryCode: "bg" },
            startTime: "2026-11-20T19:00:00.000Z",
            timerStartTime: "2026-11-20T19:00:20.000Z",
            endTime: "2026-11-20T19:00:35.000Z",
            damageMultiplier: 1,
          },
          {
            roundNumber: 2,
            panorama: { panoId: "p2", lat: -1.28, lng: 36.82, countryCode: "ke" },
            startTime: "2026-11-20T19:00:50.000Z",
            timerStartTime: "2026-11-20T19:01:20.000Z",
            endTime: "2026-11-20T19:01:35.000Z",
            damageMultiplier: 1,
          },
        ],
        result: { winningTeamId: "gg_team_duo" },
      },
    });

    // Store one replay with events for Round 1
    await upsertRawReplay(handle.db, {
      duoId,
      geoguessrGameId: "gg_wb_1",
      geoguessrPlayerId: "gg_p1",
      roundNumber: 1,
      fetchedAt: "2026-11-20T19:02:40.000Z",
      rawEvents: [{ t: 100 }],
    });

    const allRounds = await handle.db.query.rounds.findMany({
      orderBy: (r, { asc }) => [asc(r.roundNumber)],
    });
    const r1 = allRounds[0]!;
    const allUs = await handle.db.query.utterances.findMany({
      orderBy: (u, { asc }) => [asc(u.startSampleMs)],
    });

    // Process only [19:00:00, 19:00:45] -> leaves Round 2 (19:01:10) in an Unprocessed range!
    const run = await startProcessingRun(handle.db, {
      duoId,
      sessionId: started.sessionId,
      startedByPlayerId: mikoId,
      purpose: "extract",
      agent: "claude",
      model: "claude-sonnet",
      promptVersion: "extract-v1",
      rangeStart: new Date("2026-11-20T19:00:00.000Z"),
      rangeEnd: new Date("2026-11-20T19:00:45.000Z"),
    });
    await insertRunLearnings(handle.db, run.id, duoId, "extract", [
      {
        kind: "mistake",
        text: "Picked Romania instead of Bulgaria despite yellow-top bollards.",
        countries: ["BG", "RO"],
        regions: [],
        topics: ["bollards"],
        origin: "speech",
        utteranceIds: [allUs[0]!.id],
        roundIds: [],
        sourceSpanStart: allUs[0]!.startedAt,
        sourceSpanEnd: allUs[0]!.endedAt,
      },
    ]);
    await finishProcessingRun(handle.db, run.id);

    // Manual Learning explicitly linked to Round 1 (debrief said after Game, or no Utterances)
    await createManualLearning(handle.db, mikoId, {
      duoId,
      kind: "clue",
      text: "Check Bulgarian hollow concrete poles too.",
      countries: ["BG"],
      regions: [],
      topics: ["poles"],
      utteranceIds: [],
      roundIds: [r1.id],
    });

    const wb = await buildWorkbenchData(handle.db, duoId, mikoId);

    // Recent Games telemetry
    expect(wb.recentGames).toHaveLength(1);
    expect(wb.recentGames[0]!.ratingDelta).toBe(14);
    expect(wb.duo.currentRating).toBe(1179);

    // Confusion Pair BG <-> RO derived from mistake + wrong-country guess
    expect(
      wb.confusionPairs.some(
        (p) =>
          (p.countries[0] === "BG" && p.countries[1] === "RO") ||
          (p.countries[0] === "RO" && p.countries[1] === "BG"),
      ),
    ).toBe(true);

    // Country Dossiers include BG (has Learnings + HP leak) and KE (0 Learnings, 1 played Round -> 0·NR bridge)
    const bgDossier = wb.countryDossiers.find((c) => c.code === "BG")!;
    const keDossier = wb.countryDossiers.find((c) => c.code === "KE")!;
    expect(bgDossier.learningCount).toBe(2);
    expect(bgDossier.netHpDelta).toBe(-1200);
    expect(keDossier.learningCount).toBe(0);
    expect(keDossier.roundsPlayed).toBe(1);

    // Manual Learning without cited Utterances derives Session via Round -> Game -> Session
    const manual = wb.learnings.find((l) => l.origin === "manual")!;
    expect(manual.sessionIds).toEqual([started.sessionId]);

    // Round 1 shows replay count > 0
    const r1Card = wb.roundsById[r1.id]!;
    expect(r1Card.replayPlayerCount).toBe(1);

    // Guesses and the Round's Region come from the geocoder: R1 was guessed in Bucharest
    expect(r1Card.regionCode).toBe("BG-24");
    expect(r1Card.regionName).toBe("Stara Zagora");
    const duoGuess = r1Card.guesses.find((g) => g.isDuo)!;
    expect(duoGuess).toMatchObject({ countryCode: "RO", regionCode: "RO-B", regionName: "Bucharest" });
    expect(isWrongCountry(r1Card.countryCode, duoGuess)).toBe(true);
    expect(guessedCountryLabel(duoGuess)).toBe("RO");

    // Free-text search finds uncited raw speech ("snorkel") grouped under "Unprocessed range"
    const searchRes = searchWorkbench(wb, "snorkel");
    expect(searchRes.learningIds).toHaveLength(0);
    expect(searchRes.uncitedUtterances).toHaveLength(1);
    expect(searchRes.uncitedUtterances[0]!.rangeStatus).toBe("unprocessed");
  });
});
