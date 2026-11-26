import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { upsertRawGame } from "../../services/index.js";
import { clearWorkbenchCache, loadWorkbench } from "../../workbench/cache.js";
import { buildWorkbenchData } from "../../workbench/view-model.js";
import { fixtureGeocoder, rawDuel, seedSessionFixture, type SessionFixture } from "../../workbench/__tests__/session-fixture.js";
import { loadGamePayload, loadGameSpeech, loadRoundPayload, loadRoundSpeech, loadSessionPayload } from "../index.js";

// #82: the Game and Round pages are the Session page's debrief (#79) scoped to one Game or one Round.
describe("Game and Round page debriefs", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;

  beforeEach(async () => {
    clearWorkbenchCache();
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
  });
  afterEach(async () => {
    clearWorkbenchCache();
    await handle.close();
  });

  /** The speech an all-speech derivation shows in a Round's transcript (what the Session page shows). */
  async function fullTranscript(roundId: string) {
    const all = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    return all.roundsById[roundId]!.utteranceIds.filter((id) => !all.utterancesById[id]!.historical);
  }

  it("a Game page shows only that Game, numbered as on its Session page, with every Round's full speech", async () => {
    const session = (await loadSessionPayload(handle.db, f.duoId, f.mikoId, f.sessionId, null))!;
    for (const gameId of f.gameIds) {
      const p = (await loadGamePayload(handle.db, f.duoId, f.mikoId, gameId))!;
      expect(p.debrief.games.map((g) => g.id)).toEqual([gameId]);
      expect(p.debrief.rounds.every((r) => r.gameId === gameId)).toBe(true);
      expect(p.debrief.games[0]!.number).toBe(session.debrief.games.find((g) => g.id === gameId)!.number);
      expect(p.debrief.recorded).toBe(true);
      expect(p.homeSession?.id).toBe(f.sessionId);
      for (const r of p.debrief.rounds) expect(r.transcript.map((l) => l.id)).toEqual(await fullTranscript(r.id));
    }
    // The fixture's first Round has speech, so the check above isn't vacuous.
    const first = (await loadGamePayload(handle.db, f.duoId, f.mikoId, f.gameIds[0]!))!;
    expect(first.debrief.rounds[0]!.transcript.length).toBeGreaterThan(0);
  });

  it("a Round page carries its Game's debrief with that Round's full speech", async () => {
    const roundId = f.roundIds[0]!;
    const p = (await loadRoundPayload(handle.db, f.duoId, f.mikoId, roundId))!;
    expect(p.debrief.games.map((g) => g.id)).toEqual([f.gameIds[0]]);
    expect(p.debrief.rounds.map((r) => r.id)).toEqual(f.roundIds.slice(0, 3));
    const round = p.debrief.rounds.find((r) => r.id === roundId)!;
    expect(round.transcript.map((l) => l.id)).toEqual(await fullTranscript(roundId));
    expect(round.hpBefore).toBeDefined();
  });

  it("names no Opponent team", async () => {
    const game = (await loadGamePayload(handle.db, f.duoId, f.mikoId, f.gameIds[0]!))!;
    const round = (await loadRoundPayload(handle.db, f.duoId, f.mikoId, f.roundIds[0]!))!;
    for (const p of [game, round]) {
      expect(p.game.opponentTeamName).toBeNull();
      expect(Object.values(p.wb.gamesById).every((g) => g.opponentTeamName === null)).toBe(true);
      expect(JSON.stringify(p)).not.toContain('"Opp"');
    }
  });

  it("a Game no one recorded has no Session, is numbered within its day, and says it wasn't recorded", async () => {
    await upsertRawGame(
      handle.db,
      {
        duoId: f.duoId,
        geoguessrGameId: "f_duel_unrecorded",
        fetchedAt: "2026-11-21T19:20:00.000Z",
        rawDuel: rawDuel("f_duel_unrecorded", "team_f", ["19:01:00", "19:02:00", "19:03:00"], "2026-11-21"),
      },
      fixtureGeocoder,
    );
    clearWorkbenchCache();
    const wb = await loadWorkbench(handle.db, f.duoId, f.mikoId, { speech: "cited" });
    const gameId = Object.keys(wb.gamesById).find((id) => !f.gameIds.includes(id))!;
    const p = (await loadGamePayload(handle.db, f.duoId, f.mikoId, gameId))!;
    expect(p.homeSession).toBeNull();
    expect(p.debrief.recorded).toBe(false);
    expect(p.debrief.games[0]!.number).toBe(1);
    expect(p.debrief.rounds).toHaveLength(3);
    expect(p.debrief.rounds.every((r) => r.transcript.length === 0)).toBe(true);
  });

  it("loadGameSpeech holds, for each Round, exactly what loadRoundSpeech loads for it", async () => {
    const wb = await loadWorkbench(handle.db, f.duoId, f.mikoId, { speech: "cited" });
    const bySpeech = await loadGameSpeech(handle.db, f.duoId, f.gameIds[0]!, wb);
    expect(bySpeech.size).toBeGreaterThan(0);
    for (const roundId of f.roundIds.slice(0, 3)) {
      const one = await loadRoundSpeech(handle.db, f.duoId, roundId, wb);
      expect(bySpeech.get(roundId) ?? { utteranceIds: [], utterancesById: {} }).toEqual(one);
    }
  });
});
