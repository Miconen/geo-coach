import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { uuidv7, type Geocoder } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players, rounds } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  deriveLearningsWithStatus,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";
import { buildStatsPayload } from "../../stats/payload.js";
import {
  mcpAddCallLabels,
  mcpAddLearnings,
  mcpFinishRun,
  mcpGetInstructions,
  mcpListWork,
  mcpReadRange,
  mcpStartRun,
} from "../workflow.js";

// Where each test pin lands, so Rounds come out as a Split, a Spread and Committed.
const PLACES: Record<string, { countryCode: string; regionCode: string | null }> = {
  "40.42,-3.7": { countryCode: "ES", regionCode: "ES-MD" }, // Madrid
  "40.3,-3.8": { countryCode: "ES", regionCode: "ES-MD" }, // south of Madrid
  "39.86,-4.02": { countryCode: "ES", regionCode: "ES-CM" }, // Toledo
  "38.72,-9.14": { countryCode: "PT", regionCode: "PT-11" }, // Lisbon
  "40,-3.9": { countryCode: "ES", regionCode: "ES-CM" }, // the location
};
const stubGeocoder: Geocoder = (lat, lng) => PLACES[`${lat},${lng}`] ?? null;

const MADRID = { lat: 40.42, lng: -3.7 };
const MADRID_SOUTH = { lat: 40.3, lng: -3.8 };
const TOLEDO = { lat: 39.86, lng: -4.02 };
const LISBON = { lat: 38.72, lng: -9.14 };

const at = (hms: string) => `2026-11-20T${hms}.000Z`;

function guess(roundNumber: number, place: { lat: number; lng: number }, created: string) {
  return { roundNumber, ...place, distance: 100_000, score: 4000, created: at(created) };
}

function round(roundNumber: number, start: string, timer: string, end: string) {
  return {
    roundNumber,
    panorama: { panoId: `p${roundNumber}`, lat: 40, lng: -3.9, countryCode: "es" },
    startTime: at(start),
    timerStartTime: at(timer),
    endTime: at(end),
    damageMultiplier: 1,
  };
}

describe("calls Processing runs (#41)", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;
  let sessionId: string;
  let splitRoundId: string;
  let spreadRoundId: string;
  let committedRoundId: string;

  const RANGE = { startUtc: at("19:00:30"), endUtc: at("19:05:00") };

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    const samiId = uuidv7();

    await handle.db.insert(duos).values({ id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" });
    await handle.db.insert(players).values([
      { id: mikoId, discordId: "d_miko", displayName: "Miko", geoguessrUserId: "gg_p1" },
      { id: samiId, discordId: "d_sami", displayName: "Sami", geoguessrUserId: "gg_p2" },
    ]);
    await handle.db.insert(duoMemberships).values([
      { duoId, playerId: mikoId },
      { duoId, playerId: samiId },
    ]);

    const anchor = Date.parse(at("19:00:00"));
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
    sessionId = started.sessionId;

    const speech = (text: string, startMs: number) => ({
      text,
      startSampleMs: startMs,
      endSampleMs: startMs + 2_000,
      words: [],
      avgLogprob: -0.2,
    });
    await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        speech("You go Spain, I'll go Portugal", 70_000), // u1, Round 1 guessing
        speech("Okay, Portugal it is", 74_000), // u2, Round 1 guessing
        speech("Nice split, that saved us", 105_000), // u3, Round 1 results
        speech("I think this is Madrid", 130_000), // u4, Round 2 guessing
        speech("No way, it's Toledo", 135_000), // u5, Round 2 guessing
        speech("Madrid for sure", 190_000), // u6, Round 3 guessing
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tvId, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, {
      stoppedAt: new Date(anchor + 300_000).toISOString(),
      stopReason: "stop",
    });

    await upsertRawGame(
      handle.db,
      {
        duoId,
        geoguessrGameId: "gg_duel_calls",
        fetchedAt: at("19:04:30"),
        rawDuel: {
          gameId: "gg_duel_calls",
          status: "Finished",
          options: { isTeamDuels: true, isRated: true },
          teams: [
            {
              id: "gg_team_duo",
              name: "Road to Champ",
              health: 6000,
              players: [
                {
                  playerId: "gg_p1",
                  nick: "MikoGeo",
                  guesses: [
                    guess(1, MADRID, "19:01:30"),
                    guess(2, MADRID, "19:02:30"),
                    guess(3, MADRID, "19:03:30"),
                  ],
                },
                {
                  playerId: "gg_p2",
                  nick: "SamiGeo",
                  guesses: [
                    guess(1, LISBON, "19:01:31"),
                    guess(2, TOLEDO, "19:02:31"),
                    guess(3, MADRID_SOUTH, "19:03:31"),
                  ],
                },
              ],
            },
            {
              id: "gg_team_opp",
              name: "OppTeam",
              health: 6000,
              players: [
                { playerId: "gg_o1", nick: "Opp1", guesses: [guess(1, MADRID, "19:01:32")] },
                { playerId: "gg_o2", nick: "Opp2", guesses: [guess(1, TOLEDO, "19:01:33")] },
              ],
            },
          ],
          rounds: [
            round(1, "19:01:00", "19:01:20", "19:01:40"),
            round(2, "19:02:00", "19:02:20", "19:02:40"),
            round(3, "19:03:00", "19:03:20", "19:03:40"),
          ],
          result: { winningTeamId: "gg_team_duo" },
        },
      },
      stubGeocoder,
    );

    const roundRows = await handle.db.query.rounds.findMany({
      where: eq(rounds.duoId, duoId),
      orderBy: [asc(rounds.roundNumber)],
    });
    [splitRoundId, spreadRoundId, committedRoundId] = roundRows.map((r) => r.id) as [
      string,
      string,
      string,
    ];
  });

  afterEach(async () => {
    await handle.close();
  });

  async function callsOf() {
    const payload = await buildStatsPayload(handle.db, duoId);
    const byId = new Map(payload.rounds.map((r) => [r.id, r.call]));
    return {
      split: byId.get(splitRoundId),
      spread: byId.get(spreadRoundId),
      committed: byId.get(committedRoundId),
    };
  }

  async function startCallsRun() {
    return mcpStartRun(handle.db, mikoId, {
      sessionId,
      ...RANGE,
      purpose: "calls",
      agent: "claude",
      model: "claude-test",
    });
  }

  async function addLearningRun(purpose: "extract" | "tips") {
    const run = await mcpStartRun(handle.db, mikoId, {
      sessionId,
      ...RANGE,
      purpose,
      agent: "claude",
      model: "claude-test",
    });
    const res = await mcpAddLearnings(handle.db, mikoId, run.runId, [
      {
        kind: "strategy",
        text: `Splitting Spain and Portugal covers both (${purpose}).`,
        countries: ["ES", "PT"],
        origin: purpose === "tips" ? "agent" : "speech",
        utteranceRefs: ["u1"],
      },
    ]);
    expect(res.savedCount).toBe(1);
    await mcpFinishRun(handle.db, mikoId, run.runId);
  }

  it("serves versioned calls instructions and lists calls work per purpose", async () => {
    const instr = await mcpGetInstructions("calls");
    expect(instr.promptVersion).toBe("calls-v1");
    expect(instr.instructions).toContain("add_call_labels");

    const before = await mcpListWork(handle.db, mikoId, { purpose: "calls" });
    expect(before.ranges).toHaveLength(1);
    expect(before.ranges[0]!.reason).toBe("unprocessed");

    const run = await startCallsRun();
    await mcpFinishRun(handle.db, mikoId, run.runId);

    const after = await mcpListWork(handle.db, mikoId, { purpose: "calls" });
    expect(after.ranges.map((r) => [r.startUtc, r.endUtc])).toEqual([
      [at("19:00:00"), RANGE.startUtc],
    ]);
    // A calls run leaves extract work untouched.
    const extract = await mcpListWork(handle.db, mikoId, { purpose: "extract" });
    expect(extract.ranges.map((r) => [r.startUtc, r.endUtc])).toEqual([
      [at("19:00:00"), at("19:05:00")],
    ]);
  });

  it("reads the range's Split and Spread Rounds with both teams' guesses and guessing-phase Utterances", async () => {
    const run = await startCallsRun();
    const view = await mcpReadRange(handle.db, mikoId, run.runId);
    if (view.purpose !== "calls") throw new Error("expected a calls view");

    expect(view.rounds.map((r) => [r.roundId, r.kind])).toEqual([
      [splitRoundId, "split"],
      [spreadRoundId, "spread"],
    ]);
    const split = view.rounds[0]!;
    expect(split.duoGuesses.map((g) => [g.player, g.country, g.region])).toEqual([
      ["Miko", "ES", "Comunidad de Madrid"],
      ["Sami", "PT", "Lisboa"],
    ]);
    expect(split.opponentKind).toBe("spread");
    expect(split.opponentGuesses.map((g) => g.country)).toEqual(["ES", "ES"]);
    expect(split.utterances.map((u) => u.ref)).toEqual(["u1", "u2"]);
    expect(view.rounds[1]!.utterances.map((u) => u.ref)).toEqual(["u4", "u5"]);
    expect(view.transcript).toContain("u1 Miko: You go Spain, I'll go Portugal");
    expect(view.transcript).not.toContain("Nice split");
    expect(view.transcript).not.toContain(committedRoundId);
  });

  it("labels Split and Spread Rounds, rejecting invalid labels while saving the rest", async () => {
    const run = await startCallsRun();

    // A calls run takes Call labels, not Learnings.
    await expect(
      mcpAddLearnings(handle.db, mikoId, run.runId, [
        { kind: "other", text: "x", utteranceRefs: ["u1"] },
      ]),
    ).rejects.toThrow(/add_call_labels/);

    const res = await mcpAddCallLabels(handle.db, mikoId, run.runId, [
      { roundId: splitRoundId, called: true, utteranceRefs: ["u1", "u2"], note: "Agreed ES/PT" },
      { roundId: spreadRoundId, called: false, utteranceRefs: ["u4", "u5"] },
      { roundId: committedRoundId, called: false, utteranceRefs: ["u6"] }, // Committed
      { roundId: splitRoundId, called: true, utteranceRefs: ["u3"] }, // results phase
      { roundId: spreadRoundId, called: true, utteranceRefs: ["u1"] }, // another Round's speech
      { roundId: uuidv7(), called: false, utteranceRefs: [] }, // unknown Round
      { roundId: spreadRoundId, called: true, utteranceRefs: [] }, // a Call must cite speech
    ]);
    expect(res.savedCount).toBe(2);
    expect(res.errors.map((e) => e.index)).toEqual([2, 3, 4, 5, 6]);
    expect(res.errors[0]!.message).toMatch(/not a Split or Spread/);
    expect(res.errors[1]!.message).toMatch(/guessing phase: u3/);

    // Labels take effect only when the run finishes.
    expect(await callsOf()).toEqual({ split: null, spread: null, committed: null });
    const fin = await mcpFinishRun(handle.db, mikoId, run.runId);
    expect(fin.callLabelCount).toBe(2);
    expect(await callsOf()).toEqual({ split: "called", spread: "not-called", committed: null });
  });

  it("a second calls run replaces the labels and leaves extract and tips Learnings current", async () => {
    await addLearningRun("extract");
    await addLearningRun("tips");

    const first = await startCallsRun();
    await mcpAddCallLabels(handle.db, mikoId, first.runId, [
      { roundId: splitRoundId, called: true, utteranceRefs: ["u1", "u2"] },
      { roundId: spreadRoundId, called: false, utteranceRefs: ["u4"] },
    ]);
    // Calls runs block only overlapping open calls runs.
    await expect(startCallsRun()).rejects.toThrow(/overlap/i);
    await mcpFinishRun(handle.db, mikoId, first.runId);
    expect(await callsOf()).toEqual({ split: "called", spread: "not-called", committed: null });

    const second = await startCallsRun();
    const view = await mcpReadRange(handle.db, mikoId, second.runId);
    if (view.purpose !== "calls") throw new Error("expected a calls view");
    expect(view.rounds[0]!.currentLabel).toEqual({ called: true, note: null });

    await mcpAddCallLabels(handle.db, mikoId, second.runId, [
      { roundId: splitRoundId, called: false, utteranceRefs: ["u1"], note: "Relabelled" },
    ]);
    await mcpFinishRun(handle.db, mikoId, second.runId);

    // The Spread the second run left out is unlabelled again, not "not called".
    expect(await callsOf()).toEqual({ split: "not-called", spread: null, committed: null });

    const learnings = await deriveLearningsWithStatus(handle.db, duoId);
    expect(learnings.map((l) => [l.purpose, l.status]).sort()).toEqual([
      ["extract", "current"],
      ["tips", "current"],
    ]);
  });
});
