import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players, processingJobs, rounds, utterances } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  createManualLearning,
  deleteOwnSpeechRange,
  deriveClaims,
  deriveLearningsWithStatus,
  deriveSessionWorkRanges,
  finishProcessingRun,
  fixUtterance,
  getCurrentTranscriptVersionId,
  listCitedSections,
  readSourceImageForPlayer,
  startProcessingRun,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../index.js";
import { buildStatsPayload } from "../../stats/payload.js";
import { buildWorkbenchData } from "../../workbench/view-model.js";
import { mcpAddClaims, mcpAddSource, mcpAddSourceImage, mcpReadRange } from "../../mcp/workflow.js";
import { enqueueProcessingJobs } from "../../mcp/processing-jobs.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const at = (hms: string) => `2026-11-20T${hms}.000Z`;

interface DuoFixture {
  duoId: string;
  playerId: string;
  sessionId: string;
  recordingId: string;
  transcriptVersionId: string;
  utteranceIds: string[];
  roundIds: string[];
}

async function seedDuo(handle: TestDbHandle, tag: string): Promise<DuoFixture> {
  const duoId = uuidv7();
  const playerId = uuidv7();
  await handle.db.insert(duos).values({ id: duoId, name: `Duo ${tag}`, geoguessrTeamId: `team_${tag}` });
  await handle.db
    .insert(players)
    .values({ id: playerId, discordId: `d_${tag}`, displayName: tag, geoguessrUserId: `gg_${tag}` });
  await handle.db.insert(duoMemberships).values({ duoId, playerId });

  const anchor = Date.parse(at("19:00:00"));
  const recordingId = uuidv7();
  const tvId = uuidv7();
  const started = await startRecording(handle.db, playerId, {
    recordingId,
    transcriptVersionId: tvId,
    duoId,
    startedAt: new Date(anchor).toISOString(),
    clockAnchorMs: anchor,
    companionVersion: "0.1.0",
    model: "large-v3",
    transcriberSettings: {},
    hotwordsUsed: [],
  });
  await uploadTranscriptChunk(handle.db, playerId, tvId, {
    recordingId,
    chunkNo: 0,
    utterances: [
      { text: `${tag} one`, startSampleMs: 70_000, endSampleMs: 72_000, words: [], avgLogprob: -0.2 },
      { text: `${tag} two`, startSampleMs: 80_000, endSampleMs: 82_000, words: [], avgLogprob: -0.2 },
    ],
  });
  await completeTranscriptVersion(handle.db, playerId, tvId, { totalChunks: 1 });
  await stopRecording(handle.db, playerId, recordingId, {
    stoppedAt: new Date(anchor + 300_000).toISOString(),
    stopReason: "stop",
  });

  await upsertRawGame(
    handle.db,
    {
      duoId,
      geoguessrGameId: `duel_${tag}`,
      fetchedAt: at("19:04:30"),
      rawDuel: {
        gameId: `duel_${tag}`,
        status: "Finished",
        options: { isTeamDuels: true, isRated: true },
        teams: [
          {
            id: `team_${tag}`,
            name: `Duo ${tag}`,
            health: 6000,
            players: [
              {
                playerId: `gg_${tag}`,
                nick: tag,
                guesses: [
                  { roundNumber: 1, lat: 40, lng: -3.9, distance: 1000, score: 4900, created: at("19:01:30") },
                ],
              },
            ],
          },
          { id: `opp_${tag}`, name: "Opp", health: 6000, players: [] },
        ],
        rounds: [
          {
            roundNumber: 1,
            panorama: { panoId: `p_${tag}`, lat: 40, lng: -3.9, countryCode: "es" },
            startTime: at("19:01:00"),
            timerStartTime: at("19:01:20"),
            endTime: at("19:01:40"),
            damageMultiplier: 1,
          },
        ],
        result: { winningTeamId: `team_${tag}` },
      },
    },
    () => ({ countryCode: "ES", regionCode: null }),
  );

  const uRows = await handle.db.select({ id: utterances.id }).from(utterances).where(eq(utterances.duoId, duoId));
  const rRows = await handle.db.select({ id: rounds.id }).from(rounds).where(eq(rounds.duoId, duoId));
  return {
    duoId,
    playerId,
    sessionId: started.sessionId,
    recordingId,
    transcriptVersionId: tvId,
    utteranceIds: uRows.map((r) => r.id),
    roundIds: rRows.map((r) => r.id),
  };
}

describe("Duo scope (#56 step 0a)", () => {
  let handle: TestDbHandle;
  let a: DuoFixture;
  let b: DuoFixture;

  beforeEach(async () => {
    handle = await createTestDb();
    a = await seedDuo(handle, "A");
    b = await seedDuo(handle, "B");
  });

  afterEach(async () => {
    await handle.close();
  });

  const manual = (duo: DuoFixture, ids: { utteranceIds?: string[]; roundIds?: string[] }) =>
    createManualLearning(handle.db, duo.playerId, {
      duoId: duo.duoId,
      kind: "other",
      text: "note",
      countries: [],
      regions: [],
      topics: [],
      utteranceIds: ids.utteranceIds ?? [],
      roundIds: ids.roundIds ?? [],
    });

  it("refuses non-UUID ids and another Duo's speech or Rounds in a manual Learning", async () => {
    await expect(manual(a, { utteranceIds: ["not-a-uuid"] })).rejects.toMatchObject({ status: 400 });
    await expect(manual(a, { roundIds: ["x"] })).rejects.toMatchObject({ status: 400 });
    await expect(manual(a, { utteranceIds: [b.utteranceIds[0]!] })).rejects.toMatchObject({ status: 404 });
    await expect(manual(a, { roundIds: [b.roundIds[0]!] })).rejects.toMatchObject({ status: 404 });
    await expect(manual(a, { utteranceIds: [a.utteranceIds[0]!], roundIds: [a.roundIds[0]!] })).resolves.toBeTypeOf(
      "string",
    );
  });

  it("drops an Utterance whose duo_id points at another Duo than its Recording", async () => {
    const stray = b.utteranceIds[0]!;
    await handle.pglite.query(`update utterances set duo_id = $1 where id = $2`, [a.duoId, stray]);

    const wbA = await buildWorkbenchData(handle.db, a.duoId, a.playerId);
    expect(wbA.utterances.map((u) => u.id)).not.toContain(stray);
    const wbB = await buildWorkbenchData(handle.db, b.duoId, b.playerId);
    expect(wbB.utterances.map((u) => u.id)).not.toContain(stray);
    await expect(manual(a, { utteranceIds: [stray] })).rejects.toMatchObject({ status: 404 });
  });

  it("drops a Recording whose Session belongs to another Duo", async () => {
    await handle.pglite.query(`update recordings set session_id = $1 where id = $2`, [a.sessionId, b.recordingId]);
    const wbB = await buildWorkbenchData(handle.db, b.duoId, b.playerId);
    expect(wbB.utterances).toHaveLength(0);
    const wbA = await buildWorkbenchData(handle.db, a.duoId, a.playerId);
    expect(wbA.utterances.map((u) => u.id).sort()).toEqual([...a.utteranceIds].sort());
  });

  it("drops a Round whose Game belongs to another Duo", async () => {
    const stray = b.roundIds[0]!;
    await handle.pglite.query(`update rounds set duo_id = $1 where id = $2`, [a.duoId, stray]);
    const statsA = await buildStatsPayload(handle.db, a.duoId);
    expect(statsA.rounds.map((r) => r.id)).not.toContain(stray);
    expect(statsA.rounds.map((r) => r.id)).toContain(a.roundIds[0]);
    await expect(manual(a, { roundIds: [stray] })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a run for another Duo's Session and hides a run whose Session moved Duo", async () => {
    const base = {
      startedByPlayerId: a.playerId,
      purpose: "extract" as const,
      agent: "claude",
      model: "test",
      promptVersion: "v1",
      rangeStart: new Date(at("19:00:30")),
      rangeEnd: new Date(at("19:05:00")),
    };
    await expect(
      startProcessingRun(handle.db, { ...base, duoId: a.duoId, sessionId: b.sessionId }),
    ).rejects.toMatchObject({ status: 404 });

    const run = await startProcessingRun(handle.db, { ...base, duoId: a.duoId, sessionId: a.sessionId });
    const runId = run.id;
    await expect(mcpReadRange(handle.db, a.playerId, runId)).resolves.toBeDefined();

    await handle.pglite.query(`update processing_runs set session_id = $1 where id = $2`, [b.sessionId, runId]);
    await expect(mcpReadRange(handle.db, a.playerId, runId)).rejects.toMatchObject({ status: 404 });
    await expect(mcpReadRange(handle.db, a.playerId, "nope")).rejects.toMatchObject({ status: 404 });
    const learnings = await deriveLearningsWithStatus(handle.db, a.duoId);
    expect(learnings.every((l) => l.runId !== runId)).toBe(true);
  });

  const runFor = async (duo: DuoFixture) =>
    startProcessingRun(handle.db, {
      duoId: duo.duoId,
      sessionId: duo.sessionId,
      startedByPlayerId: duo.playerId,
      purpose: "extract",
      agent: "claude",
      model: "test",
      promptVersion: "v1",
      rangeStart: new Date(at("19:00:00")),
      rangeEnd: new Date(at("19:05:00")),
    });

  it("keeps the valid Transcript version current beside a mismatched newer complete one", async () => {
    await handle.pglite.query(
      `insert into transcript_versions (id, recording_id, duo_id, model, is_complete, created_at)
       values ($1, $2, $3, 'x', true, now() + interval '1 hour')`,
      [uuidv7(), a.recordingId, b.duoId],
    );
    expect(await getCurrentTranscriptVersionId(handle.db, a.recordingId)).toBe(a.transcriptVersionId);
    const wbA = await buildWorkbenchData(handle.db, a.duoId, a.playerId);
    expect(wbA.utterances.map((u) => u.id).sort()).toEqual([...a.utteranceIds].sort());
  });

  it("never reads, fixes or deletes a mismatched Utterance on a valid current version", async () => {
    const stray = a.utteranceIds[0]!;
    await handle.pglite.query(`update utterances set duo_id = $1 where id = $2`, [b.duoId, stray]);

    for (const duo of [a, b]) {
      await expect(
        fixUtterance(handle.db, {
          duoId: duo.duoId,
          playerId: duo.playerId,
          utteranceId: stray,
          find: "one",
          replacement: "uno",
          scope: "once",
        }),
      ).rejects.toMatchObject({ status: 404 });
    }

    const run = await runFor(a);
    const read = JSON.stringify(await mcpReadRange(handle.db, a.playerId, run.id));
    expect(read).not.toContain("A one");
    expect(read).toContain("A two");

    const res = await deleteOwnSpeechRange(handle.db, a.playerId, a.duoId, {
      recordingId: a.recordingId,
      startUtc: new Date(at("19:00:00")),
      endUtc: new Date(at("19:05:00")),
    });
    expect(res.deletedUtteranceCount).toBe(1);
    const left = await handle.db.select({ id: utterances.id }).from(utterances).where(eq(utterances.id, stray));
    expect(left).toHaveLength(1);
  });

  it("Duo-checks cross-Duo Learning links on both ends in reads and speech deletion", async () => {
    const learningB = await manual(b, { roundIds: [b.roundIds[0]!] });
    await handle.pglite.query(`insert into learning_utterances (learning_id, utterance_id) values ($1, $2)`, [
      learningB,
      a.utteranceIds[0],
    ]);
    await handle.pglite.query(`insert into learning_rounds (learning_id, round_id) values ($1, $2)`, [
      learningB,
      a.roundIds[0],
    ]);
    const before = (await deriveLearningsWithStatus(handle.db, b.duoId)).find((l) => l.id === learningB)!;
    expect(before.utteranceIds).toEqual([]);
    expect(before.explicitRoundIds).toEqual([b.roundIds[0]]);

    const res = await deleteOwnSpeechRange(handle.db, a.playerId, a.duoId, {
      recordingId: a.recordingId,
      startUtc: new Date(at("19:00:00")),
      endUtc: new Date(at("19:05:00")),
    });
    expect(res.deletedLearningCount).toBe(0);
    expect((await deriveLearningsWithStatus(handle.db, b.duoId)).map((l) => l.id)).toContain(learningB);
  });

  it("never counts a chunk whose Recording differs from its version's Recording", async () => {
    const run = await runFor(a);
    await finishProcessingRun(handle.db, run.id);
    expect(await deriveSessionWorkRanges(handle.db, a.duoId, a.sessionId, "extract")).toHaveLength(0);
    await handle.pglite.query(
      `insert into transcript_chunks (transcript_version_id, chunk_no, recording_id) values ($1, 9, $2)`,
      [a.transcriptVersionId, b.recordingId],
    );
    expect(await deriveSessionWorkRanges(handle.db, a.duoId, a.sessionId, "extract")).toHaveLength(0);
  });

  it("enqueues nothing for another Duo's Session", async () => {
    await expect(
      enqueueProcessingJobs(handle.db, a.playerId, {
        duoId: a.duoId,
        sessionId: b.sessionId,
        purpose: "extract",
        startUtc: new Date(at("19:00:00")),
        endUtc: new Date(at("19:05:00")),
      }),
    ).rejects.toBeDefined();
    expect(await handle.db.select().from(processingJobs)).toHaveLength(0);
  });

  it("loads Stats and the workbench when a stored duel has non-array rounds", async () => {
    await upsertRawGame(
      handle.db,
      {
        duoId: a.duoId,
        geoguessrGameId: "duel_bad_rounds",
        fetchedAt: at("19:10:00"),
        rawDuel: { gameId: "duel_bad_rounds", status: "Finished", teams: [], rounds: { 1: { roundNumber: 1 } } },
      },
      () => null,
    );
    await expect(buildStatsPayload(handle.db, a.duoId)).resolves.toBeDefined();
    await expect(buildWorkbenchData(handle.db, a.duoId, a.playerId)).resolves.toBeDefined();
  });

  describe("Source and Evidence Duo agreement (X6)", () => {
    const GUIDE = "# Guide\n\n## Bollards\n\nYellow tops.\n\n![x](a.png)\n\n## Poles\n\nConcrete.\n";

    it("hides an image, Evidence and cited section whose version moved to another Duo's Source", async () => {
      const vA = await mcpAddSource(handle.db, a.playerId, { title: "Guide A", kind: "other", markdown: GUIDE });
      const vA2 = await mcpAddSource(handle.db, a.playerId, { title: "Guide A2", kind: "other", markdown: GUIDE });
      const vB = await mcpAddSource(handle.db, b.playerId, { title: "Guide B", kind: "other", markdown: GUIDE });
      const { imageId } = await mcpAddSourceImage(handle.db, a.playerId, {
        sourceVersionId: vA.sourceVersionId,
        name: "a.png",
        mimeType: "image/png",
        base64: PNG_1PX,
      });
      await mcpAddClaims(handle.db, a.playerId, {
        items: [
          {
            text: "Yellow-topped bollards.",
            evidence: [
              { kind: "documentation", sourceVersionId: vA.sourceVersionId, section: "bollards", images: ["a.png"] },
              { kind: "documentation", sourceVersionId: vA2.sourceVersionId, section: "poles" },
            ],
          },
        ],
      });
      const [claimBefore] = await deriveClaims(handle.db, a.duoId);
      expect(claimBefore!.imageIds).toEqual([imageId]);
      expect(claimBefore!.evidence).toHaveLength(2);
      expect((await listCitedSections(handle.db, a.duoId)).map((s) => s.sourceVersionId)).toContain(vA.sourceVersionId);

      await handle.pglite.query(`update source_versions set source_id = $1, version_no = 99 where id = $2`, [
        vB.sourceId,
        vA.sourceVersionId,
      ]);

      await expect(readSourceImageForPlayer(handle.db, a.playerId, imageId)).rejects.toMatchObject({ status: 404 });
      await expect(readSourceImageForPlayer(handle.db, b.playerId, imageId)).rejects.toMatchObject({ status: 404 });
      const [claimAfter] = await deriveClaims(handle.db, a.duoId);
      expect(claimAfter!.imageIds).toEqual([]);
      expect(claimAfter!.evidence).toHaveLength(1);
      expect((await listCitedSections(handle.db, a.duoId)).map((s) => s.sourceVersionId)).not.toContain(
        vA.sourceVersionId,
      );
    });
  });
});
