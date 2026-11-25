import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { buildWorkbenchData } from "../view-model.js";
import { reviewRounds, reviewView } from "../review-view.js";
import { addLearnings, at, insertRun, seedSessionFixture, type SessionFixture } from "./session-fixture.js";

// speech: "cited" loads only cited speech; Learnings and everything but Round speech derive exactly as with all speech.
describe("buildWorkbenchData speech: cited", () => {
  let handle: TestDbHandle;
  let f: SessionFixture;

  beforeEach(async () => {
    handle = await createTestDb();
    f = await seedSessionFixture(handle);
    const run = await insertRun(handle, f, { range: [at("19:00:00"), at("19:30:00")], startedAt: at("19:31:00"), finishedAt: at("19:32:00") });
    await addLearnings(handle, f, run, [{ text: "Bollards", u: [f.u[1]!, f.u[2]!] }]);
  });
  afterEach(async () => {
    await handle.close();
  });

  it("derives the same Learnings, Sessions and Games and keeps only cited speech", async () => {
    const all = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const cited = await buildWorkbenchData(handle.db, f.duoId, f.mikoId, { speech: "cited" });
    expect(cited.learnings).toEqual(all.learnings);
    expect(cited.sessions).toEqual(all.sessions);
    expect(cited.gamesById).toEqual(all.gamesById);
    expect(cited.countryDossiers).toEqual(all.countryDossiers);
    expect(Object.keys(cited.utterancesById).sort()).toEqual([f.u[1]!.id, f.u[2]!.id].sort());
    for (const id of Object.keys(cited.utterancesById)) expect(cited.utterancesById[id]).toEqual(all.utterancesById[id]);
    expect(all.utterances.length).toBeGreaterThan(2);
  });

  it("Review ships no Round speech and fetches full Rounds with their speech on demand", async () => {
    const all = await buildWorkbenchData(handle.db, f.duoId, f.mikoId);
    const view = reviewView(await buildWorkbenchData(handle.db, f.duoId, f.mikoId, { speech: "cited" }));
    expect(view.utterances).toEqual([]);
    expect(Object.values(view.roundsById).every((r) => r.utteranceIds.length === 0 && r.guesses.length === 0)).toBe(true);
    const roundId = f.roundIds[0]!;
    const detail = reviewRounds(all, [roundId, "missing"]);
    expect(Object.keys(detail.roundsById)).toEqual([roundId]);
    expect(detail.roundsById[roundId]).toEqual(all.roundsById[roundId]);
    expect(Object.keys(detail.utterancesById).sort()).toEqual([...all.roundsById[roundId]!.utteranceIds].sort());
    expect(all.roundsById[roundId]!.utteranceIds.length).toBeGreaterThan(0);
  });
});
