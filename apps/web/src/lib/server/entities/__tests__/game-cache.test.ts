import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { clearWorkbenchCache, loadWorkbench } from "../../workbench/cache.js";
import * as viewModel from "../../workbench/view-model.js";
import {
  addLearnings,
  addRecording,
  at,
  insertRun,
  seedSessionFixture,
  type SessionFixture,
} from "../../workbench/__tests__/session-fixture.js";
import { loadGamePayload, loadGameRuns, loadRoundPayload } from "../index.js";

vi.mock("../../workbench/view-model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../workbench/view-model.js")>();
  return { ...actual, buildWorkbenchData: vi.fn(actual.buildWorkbenchData) };
});

// #72: the Game page reuses the Games list's cited-speech derivation; the Round page loads its own speech on demand.
describe("Game and Round pages on the shared cited-speech derivation", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;
  const build = vi.mocked(viewModel.buildWorkbenchData);

  beforeEach(async () => {
    clearWorkbenchCache();
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
    const run = await insertRun(handle, f, { range: [at("19:00:00"), at("19:30:00")], startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    await addLearnings(handle, f, run, [{ text: "Bollards", u: [f.u[1]!] }]);
    build.mockClear();
  });
  afterEach(async () => {
    clearWorkbenchCache();
    await handle.close();
  });

  it("opening a Game after the Games list derives nothing new", async () => {
    // The Games list's load.
    await loadWorkbench(handle.db, f.duoId, f.mikoId, { speech: "cited" });
    expect(build).toHaveBeenCalledTimes(1);
    const game = await loadGamePayload(handle.db, f.duoId, f.mikoId, f.gameIds[0]!);
    expect(game?.game.id).toBe(f.gameIds[0]);
    const round = await loadRoundPayload(handle.db, f.duoId, f.mikoId, f.roundIds[0]!);
    expect(round?.round.id).toBe(f.roundIds[0]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("the Round page shows the same full speech, uncited included, as the all-speech derivation", async () => {
    const all = await viewModel.buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    for (const roundId of f.roundIds) {
      const p = (await loadRoundPayload(handle.db, f.duoId, f.mikoId, roundId))!;
      const expected = all.roundsById[roundId]!;
      expect(p.round).toEqual(expected);
      expect(p.wb.roundsById[roundId]).toEqual(expected);
      for (const id of expected.utteranceIds) expect(p.wb.utterancesById[id]).toEqual(all.utterancesById[id]);
    }
    const first = all.roundsById[f.roundIds[0]!]!;
    // The fixture's first Round holds uncited speech, so the check above covers it.
    expect(first.utteranceIds.some((id) => all.utterancesById[id]!.citedByLearningIds.length === 0)).toBe(true);
  });

  it("loadGameRuns never queries every Processing run of the Duo", async () => {
    // A run in another Session, uncited: it must not be read at all.
    const s2 = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("19:00:00", "2026-11-21"), minutes: 30 });
    await insertRun(handle, { ...f, sessionId: s2.sessionId }, {
      range: [at("19:00:00", "2026-11-21"), at("19:30:00", "2026-11-21")],
      startedAt: at("19:31:00", "2026-11-21"),
      finishedAt: at("19:32:00", "2026-11-21"),
    });
    const wb = await loadWorkbench(handle.db, f.duoId, f.mikoId, { speech: "cited" });
    const game = wb.gamesById[f.gameIds[0]!]!;
    const query = vi.spyOn(handle.pglite, "query");
    const runs = await loadGameRuns(handle.db, f.duoId, game, wb);
    const runQueries = query.mock.calls.map((c) => String(c[0])).filter((q) => /from "processing_runs" where/.test(q));
    query.mockRestore();
    expect(runs.length).toBeGreaterThan(0);
    expect(runQueries.length).toBeGreaterThan(0);
    for (const q of runQueries) expect(q).toMatch(/"processing_runs"\."id" in|"range_start" <=/);
  });
});
