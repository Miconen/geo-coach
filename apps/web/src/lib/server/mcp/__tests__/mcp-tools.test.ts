import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";
import {
  mcpAddLearnings,
  mcpFinishRun,
  mcpGetInstructions,
  mcpListWork,
  mcpReadRange,
  mcpStartRun,
} from "../workflow.js";

describe("Seam 4: Remote MCP tools & Processing run workflow", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;
  let sessionId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();

    await handle.db.insert(duos).values({
      id: duoId,
      name: "Road to Champ",
      geoguessrTeamId: "gg_team_duo",
      hotwords: ["Bulgaria"],
    });
    await handle.db.insert(players).values({
      id: mikoId,
      discordId: "discord_miko",
      displayName: "Miko",
      geoguessrUserId: "gg_p1",
      geoguessrName: "MikoGeo",
    });
    await handle.db.insert(duoMemberships).values({ duoId, playerId: mikoId });

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
      hotwordsUsed: ["Bulgaria"],
    });
    sessionId = started.sessionId;

    await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        {
          text: "Warming up before queue",
          startSampleMs: 10_000,
          endSampleMs: 14_000,
          words: [],
          avgLogprob: -0.2,
        },
        {
          text: "Yellow top bollards here, definitely Bulgaria",
          startSampleMs: 185_000, // 19:03:05
          endSampleMs: 190_000,
          words: [],
          avgLogprob: -0.25,
        },
        {
          text: "muffled maybe Sofia",
          startSampleMs: 195_000, // 19:03:15
          endSampleMs: 198_000,
          words: [],
          avgLogprob: -1.1, // low confidence -> (?)
        },
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tvId, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, {
      stoppedAt: new Date(anchor + 300_000).toISOString(), // 19:05:00
      stopReason: "stop",
    });

    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_mcp_1",
      fetchedAt: "2026-11-20T19:04:30.000Z",
      rawDuel: {
        gameId: "gg_duel_mcp_1",
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
                    distance: 15_000,
                    score: 4930,
                    created: "2026-11-20T19:03:20.000Z",
                  },
                ],
              },
            ],
          },
          {
            id: "gg_team_opp",
            name: "OppTeam",
            health: 4000,
            players: [
              {
                playerId: "gg_opp1",
                nick: "Opp1",
                guesses: [
                  {
                    roundNumber: 1,
                    lat: 44.4,
                    lng: 26.1,
                    distance: 250_000,
                    score: 3930,
                    created: "2026-11-20T19:03:25.000Z",
                  },
                ],
              },
            ],
          },
        ],
        rounds: [
          {
            roundNumber: 1,
            panorama: {
              panoId: "p1",
              lat: 42.69,
              lng: 25.32,
              countryCode: "bg",
            },
            startTime: "2026-11-20T19:03:00.000Z",
            timerStartTime: "2026-11-20T19:03:20.000Z",
            endTime: "2026-11-20T19:03:35.000Z",
            damageMultiplier: 1,
          },
        ],
        result: { winningTeamId: "gg_team_duo" },
      },
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("walks list_work -> start_run -> read_range -> add_learnings (partial validation) -> finish_run", async () => {
    const instr = await mcpGetInstructions("extract");
    expect(instr.promptVersion).toBe("extract-v3");
    expect(instr.instructions).toContain("Learning");

    const work = await mcpListWork(handle.db, mikoId, { purpose: "extract" });
    expect(work.ranges.length).toBeGreaterThanOrEqual(1);
    expect(work.ranges[0]!.sessionId).toBe(sessionId);

    // Start run covering [19:02:30, 19:05:00] so 19:00:10 is in pre-context (uncitable, >2m? let's use 19:01:30 so 19:00:10 is inside -2m uncitable context!)
    const started = await mcpStartRun(handle.db, mikoId, {
      sessionId,
      startUtc: "2026-11-20T19:01:30.000Z",
      endUtc: "2026-11-20T19:05:00.000Z",
      purpose: "extract",
      agent: "claude",
      model: "claude-sonnet",
    });
    expect(started.promptVersion).toBe("extract-v3");

    // Overlapping open extract run is refused, while overlapping open tips run is allowed
    await expect(
      mcpStartRun(handle.db, mikoId, {
        sessionId,
        startUtc: "2026-11-20T19:02:00.000Z",
        endUtc: "2026-11-20T19:04:00.000Z",
        purpose: "extract",
        agent: "claude",
        model: "claude-sonnet",
      }),
    ).rejects.toThrow(/overlap/i);

    const tipsRun = await mcpStartRun(handle.db, mikoId, {
      sessionId,
      startUtc: "2026-11-20T19:02:00.000Z",
      endUtc: "2026-11-20T19:04:00.000Z",
      purpose: "tips",
      agent: "claude",
      model: "claude-sonnet",
    });
    expect(tipsRun.runId).toBeTruthy();

    // read_range formats compact transcript with u-refs, (?) low-confidence marker, Game/Round markers, and uncitable context
    const rangeView = await mcpReadRange(handle.db, mikoId, started.runId);
    expect(rangeView.transcript).toContain("Warming up before queue");
    expect(rangeView.transcript).not.toMatch(/u\d+.*Warming up before queue/);
    expect(rangeView.transcript).toMatch(/\[19:03:05\] u1 Miko: Yellow top bollards/);
    expect(rangeView.transcript).toContain("(?)");
    expect(rangeView.transcript).toContain("Round 1");
    expect(rangeView.transcript).toContain("True: BG / Stara Zagora");
    expect(rangeView.transcript).toContain("Duo 6000 / Opp 5000");

    // add_learnings accepts valid items and reports per-item errors without losing valid ones (including invalid roundIds)
    const addRes = await mcpAddLearnings(handle.db, mikoId, started.runId, [
      {
        kind: "clue",
        text: "Yellow-top bollards indicate Bulgaria.",
        countries: ["BG"],
        regions: [{ country: "BG", name: "Stara Zagora" }],
        topics: ["bollards"],
        origin: "speech",
        utteranceRefs: ["u1"],
        roundIds: [],
      },
      {
        kind: "clue",
        text: "Bad country code item",
        countries: ["ZZ"],
        regions: [],
        topics: [],
        origin: "speech",
        utteranceRefs: ["u1"],
        roundIds: [],
      },
      {
        kind: "clue",
        text: "Unknown ref item",
        countries: ["BG"],
        regions: [],
        topics: [],
        origin: "speech",
        utteranceRefs: ["u999"],
        roundIds: [],
      },
      {
        kind: "clue",
        text: "Unknown roundId item",
        countries: ["BG"],
        regions: [],
        topics: [],
        origin: "speech",
        utteranceRefs: ["u1"],
        roundIds: [uuidv7()],
      },
    ]);
    expect(addRes.savedCount).toBe(1);
    expect(addRes.errors).toHaveLength(3);

    // Finish extract run and zero-learning tips run
    const finExtract = await mcpFinishRun(handle.db, mikoId, started.runId);
    expect(finExtract.learningCount).toBe(1);

    const finTips = await mcpFinishRun(handle.db, mikoId, tipsRun.runId);
    expect(finTips.learningCount).toBe(0);
  });
});
