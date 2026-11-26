import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { uuidv7, type Geocoder } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { clues, duoMemberships, duos, players, rounds } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  deriveCurrentRoundClues,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";
import { mcpAddLearnings, mcpAddRoundClues, mcpFinishRun, mcpGetInstructions, mcpListWork, mcpReadRange, mcpStartRun } from "../workflow.js";

const stubGeocoder: Geocoder = () => ({ countryCode: "NO", regionCode: null });
const at = (hms: string) => `2026-11-20T${hms}.000Z`;
const guess = (roundNumber: number, created: string) => ({ roundNumber, lat: 60, lng: 10, distance: 1000, score: 4900, created: at(created) });
const round = (roundNumber: number, start: string, end: string) => ({
  roundNumber,
  panorama: { panoId: `p${roundNumber}`, lat: 60, lng: 10, countryCode: "no" },
  startTime: at(start),
  timerStartTime: at(start),
  endTime: at(end),
  damageMultiplier: 1,
});

describe("clues Processing runs (#89)", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;
  let sessionId: string;
  let r1: string;
  let r2: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" });
    await handle.db.insert(players).values({ id: mikoId, discordId: "d_miko", displayName: "Miko", geoguessrUserId: "gg_p1" });
    await handle.db.insert(duoMemberships).values({ duoId, playerId: mikoId });

    const anchor = Date.parse(at("19:00:00"));
    const recId = uuidv7();
    const tvId = uuidv7();
    sessionId = (
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
      })
    ).sessionId;
    const speech = (text: string, startMs: number) => ({ text, startSampleMs: startMs, endSampleMs: startMs + 2_000, words: [], avgLogprob: -0.2 });
    await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        speech("Yellow centre line here", 70_000), // u1, Round 1 guessing
        speech("and the car is a white pickup", 74_000), // u2, Round 1 guessing
        speech("oh, there was an s with a hat on that sign", 105_000), // u3, after Round 1's guessing ended
        speech("black chevrons with yellow arrows", 130_000), // u4, Round 2 guessing
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tvId, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, { stoppedAt: new Date(anchor + 300_000).toISOString(), stopReason: "stop" });
    await upsertRawGame(
      handle.db,
      {
        duoId,
        geoguessrGameId: "gg_duel_clues",
        fetchedAt: at("19:04:30"),
        rawDuel: {
          gameId: "gg_duel_clues",
          status: "Finished",
          options: { isTeamDuels: true, isRated: true },
          teams: [
            { id: "gg_team_duo", name: "Road to Champ", health: 6000, players: [{ playerId: "gg_p1", nick: "MikoGeo", guesses: [guess(1, "19:01:30"), guess(2, "19:02:30")] }] },
            { id: "gg_team_opp", name: "Opp", health: 6000, players: [{ playerId: "gg_o1", nick: "Opp1", guesses: [] }] },
          ],
          rounds: [round(1, "19:01:00", "19:01:40"), round(2, "19:02:00", "19:02:40")],
          result: { winningTeamId: "gg_team_duo" },
        },
      },
      stubGeocoder,
    );
    [r1, r2] = (await handle.db.query.rounds.findMany({ where: eq(rounds.duoId, duoId), orderBy: [asc(rounds.roundNumber)] })).map((r) => r.id) as [string, string];
  });
  afterEach(async () => handle.close());

  async function startClues() {
    const { ranges } = await mcpListWork(handle.db, mikoId, { purpose: "clues" });
    expect(ranges).toHaveLength(1);
    return mcpStartRun(handle.db, mikoId, { ...ranges[0]!, purpose: "clues", agent: "test", model: "test" });
  }

  it("serves the clues instructions with the vocabulary and the spoken letters", async () => {
    const { promptVersion, instructions } = await mcpGetInstructions("clues");
    expect(promptVersion).toBe("clues-v1");
    expect(instructions).toContain('"s with a triangle"');
    expect(instructions).toContain("Š (s with a hat)");
    expect(instructions).toContain("1. **Road lines:**");
  });

  it("reads only speech while guessing, and refuses Utterances from after guessing ends", async () => {
    const run = await startClues();
    const view = await mcpReadRange(handle.db, mikoId, run.runId);
    if (view.purpose !== "clues") throw new Error("expected a clues range");
    expect(view.rounds.map((r) => [r.roundNumber, r.utterances.map((u) => u.text)])).toEqual([
      [1, ["Yellow centre line here", "and the car is a white pickup"]],
      [2, ["black chevrons with yellow arrows"]],
    ]);
    const refOf = (text: string) => view.rounds.flatMap((r) => r.utterances).find((u) => u.text === text)?.ref;
    expect(refOf("oh, there was an s with a hat on that sign")).toBeUndefined();

    const res = await mcpAddRoundClues(handle.db, mikoId, run.runId, [
      {
        roundId: r1,
        clues: [
          { family: "Road lines", name: "Yellow/orange centre line", utteranceRefs: [refOf("Yellow centre line here")] },
          { family: "Google car", name: "Pickup truck", utteranceRefs: [refOf("and the car is a white pickup")] },
        ],
      },
      { roundId: r2, clues: [{ family: "Script and language", name: "Š (s with a hat)", utteranceRefs: ["u3"] }] },
      { roundId: r2, clues: [{ family: "Weather", name: "Fog", utteranceRefs: [refOf("black chevrons with yellow arrows")] }] },
    ]);
    expect(res.savedRounds).toBe(1);
    expect(res.createdClues).toEqual([]);
    expect(res.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(res.errors[0]!.message).toMatch(/not spoken while Round 2 was guessed: u3/);
    expect(res.errors[1]!.message).toMatch(/not a Clue family/);

    // Nothing takes effect before the run finishes.
    expect((await deriveCurrentRoundClues(handle.db, duoId, [r1, r2])).size).toBe(0);
    await mcpFinishRun(handle.db, mikoId, run.runId);
    const current = await deriveCurrentRoundClues(handle.db, duoId, [r1, r2]);
    const names = new Map((await handle.db.select().from(clues)).map((c) => [c.id, c.name]));
    expect(current.get(r1)?.map((c) => names.get(c.clueId))).toEqual(["Yellow/orange centre line", "Pickup truck"]);
    expect(current.get(r1)?.every((c) => c.utteranceIds.length === 1)).toBe(true);
    expect(current.get(r2)).toBeUndefined();
  });

  it("makes no Learnings", async () => {
    const run = await startClues();
    await expect(
      mcpAddLearnings(handle.db, mikoId, run.runId, [{ kind: "clue", text: "x", utteranceRefs: ["u1"] }]),
    ).rejects.toThrow(/add_round_clues/);
  });
});
