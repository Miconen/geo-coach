import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { addRecording, at, insertRun, seedSessionFixture, type SessionFixture } from "../../workbench/__tests__/session-fixture.js";
import { deriveSessionWorkRanges, deriveWorkRangesBySession } from "../processing.js";

// The batched derivation (one fixed set of queries for every Session) gives exactly the per-Session results.
describe("deriveWorkRangesBySession", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;
  let other: SessionFixture;
  let s2: string;

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
    other = await seedSessionFixture(handle, { tag: "other", teamId: "team_other" });
    s2 = (await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: at("19:00:00", "2026-11-21"), minutes: 30 })).sessionId;
    // A finished run over part of the first Session: part processed, part not.
    await insertRun(handle, f, { range: [at("19:00:00"), at("19:10:00")], startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
  });
  afterEach(async () => {
    await handle.close();
  });

  it("matches deriveSessionWorkRanges for every Session and purpose, and stays inside the Duo", async () => {
    const batched = await deriveWorkRangesBySession(handle.db, f.duoId, ["extract", "tips"] as const);
    expect([...batched.keys()].sort()).toEqual([f.sessionId, s2].sort());
    for (const sessionId of [f.sessionId, s2]) {
      for (const purpose of ["extract", "tips"] as const) {
        expect(batched.get(sessionId)![purpose], `${sessionId} ${purpose}`).toEqual(
          await deriveSessionWorkRanges(handle.db, f.duoId, sessionId, purpose),
        );
      }
    }
    expect(batched.get(f.sessionId)!.extract.length).toBeGreaterThan(0);
    // Another Duo's Session is never derived under this Duo.
    expect(batched.has(other.sessionId)).toBe(false);
    expect((await deriveWorkRangesBySession(handle.db, f.duoId, ["extract"] as const, [other.sessionId])).size).toBe(0);
  });
});
