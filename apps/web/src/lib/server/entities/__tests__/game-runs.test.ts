import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimEvidence, claims } from "../../db/schema.js";
import {
  addLearnings,
  addRecording,
  at,
  insertRun,
  seedSessionFixture,
  type SessionFixture,
} from "../../workbench/__tests__/session-fixture.js";
import { loadGamePayload } from "../index.js";

// #56 2a(ii): which runs a Game lists, with run-wide and Game-scoped counts.

describe("Game run eligibility", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;
  let s2: { sessionId: string; u: Array<{ id: string; startedAt: Date; endedAt: Date }> };
  const FULL: [Date, Date] = [at("19:00:00"), at("19:30:00")];
  const DAY2: [Date, Date] = [at("19:00:00", "2026-11-21"), at("19:30:00", "2026-11-21")];

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
    // A second Session on another day: it overlaps no Game of the fixture.
    s2 = await addRecording(handle, { duoId: f.duoId, playerId: f.mikoId, start: DAY2[0], minutes: 30 });
  });
  afterEach(async () => {
    await handle.close();
  });

  const game1 = () => f.gameIds[0]!;
  const runsOf = async (gameId = game1()) => (await loadGamePayload(handle.db, f.duoId, f.mikoId, gameId))!.runs;
  const inS2 = () => ({ ...f, sessionId: s2.sessionId });

  it("lists overlap runs and explicit cross-Session citations, never uncited cross-Session runs", async () => {
    const overlapRun = await insertRun(handle, f, { range: FULL, startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    const cited = await insertRun(handle, inS2(), { range: DAY2, startedAt: at("19:31:00", "2026-11-21"), finishedAt: at("19:32:00", "2026-11-21") });
    await addLearnings(handle, f, cited, [
      { text: "Cites Game 1", u: [s2.u[0]!], roundIds: [f.roundIds[0]!] },
      { text: "No Game link", u: [s2.u[1]!] },
    ]);
    // Another purpose, so it supersedes nothing of the cited run.
    const uncited = await insertRun(handle, inS2(), {
      purpose: "tips",
      range: DAY2,
      startedAt: at("19:33:00", "2026-11-21"),
      finishedAt: at("19:34:00", "2026-11-21"),
    });
    await addLearnings(handle, f, uncited, [{ text: "Unrelated", u: [s2.u[2]!] }], "tips");

    const runs = await runsOf();
    const ids = runs.map((r) => r.row.runId);
    expect(ids).toContain(overlapRun);
    expect(ids).toContain(cited);
    expect(ids).not.toContain(uncited);
    const c = runs.find((r) => r.row.runId === cited)!;
    expect(c.reasons).toEqual(["round-citation"]);
    expect(c.sessionId).toBe(s2.sessionId);
    // Run-wide counts both Learnings; Game-scoped only the one on this Game's Round.
    expect(c.row.learnings).toEqual({ current: 2, surviving: 2 });
    expect(c.game.learnings).toEqual({ current: 1, surviving: 1 });
    expect(runs.find((r) => r.row.runId === overlapRun)!.reasons).toContain("session-overlap");
    // The other Game of the Session does not list the cross-Session citation.
    expect((await runsOf(f.gameIds[1]!)).map((r) => r.row.runId)).not.toContain(cited);
  });

  it("admits Evidence-only runs and counts Claims by Evidence, once per Claim", async () => {
    const runA = await insertRun(handle, inS2(), { range: DAY2, startedAt: at("19:31:00", "2026-11-21"), finishedAt: at("19:32:00", "2026-11-21") });
    const runB = await insertRun(handle, inS2(), { range: DAY2, startedAt: at("19:35:00", "2026-11-21"), finishedAt: at("19:36:00", "2026-11-21") });
    const claimByA = uuidv7();
    const twoRounds = uuidv7();
    await handle.db.insert(claims).values([
      { id: claimByA, duoId: f.duoId, runId: runA, text: "Claim by run A" },
      { id: twoRounds, duoId: f.duoId, runId: runB, text: "Cites two Rounds" },
    ]);
    await handle.db.insert(claimEvidence).values([
      // Run B gives Round Evidence to run A's Claim: B counts it as existing with new Evidence; A has none here.
      { id: uuidv7(), claimId: claimByA, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[0], runId: runB },
      // One Claim citing two Rounds of the Game counts once.
      { id: uuidv7(), claimId: twoRounds, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[0], runId: runB },
      { id: uuidv7(), claimId: twoRounds, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[1], runId: runB },
    ]);
    const runs = await runsOf();
    expect(runs.map((r) => r.row.runId)).not.toContain(runA);
    const b = runs.find((r) => r.row.runId === runB)!;
    expect(b.evidenceOnly).toBe(true);
    expect(b.game).toMatchObject({ claimsCreated: 1, claimsWithNewEvidence: 1 });
    expect(b.row).toMatchObject({ claimsCreated: 1, claimsWithNewEvidence: 1 });
  });

  it("never qualifies a Game through mismatched Evidence", async () => {
    const other = await seedSessionFixture(handle, { tag: "other", teamId: "team_other" });
    const run = await insertRun(handle, inS2(), { range: DAY2, startedAt: at("19:31:00", "2026-11-21"), finishedAt: at("19:32:00", "2026-11-21") });
    const foreignClaim = uuidv7();
    await handle.db.insert(claims).values({ id: foreignClaim, duoId: other.duoId, runId: null, text: "Another Duo's Claim" });
    // Evidence stored under this Duo but on another Duo's Claim, and Evidence of another Duo on this Game's Round.
    await handle.db.insert(claimEvidence).values([
      { id: uuidv7(), claimId: foreignClaim, duoId: f.duoId, kind: "round", direction: "for", roundId: f.roundIds[0], runId: run },
      { id: uuidv7(), claimId: foreignClaim, duoId: other.duoId, kind: "round", direction: "for", roundId: f.roundIds[1], runId: run },
    ]);
    expect((await runsOf()).map((r) => r.row.runId)).not.toContain(run);
  });
});
