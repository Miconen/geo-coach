import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players, rounds } from "../../db/schema.js";
import {
  addClockOffsetMeasurement,
  completeTranscriptVersion,
  createManualLearning,
  deleteOwnSpeechRange,
  deriveLearningsWithStatus,
  deriveSessionWorkRanges,
  finishProcessingRun,
  getCurrentTranscriptVersionId,
  insertRunLearnings,
  rebuildDerivedGamesForDuo,
  setManualOffsetOverride,
  startProcessingRun,
  startRecording,
  startRetranscription,
  stopRecording,
  toggleReaction,
  uploadTranscriptChunk,
  upsertRawGame,
  upsertRawReplay,
} from "../index.js";

describe("Seam 2: Data model, Session grouping, derived staleness & supersession", () => {
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
      hotwords: ["Bulgaria", "Plovdiv"],
    });
    await handle.db.insert(players).values([
      {
        id: mikoId,
        discordId: "discord_miko",
        displayName: "Miko",
        geoguessrUserId: "gg_p1",
        geoguessrName: "MikoGeo",
      },
      {
        id: soraId,
        discordId: "discord_sora",
        displayName: "Sora",
        geoguessrUserId: "gg_p2",
        geoguessrName: "SoraMaps",
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

  it("groups Recordings into Sessions by the 30 min gap rule and blocks duplicate live Recordings", async () => {
    const t0 = new Date("2026-11-20T19:00:00.000Z");
    const rec1Id = uuidv7();
    const tv1Id = uuidv7();

    const r1 = await startRecording(handle.db, mikoId, {
      recordingId: rec1Id,
      transcriptVersionId: tv1Id,
      duoId,
      startedAt: t0.toISOString(),
      clockAnchorMs: t0.getTime(),
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });

    // Second live Recording for the same Player & Duo is refused
    await expect(
      startRecording(handle.db, mikoId, {
        recordingId: uuidv7(),
        transcriptVersionId: uuidv7(),
        duoId,
        startedAt: new Date(t0.getTime() + 60_000).toISOString(),
        clockAnchorMs: t0.getTime() + 60_000,
        companionVersion: "0.1.0",
        model: "large-v3",
        transcriberSettings: {},
        hotwordsUsed: [],
      }),
    ).rejects.toThrow(/already recording/i);

    // Partner joins while rec1 is live -> same Session
    const r2 = await startRecording(handle.db, soraId, {
      recordingId: uuidv7(),
      transcriptVersionId: uuidv7(),
      duoId,
      startedAt: new Date(t0.getTime() + 120_000).toISOString(),
      clockAnchorMs: t0.getTime() + 120_000,
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    expect(r2.sessionId).toBe(r1.sessionId);

    // Stop both at 19:30
    const stopAt = new Date("2026-11-20T19:30:00.000Z");
    await stopRecording(handle.db, mikoId, rec1Id, {
      stoppedAt: stopAt.toISOString(),
      stopReason: "stop",
    });
    await stopRecording(handle.db, soraId, r2.recordingId, {
      stoppedAt: stopAt.toISOString(),
      stopReason: "stop",
    });

    // Start 20 min later (< 30 min gap) -> joins same Session
    const r3 = await startRecording(handle.db, mikoId, {
      recordingId: uuidv7(),
      transcriptVersionId: uuidv7(),
      duoId,
      startedAt: new Date("2026-11-20T19:50:00.000Z").toISOString(),
      clockAnchorMs: Date.parse("2026-11-20T19:50:00.000Z"),
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    expect(r3.sessionId).toBe(r1.sessionId);

    await stopRecording(handle.db, mikoId, r3.recordingId, {
      stoppedAt: new Date("2026-11-20T20:00:00.000Z").toISOString(),
      stopReason: "stop",
    });

    // Start 45 min later (>= 30 min gap) -> starts a new Session
    const r4 = await startRecording(handle.db, mikoId, {
      recordingId: uuidv7(),
      transcriptVersionId: uuidv7(),
      duoId,
      startedAt: new Date("2026-11-20T20:45:00.000Z").toISOString(),
      clockAnchorMs: Date.parse("2026-11-20T20:45:00.000Z"),
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    expect(r4.sessionId).not.toBe(r1.sessionId);
  });

  it("handles idempotent chunk upload, contiguous chunk gap refill, and clock-offset UTC recomputation", async () => {
    const anchor = Date.parse("2026-11-20T19:00:00.000Z");
    const recId = uuidv7();
    const tvId = uuidv7();

    await startRecording(handle.db, mikoId, {
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

    // Upload chunk 0, then chunk 2 (gap at 1)
    const c0 = await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        { text: "Yellow bollards here", startSampleMs: 1_000, endSampleMs: 3_000, words: [] },
      ],
    });
    expect(c0.highestContiguousChunkNo).toBe(0);
    expect(c0.duplicate).toBe(false);

    // Uploading chunk 0 again is idempotent
    const c0Dup = await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        { text: "Yellow bollards here", startSampleMs: 1_000, endSampleMs: 3_000, words: [] },
      ],
    });
    expect(c0Dup.duplicate).toBe(true);
    expect(c0Dup.highestContiguousChunkNo).toBe(0);

    const c2 = await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 2,
      utterances: [
        { text: "Definitely Bulgaria", startSampleMs: 10_000, endSampleMs: 12_000, words: [] },
      ],
    });
    expect(c2.highestContiguousChunkNo).toBe(0);

    // Fill gap at chunk 1 -> contiguous jumps to 2
    const c1 = await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 1,
      utterances: [
        { text: "Red top reflector too", startSampleMs: 5_000, endSampleMs: 7_000, words: [] },
      ],
    });
    expect(c1.highestContiguousChunkNo).toBe(2);

    // Add clock offset measurement (-500ms) -> recomputes Utterance UTC times
    const offsetRes = await addClockOffsetMeasurement(handle.db, mikoId, recId, {
      measuredAt: new Date(anchor + 5_000).toISOString(),
      pcTimeMs: anchor + 5_000,
      offsetMs: -500,
      rttMs: 25,
    });
    expect(offsetRes.effectiveOffsetMs).toBe(-500);
    expect(offsetRes.isCalibrated).toBe(true);

    // Manual override (+1000ms) wins
    const overrideRes = await setManualOffsetOverride(handle.db, mikoId, recId, 1000);
    expect(overrideRes.effectiveOffsetMs).toBe(1000);

    const rows = await handle.db.query.utterances.findMany({
      where: (u, { eq }) => eq(u.transcriptVersionId, tvId),
      orderBy: (u, { asc }) => [asc(u.startSampleMs)],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.startedAt.toISOString()).toBe("2026-11-20T19:00:02.000Z"); // 1000ms + 1000ms override
  });

  it("derives staleness and purpose-scoped supersession per ADR 0001 and ADR 0002", async () => {
    const anchor = Date.parse("2026-11-20T19:00:00.000Z");
    const recId = uuidv7();
    const tv1Id = uuidv7();

    const started = await startRecording(handle.db, mikoId, {
      recordingId: recId,
      transcriptVersionId: tv1Id,
      duoId,
      startedAt: new Date(anchor).toISOString(),
      clockAnchorMs: anchor,
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });

    await uploadTranscriptChunk(handle.db, mikoId, tv1Id, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        { text: "Bulgaria has yellow top bollards", startSampleMs: 10_000, endSampleMs: 15_000, words: [] },
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tv1Id, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, {
      stoppedAt: new Date(anchor + 60_000).toISOString(),
      stopReason: "stop",
    });

    const allU = await handle.db.query.utterances.findMany();
    const u1 = allU[0]!;

    // Initially unprocessed for both extract and tips
    const workBefore = await deriveSessionWorkRanges(handle.db, duoId, started.sessionId, "extract");
    expect(workBefore).toHaveLength(1);
    expect(workBefore[0]!.reason).toBe("unprocessed");

    // Start extract run 1 -> Learnings don't take effect until finished
    const run1 = await startProcessingRun(handle.db, {
      duoId,
      sessionId: started.sessionId,
      startedByPlayerId: mikoId,
      purpose: "extract",
      agent: "claude",
      model: "claude-sonnet",
      promptVersion: "extract-v1",
      rangeStart: new Date(anchor),
      rangeEnd: new Date(anchor + 60_000),
    });

    const [l1Id] = await insertRunLearnings(handle.db, run1.id, duoId, "extract", [
      {
        kind: "clue",
        text: "Yellow-top bollards point to Bulgaria.",
        countries: ["BG"],
        regions: [],
        topics: ["bollards"],
        origin: "speech",
        utteranceIds: [u1.id],
        roundIds: [],
        sourceSpanStart: u1.startedAt,
        sourceSpanEnd: u1.endedAt,
      },
    ]);

    // While run1 is still open, l1 is not yet current
    const whileOpen = await deriveLearningsWithStatus(handle.db, duoId);
    expect(whileOpen.filter((l) => l.status === "current")).toHaveLength(0);

    await finishProcessingRun(handle.db, run1.id);

    // Star l1 so we can verify reactions survive supersession
    await toggleReaction(handle.db, l1Id!, mikoId, "star");

    // Also add a Manual Learning -> never superseded
    const manualId = await createManualLearning(handle.db, mikoId, {
      duoId,
      kind: "strategy",
      text: "Call out country before zooming.",
      countries: [],
      regions: [],
      topics: ["comms"],
      utteranceIds: [u1.id],
      roundIds: [],
    });

    // Extract is now up to date, while tips is still unprocessed
    expect(await deriveSessionWorkRanges(handle.db, duoId, started.sessionId, "extract")).toHaveLength(0);
    expect(await deriveSessionWorkRanges(handle.db, duoId, started.sessionId, "tips")).toHaveLength(1);

    // Run a tips pass over the same range -> must NOT supersede extract learning l1
    const tipsRun = await startProcessingRun(handle.db, {
      duoId,
      sessionId: started.sessionId,
      startedByPlayerId: mikoId,
      purpose: "tips",
      agent: "claude",
      model: "claude-sonnet",
      promptVersion: "tips-v1",
      rangeStart: new Date(anchor),
      rangeEnd: new Date(anchor + 60_000),
    });
    await insertRunLearnings(handle.db, tipsRun.id, duoId, "tips", [
      {
        kind: "distinguisher",
        text: "Bulgaria bollards have flat tops while Romanian ones are angled.",
        countries: ["BG", "RO"],
        regions: [],
        topics: ["bollards"],
        origin: "agent",
        utteranceIds: [u1.id],
        roundIds: [],
        sourceSpanStart: u1.startedAt,
        sourceSpanEnd: u1.endedAt,
      },
    ]);
    await finishProcessingRun(handle.db, tipsRun.id);

    const afterTips = await deriveLearningsWithStatus(handle.db, duoId);
    expect(afterTips.find((l) => l.id === l1Id)!.status).toBe("current");

    // Re-transcribe recording with a new complete version -> extract becomes stale
    const tv2Id = uuidv7();
    await startRetranscription(handle.db, mikoId, {
      transcriptVersionId: tv2Id,
      recordingId: recId,
      model: "large-v3",
      transcriberSettings: { beamSize: 5 },
      hotwordsUsed: ["Bulgaria", "Plovdiv"],
    });
    // While tv2 is incomplete, tv1 remains current
    expect(await getCurrentTranscriptVersionId(handle.db, recId)).toBe(tv1Id);

    await uploadTranscriptChunk(handle.db, mikoId, tv2Id, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        { text: "Bulgaria has yellow-top bollards near Plovdiv", startSampleMs: 10_000, endSampleMs: 15_000, words: [] },
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tv2Id, { totalChunks: 1 });
    expect(await getCurrentTranscriptVersionId(handle.db, recId)).toBe(tv2Id);

    const staleRanges = await deriveSessionWorkRanges(handle.db, duoId, started.sessionId, "extract");
    expect(staleRanges).toHaveLength(1);
    expect(staleRanges[0]!.reason).toBe("stale");

    // Second extract run supersedes l1, keeps manual Learning current, preserves l1's star reaction
    const run2 = await startProcessingRun(handle.db, {
      duoId,
      sessionId: started.sessionId,
      startedByPlayerId: mikoId,
      purpose: "extract",
      agent: "claude",
      model: "claude-opus",
      promptVersion: "extract-v1",
      rangeStart: new Date(anchor),
      rangeEnd: new Date(anchor + 60_000),
    });
    const tv2Utterance = (
      await handle.db.query.utterances.findMany({
        where: (u, { eq }) => eq(u.transcriptVersionId, tv2Id),
      })
    )[0]!;
    const [l2Id] = await insertRunLearnings(handle.db, run2.id, duoId, "extract", [
      {
        kind: "clue",
        text: "Yellow-top bollards point to Bulgaria (spotted near Plovdiv).",
        countries: ["BG"],
        regions: [{ country: "BG", name: "Plovdiv" }],
        topics: ["bollards"],
        origin: "speech",
        utteranceIds: [tv2Utterance.id],
        roundIds: [],
        sourceSpanStart: tv2Utterance.startedAt,
        sourceSpanEnd: tv2Utterance.endedAt,
      },
    ]);
    await finishProcessingRun(handle.db, run2.id);

    const finalLearnings = await deriveLearningsWithStatus(handle.db, duoId);
    const l1Row = finalLearnings.find((l) => l.id === l1Id)!;
    const l2Row = finalLearnings.find((l) => l.id === l2Id)!;
    const manualRow = finalLearnings.find((l) => l.id === manualId)!;

    expect(l1Row.status).toBe("superseded");
    expect(l1Row.supersededByRunId).toBe(run2.id);
    expect(l1Row.reactions.some((r) => r.reaction === "star" && r.playerId === mikoId)).toBe(true);
    expect(l2Row.status).toBe("current");
    expect(manualRow.status).toBe("current");
  });

  it("allows Players to permanently delete only their own speech and removes Learnings citing only deleted Utterances", async () => {
    const anchor = Date.parse("2026-11-20T19:00:00.000Z");
    const recId = uuidv7();
    const tvId = uuidv7();

    await startRecording(handle.db, mikoId, {
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
        { text: "Private remark", startSampleMs: 2_000, endSampleMs: 4_000, words: [] },
        { text: "Keep this clue", startSampleMs: 20_000, endSampleMs: 23_000, words: [] },
      ],
    });

    const us = await handle.db.query.utterances.findMany({
      orderBy: (u, { asc }) => [asc(u.startSampleMs)],
    });

    const doomedLearningId = await createManualLearning(handle.db, mikoId, {
      duoId,
      kind: "other",
      text: "Only cites private remark",
      countries: [],
      regions: [],
      topics: [],
      utteranceIds: [us[0]!.id],
      roundIds: [],
    });
    const survivingLearningId = await createManualLearning(handle.db, mikoId, {
      duoId,
      kind: "clue",
      text: "Cites both remarks",
      countries: [],
      regions: [],
      topics: [],
      utteranceIds: [us[0]!.id, us[1]!.id],
      roundIds: [],
    });

    // Sora cannot delete Miko's speech
    await expect(
      deleteOwnSpeechRange(handle.db, soraId, duoId, {
        recordingId: recId,
        startUtc: new Date(anchor),
        endUtc: new Date(anchor + 10_000),
      }),
    ).rejects.toThrow(/own speech|forbidden/i);

    // Miko deletes [19:00:00, 19:00:10]
    const result = await deleteOwnSpeechRange(handle.db, mikoId, duoId, {
      recordingId: recId,
      startUtc: new Date(anchor),
      endUtc: new Date(anchor + 10_000),
    });
    expect(result.deletedUtteranceCount).toBe(1);
    expect(result.deletedLearningCount).toBe(1);

    const remainingLearnings = await handle.db.query.learnings.findMany();
    expect(remainingLearnings.map((l) => l.id)).toEqual([survivingLearningId]);
    expect(remainingLearnings.find((l) => l.id === doomedLearningId)).toBeUndefined();
  });

  it("upserts raw GeoGuessr Games and Replays and derives Rounds idempotently", async () => {
    const rawDuel = {
      gameId: "gg_duel_100",
      status: "Finished",
      options: { isTeamDuels: true, isRated: true },
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
                  created: "2026-11-20T19:05:20.000Z",
                },
              ],
              progressChange: {
                rankedTeamDuelsProgress: {
                  ratingBefore: 1170,
                  ratingAfter: 1185,
                },
              },
            },
          ],
        },
      ],
      rounds: [
        {
          roundNumber: 1,
          panorama: { panoId: "p1", lat: 42.69, lng: 25.32, countryCode: "bg" },
          startTime: "2026-11-20T19:05:00.000Z",
          timerStartTime: "2026-11-20T19:05:20.000Z",
          endTime: "2026-11-20T19:05:35.000Z",
          damageMultiplier: 1,
        },
      ],
      result: { winningTeamId: "gg_team_duo" },
    };

    const g1 = await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_100",
      fetchedAt: "2026-11-20T19:06:00.000Z",
      rawDuel,
    });
    const g2 = await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_100",
      fetchedAt: "2026-11-20T19:07:00.000Z",
      rawDuel,
    });
    expect(g2.gameId).toBe(g1.gameId);

    // Store empty replay [] as "no replay available"
    await upsertRawReplay(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_100",
      geoguessrPlayerId: "gg_p1",
      roundNumber: 1,
      fetchedAt: "2026-11-20T19:06:30.000Z",
      rawEvents: [],
    });

    const replayRows = await handle.db.query.replays.findMany();
    expect(replayRows).toHaveLength(1);
    expect(replayRows[0]!.hasEvents).toBe(false);

    // Rebuilding derived data backfills Regions and guessed countries on Rounds
    // stored before the geocoder existed.
    await handle.db.update(rounds).set({ regionCode: null, guesses: [] });
    await rebuildDerivedGamesForDuo(handle.db, duoId);
    const [round] = await handle.db.query.rounds.findMany();
    expect(round!.countryCode).toBe("BG");
    expect(round!.regionCode).toBe("BG-24");
    expect(round!.guesses).toEqual([
      expect.objectContaining({ countryCode: "BG", regionCode: "BG-24", lat: 42.7, lng: 25.4 }),
    ]);
  });
});
