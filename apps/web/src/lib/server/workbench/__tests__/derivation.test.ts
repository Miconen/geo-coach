import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { games, recordings, sessions } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  createManualLearning,
  finishProcessingRun,
  loadRoundsInSpan,
  startProcessingRun,
  startRetranscription,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";
import { buildStatsPayload } from "../../stats/payload.js";
import { mcpReadRange } from "../../mcp/workflow.js";
import { buildWorkbenchData } from "../view-model.js";
import { addLearnings, addRecording, at, fixtureGeocoder, insertRun, seedSessionFixture, type SessionFixture } from "./session-fixture.js";

// #56 1a-derivation: Game bounds, Round windows, Game <-> Session 0..N, ADR 0008, debrief, Manual attribution,
// historical citations. Sora's second Recording (19:20-19:30) joins the fixture Session and carries speech for
// Games with missing timestamps.

/** A duel whose Rounds may lack a start or end (null = missing, as GeoGuessr sometimes sends). */
function customDuel(gameId: string, teamId: string, rounds: Array<[number, string | null, string | null]>) {
  const iso = (hms: string) => `2026-11-20T${hms}.000Z`;
  return {
    gameId,
    status: "Finished",
    options: { isTeamDuels: true, isRated: true },
    teams: [
      { id: teamId, name: "Fixture Duo", health: 6000, players: [{ playerId: "gg_f1", nick: "F1", guesses: [] }] },
      { id: `${teamId}_opp`, name: "Opp", health: 6000, players: [] },
    ],
    rounds: rounds.map(([n, start, end]) => ({
      roundNumber: n,
      panorama: { panoId: `${gameId}${n}`, lat: 40, lng: -3.9, countryCode: "es" },
      ...(start ? { startTime: iso(start) } : {}),
      ...(end ? { endTime: iso(end) } : {}),
      damageMultiplier: 1,
    })),
  };
}

const SORA_LINES: Array<[string, number]> = [
  ["g3 round one", 30_000], // 19:20:30, in g3 R1
  ["just before R1 ends", 38_000], // 19:20:38-40, in R1
  ["at R1's own end", 40_000], // 19:20:40, gap: R2 has no start
  ["in the gap", 50_000], // 19:20:50, gap (old stored tail would have linked it)
  ["g3 final round", 130_000], // 19:22:10, in R3
  ["debrief of g3", 200_000], // 19:23:20, within 2 min of R3's results end 19:22:55
  ["g6 first round", 245_000], // 19:24:05, next Game's Round (not a debrief)
  ["g4 round two", 430_000], // 19:27:10
  ["g5 round one", 490_000], // 19:28:10
];

describe("relationships and parity (#56 1a-derivation)", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;
  let sora: Awaited<ReturnType<typeof addRecording>>;
  const gameId: Record<string, string> = {};

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
    sora = await addRecording(handle, { duoId: f.duoId, playerId: f.soraId, start: at("19:20:00"), minutes: 9.8, lines: SORA_LINES });
    const team = "team_f";
    for (const [key, rounds] of [
      ["g3", [[1, "19:20:00", "19:20:40"], [2, null, "19:21:40"], [3, "19:22:00", "19:22:40"]]],
      ["g6", [[1, "19:24:00", "19:24:40"]]],
      ["g4", [[1, null, "19:26:40"], [2, "19:27:00", "19:27:40"]]],
      ["g5", [[1, "19:28:00", "19:28:40"], [2, null, null]]],
    ] as const) {
      await upsertRawGame(
        handle.db,
        {
          duoId: f.duoId,
          geoguessrGameId: key,
          fetchedAt: "2026-11-20T19:40:00.000Z",
          rawDuel: customDuel(key, team, rounds.map((r) => [...r] as [number, string | null, string | null])),
        },
        fixtureGeocoder,
      );
      const row = await handle.db.query.games.findFirst({ where: eq(games.geoguessrGameId, key) });
      gameId[key] = row!.id;
    }
  });

  afterEach(async () => {
    await handle.close();
  });

  const utt = (text: string) => sora.u[SORA_LINES.findIndex(([t]) => t === text)]!;
  const manual = (utteranceIds: string[], roundIds: string[] = []) =>
    createManualLearning(handle.db, f.mikoId, {
      duoId: f.duoId,
      kind: "other",
      text: "note",
      countries: [],
      regions: [],
      topics: [],
      utteranceIds,
      roundIds,
    });

  it("relates Games to the Session by relationship bounds, in the workbench and Stats alike", async () => {
    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const stats = await buildStatsPayload(handle.db, f.duoId);
    const statsGame = (id: string) => stats.games.find((g) => g.id === id)!;
    // (a) missing first start: no time-overlap link, no rating Session.
    expect(wb.gamesById[gameId.g4!]!.sessionIds).toEqual([]);
    expect(statsGame(gameId.g4!)).toMatchObject({ sessionIds: [], ratingSessionId: null });
    // (b) and (c): a missing middle start, and a trailing Round missing start and end (stored end in 1970).
    for (const key of ["g3", "g5"]) {
      expect(wb.gamesById[gameId[key]!]!.sessionIds).toEqual([f.sessionId]);
      expect(wb.gamesById[gameId[key]!]!.micCount).toBeGreaterThan(0);
      expect(statsGame(gameId[key]!)).toMatchObject({ sessionIds: [f.sessionId], ratingSessionId: f.sessionId });
    }
    const stored = await handle.db.query.games.findFirst({ where: eq(games.id, gameId.g5!) });
    expect(stored!.endedAt.getUTCFullYear()).toBe(1970);
    const session = wb.sessions.find((s) => s.id === f.sessionId)!;
    expect(session.gameIds).toEqual(expect.arrayContaining([gameId.g3, gameId.g5, gameId.g6]));
    expect(session.gameIds).not.toContain(gameId.g4);
  });

  it("stops a Round's window at its own end before a missing-start successor (both boundaries)", async () => {
    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const g3 = wb.gamesById[gameId.g3!]!;
    const [r1, r2, r3] = g3.roundIds.map((id) => wb.roundsById[id]!).sort((a, b) => a.roundNumber - b.roundNumber);
    expect(r1!.utteranceIds).toEqual([utt("g3 round one").id, utt("just before R1 ends").id]);
    expect(r2!.utteranceIds).toEqual([]);
    expect(r3!.utteranceIds).toEqual([utt("g3 final round").id]);
    // Gap speech is Session-level and never takes the debrief fallback.
    for (const text of ["at R1's own end", "in the gap"]) {
      const id = await manual([utt(text).id]);
      const l = (await buildWorkbenchData(handle.db, f.duoId, f.mikoId)).learnings.find((x) => x.id === id)!;
      expect(l).toMatchObject({ roundIds: [], isDebrief: false, sessionIds: [f.sessionId] });
    }
  });

  it("debriefs the final Round within 2 minutes; speech in the next Game's Round is that Round's", async () => {
    const debrief = await manual([utt("debrief of g3").id]);
    const next = await manual([utt("g6 first round").id]);
    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const g3Final = wb.gamesById[gameId.g3!]!.roundIds.map((id) => wb.roundsById[id]!).find((r) => r.roundNumber === 3)!;
    expect(wb.learnings.find((l) => l.id === debrief)).toMatchObject({ roundIds: [g3Final.id], isDebrief: true });
    const g6Round = wb.gamesById[gameId.g6!]!.roundIds[0];
    expect(wb.learnings.find((l) => l.id === next)).toMatchObject({ roundIds: [g6Round], isDebrief: false });
  });

  it("links a Session overlapping only the 15 s tail by citation, never by time", async () => {
    // A Recording in another Session covers only duel_2's final results tail (19:12:40-19:12:55).
    const late = uuidv7();
    await handle.db.insert(sessions).values({ id: late, duoId: f.duoId });
    await handle.db.insert(recordings).values({
      id: uuidv7(),
      duoId: f.duoId,
      playerId: f.soraId,
      sessionId: late,
      startedAt: at("19:12:45"),
      stoppedAt: at("19:12:54"),
      companionVersion: "0.1.0",
      clockAnchorMs: at("19:12:45").getTime(),
    });
    const stats = await buildStatsPayload(handle.db, f.duoId);
    const duel2 = stats.games.find((g) => g.id === f.gameIds[1])!;
    expect(duel2.sessionIds).toEqual([f.sessionId]);
  });

  it("gives a Game's rating delta to one Session by greatest overlap (ADR 0008)", async () => {
    const duel1 = f.gameIds[0]!;
    await handle.db.update(games).set({ duoRatingBefore: 1000, duoRatingAfter: 1020 }).where(eq(games.id, duel1));
    const other = uuidv7();
    await handle.db.insert(sessions).values({ id: other, duoId: f.duoId });
    await handle.db.insert(recordings).values({
      id: uuidv7(),
      duoId: f.duoId,
      playerId: f.soraId,
      sessionId: other,
      startedAt: at("19:01:30"),
      stoppedAt: at("19:02:00"),
      companionVersion: "0.1.0",
      clockAnchorMs: at("19:01:30").getTime(),
    });
    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    expect(wb.gamesById[duel1]!.sessionIds.sort()).toEqual([f.sessionId, other].sort());
    const stats = await buildStatsPayload(handle.db, f.duoId);
    expect(stats.games.find((g) => g.id === duel1)).toMatchObject({ ratingSessionId: f.sessionId });
    expect(wb.sessions.find((s) => s.id === f.sessionId)!.ratingDelta).toBe(20);
    expect(wb.sessions.find((s) => s.id === other)?.ratingDelta ?? 0).toBe(0);
  });

  it("attributes a Manual Learning to every Session its citations imply, and an uncited one to none", async () => {
    const s2 = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("22:00:00"), minutes: 5 });
    const both = await manual([s2.u[0]!.id], [f.roundIds[0]!]);
    const none = await manual([]);
    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    expect(wb.learnings.find((l) => l.id === both)!.sessionIds.sort()).toEqual([f.sessionId, s2.sessionId].sort());
    expect(wb.learnings.find((l) => l.id === none)!.sessionIds).toEqual([]);
  });

  it("resolves citations of a replaced Transcript version as historical speech outside the timeline", async () => {
    const run = await insertRun(handle, f, { range: [at("19:00:00"), at("19:30:00")], startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const [learning] = await addLearnings(handle, f, run, [{ text: "Split", u: [f.u[0]!] }]);
    const v2 = uuidv7();
    await startRetranscription(handle.db, f.mikoId, { transcriptVersionId: v2, recordingId: f.recordingId, model: "v2", transcriberSettings: {}, hotwordsUsed: [] });
    await uploadTranscriptChunk(handle.db, f.mikoId, v2, {
      recordingId: f.recordingId,
      chunkNo: 0,
      utterances: [{ text: "Retranscribed line", startSampleMs: 70_000, endSampleMs: 72_000, words: [], avgLogprob: -0.1 }],
    });
    await completeTranscriptVersion(handle.db, f.mikoId, v2, { totalChunks: 1 });

    const wb = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const old = wb.utterancesById[f.u[0]!.id]!;
    expect(old).toMatchObject({ historical: true, rawText: "You go Spain, I'll go Portugal" });
    expect(wb.utterances.some((u) => u.id === f.u[0]!.id)).toBe(false);
    const l = wb.learnings.find((x) => x.id === learning)!;
    expect(l.utteranceIds).toEqual([f.u[0]!.id]);
    expect(l.roundIds).toEqual([f.roundIds[0]]);
    // Staleness stays work-range derived: the retranscribed range is stale, so the Learning is.
    expect(old.rangeStatusByPurpose.extract).toBe("stale");
    expect(l.isStale).toBe(true);
  });

  it("admits a zero-length Round at the inclusive start and never an adjacent Round ending there", async () => {
    await upsertRawGame(
      handle.db,
      { duoId: f.duoId, geoguessrGameId: "edge", fetchedAt: "2026-11-20T19:50:00.000Z", rawDuel: customDuel("edge", "team_f", [[1, "19:40:00", "19:40:40"], [2, "19:41:00", null]]) },
      fixtureGeocoder,
    );
    for (const kind of ["full", "guessing"] as const) {
      const rows = await loadRoundsInSpan(handle.db, f.duoId, { startedAt: at("19:41:00"), endedAt: at("19:45:00") }, kind);
      expect(rows.map((x) => x.round.roundNumber)).toEqual([2]);
    }
  });

  it("read_range admits Games through valid Rounds and keeps HP from the Game's start", async () => {
    const run = await startProcessingRun(handle.db, {
      duoId: f.duoId,
      sessionId: f.sessionId,
      startedByPlayerId: f.mikoId,
      purpose: "extract",
      agent: "claude",
      model: "test",
      promptVersion: "v1",
      rangeStart: at("19:02:30"),
      rangeEnd: at("19:05:00"),
    });
    const out = (await mcpReadRange(handle.db, f.mikoId, run.id)) as { transcript: string };
    const round3 = out.transcript.split("\n").find((line) => line.startsWith("--- Round 3"))!;
    const opp = Number(/Opp (\d+)/.exec(round3)![1]);
    expect(opp).toBeLessThan(6000);
    await finishProcessingRun(handle.db, run.id);

    const late = await startProcessingRun(handle.db, {
      duoId: f.duoId,
      sessionId: f.sessionId,
      startedByPlayerId: f.mikoId,
      purpose: "extract",
      agent: "claude",
      model: "test",
      promptVersion: "v1",
      rangeStart: at("19:26:50"),
      rangeEnd: at("19:29:00"),
    });
    const lateOut = (await mcpReadRange(handle.db, f.mikoId, late.id)) as { transcript: string };
    expect(lateOut.transcript).toContain("=== GAME g4");
    expect(lateOut.transcript).toContain("=== GAME g5");
    expect(lateOut.transcript).not.toContain("=== GAME g3");
  });
});
