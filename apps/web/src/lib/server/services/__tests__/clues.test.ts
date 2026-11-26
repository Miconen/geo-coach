import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimClues, clues, duoMemberships, duos, games, players, processingRuns, roundClues, rounds, sessions } from "../../db/schema.js";
import {
  clueResolver,
  deriveCurrentRoundClues,
  insertClaim,
  insertRunRoundClues,
  listDuoClues,
  loadClaimTaggingQueue,
  mergeClues,
  renameClue,
  replaceClaimClues,
  seedDuoClues,
  updateClaim,
  type ClueVocabulary,
} from "../index.js";

const VOCAB: ClueVocabulary = {
  version: "test",
  families: [
    { family: "Road lines", seeds: ["Yellow/orange centre line", "White centre line"] },
    { family: "Poles", seeds: ["Wooden pole"] },
  ],
};
const at = (hms: string) => new Date(`2026-11-20T${hms}.000Z`);

describe("Clue records and links (#89)", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let playerId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    playerId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" });
    await handle.db.insert(players).values({ id: playerId, discordId: "d_miko", displayName: "Miko" });
    await handle.db.insert(duoMemberships).values({ duoId, playerId });
  });
  afterEach(async () => handle.close());

  const claim = (text: string) =>
    insertClaim(handle.db, { duoId, runId: null, createdByPlayerId: playerId, text, countries: ["NO"], regions: [], topics: [] });

  it("seeds a Duo's Clues once, and reuses them before creating new ones inside a family", async () => {
    expect(await seedDuoClues(handle.db, duoId, VOCAB)).toBe(3);
    expect(await seedDuoClues(handle.db, duoId, VOCAB)).toBe(0);

    const r = await clueResolver(handle.db, duoId, VOCAB);
    const reused = await r.resolve({ family: "road LINES", name: "yellow/orange centre line" });
    expect("error" in reused ? null : reused.name).toBe("Yellow/orange centre line");
    const made = await r.resolve({ family: "Poles", name: "Concrete pole with holes" });
    expect("error" in made ? null : made.origin).toBe("agent");
    expect(await r.resolve({ family: "Weather", name: "Fog" })).toEqual({ error: expect.stringContaining("not a Clue family") });
    expect(r.created.map((c) => c.name)).toEqual(["Concrete pole with holes"]);
  });

  it("renames a Clue, and refuses a name its family already has", async () => {
    await seedDuoClues(handle.db, duoId, VOCAB);
    const [white, yellow] = await handle.db.query.clues.findMany({ where: eq(clues.family, "Road lines"), orderBy: [asc(clues.name)] });
    expect((await renameClue(handle.db, duoId, white!.id, "White middle line")).name).toBe("White middle line");
    await expect(renameClue(handle.db, duoId, white!.id, yellow!.name)).rejects.toThrow(/merge/);
  });

  it("merges two Clues: every link moves, a clashing link keeps the target's, and the source goes", async () => {
    await seedDuoClues(handle.db, duoId, VOCAB);
    const [white, yellow] = await handle.db.query.clues.findMany({ where: eq(clues.family, "Road lines"), orderBy: [asc(clues.name)] });
    const a = await claim("Norway has yellow centre lines.");
    const b = await claim("Norway's centre lines are white-ish yellow.");
    const mark = { promptVersion: "v1", taggedAt: new Date() };
    await replaceClaimClues(handle.db, duoId, a, [{ clueId: yellow!.id, country: "NO", prevalence: "typical" }], mark);
    await replaceClaimClues(
      handle.db,
      duoId,
      b,
      [
        { clueId: white!.id, country: "NO", prevalence: "some" },
        { clueId: white!.id, country: "SE", prevalence: "typical" },
        { clueId: yellow!.id, country: "NO", prevalence: "lacks" },
      ],
      mark,
    );

    const moved = await mergeClues(handle.db, duoId, white!.id, yellow!.id);
    expect(moved.claimLinksMoved).toBe(1);
    const links = await handle.db.select().from(claimClues).orderBy(asc(claimClues.claimId), asc(claimClues.country));
    expect(links.map((l) => [l.claimId === a ? "a" : "b", l.clueId === yellow!.id, l.country, l.prevalence])).toEqual([
      ["a", true, "NO", "typical"],
      ["b", true, "NO", "lacks"],
      ["b", true, "SE", "typical"],
    ]);
    expect((await listDuoClues(handle.db, duoId)).map((c) => c.name)).not.toContain("White centre line");
  });

  it("tagging a Claim again replaces its links and leaves other Claims' links alone", async () => {
    await seedDuoClues(handle.db, duoId, VOCAB);
    const [white, yellow] = await handle.db.query.clues.findMany({ where: eq(clues.family, "Road lines"), orderBy: [asc(clues.name)] });
    const a = await claim("a");
    const b = await claim("b");
    const mark = { promptVersion: "v1", taggedAt: new Date() };
    await replaceClaimClues(handle.db, duoId, a, [{ clueId: yellow!.id, country: "NO", prevalence: "typical" }], mark);
    await replaceClaimClues(handle.db, duoId, b, [{ clueId: yellow!.id, country: "FI", prevalence: "some" }], mark);
    await replaceClaimClues(handle.db, duoId, a, [{ clueId: white!.id, country: "IS", prevalence: "typical" }], mark);

    const links = await handle.db.select().from(claimClues);
    expect(links.filter((l) => l.claimId === a).map((l) => [l.clueId, l.country])).toEqual([[white!.id, "IS"]]);
    expect(links.filter((l) => l.claimId === b).map((l) => [l.clueId, l.country])).toEqual([[yellow!.id, "FI"]]);
  });

  it("an edit puts a tagged Claim back in the queue, and so does a newer prompt version", async () => {
    const a = await claim("a");
    const b = await claim("b");
    const taggedAt = new Date(Date.now() - 60_000);
    await replaceClaimClues(handle.db, duoId, a, [], { promptVersion: "v1", taggedAt });
    await replaceClaimClues(handle.db, duoId, b, [], { promptVersion: "v1", taggedAt });
    expect(await loadClaimTaggingQueue(handle.db, duoId, "v1")).toEqual([]);

    await updateClaim(handle.db, duoId, a, { text: "a, reworded" });
    expect(await loadClaimTaggingQueue(handle.db, duoId, "v1")).toEqual([a]);
    expect((await loadClaimTaggingQueue(handle.db, duoId, "v2")).sort()).toEqual([a, b].sort());
  });

  describe("Round Clues from clues runs", () => {
    let sessionId: string;
    let r1: string;
    let r2: string;
    let yellowId: string;
    let whiteId: string;

    async function run(start: string, end: string, finished: string | null) {
      const id = uuidv7();
      await handle.db.insert(processingRuns).values({
        id,
        duoId,
        sessionId,
        startedByPlayerId: playerId,
        purpose: "clues",
        agent: "test",
        model: "test",
        promptVersion: "clues-v2",
        rangeStart: at(start),
        rangeEnd: at(end),
        status: finished ? "finished" : "open",
        finishedAt: finished ? at(finished) : null,
      });
      return id;
    }

    beforeEach(async () => {
      sessionId = uuidv7();
      await handle.db.insert(sessions).values({ id: sessionId, duoId });
      const gameId = uuidv7();
      await handle.db.insert(games).values({
        id: gameId,
        duoId,
        geoguessrGameId: "g1",
        rawDuel: {},
        fetchedAt: at("20:00:00"),
        startedAt: at("19:00:00"),
        endedAt: at("19:20:00"),
      });
      r1 = uuidv7();
      r2 = uuidv7();
      const roundRow = (id: string, n: number, start: string, end: string, results: string) => ({
        id,
        gameId,
        duoId,
        roundNumber: n,
        startTime: at(start),
        endTime: at(end),
        resultsEndTime: at(results),
      });
      await handle.db.insert(rounds).values([roundRow(r1, 1, "19:00:00", "19:02:00", "19:02:20"), roundRow(r2, 2, "19:03:00", "19:05:00", "19:05:20")]);
      await seedDuoClues(handle.db, duoId, VOCAB);
      const rl = await handle.db.query.clues.findMany({ where: eq(clues.family, "Road lines"), orderBy: [asc(clues.name)] });
      whiteId = rl[0]!.id;
      yellowId = rl[1]!.id;
    });

    it("a later clues run replaces only earlier clues links for its part of the Session", async () => {
      const whole = await run("19:00:00", "19:06:00", "20:00:00");
      await insertRunRoundClues(handle.db, whole, duoId, [
        { roundId: r1, clues: [{ clueId: yellowId, polarity: "seen", note: null, utteranceIds: [] }] },
        { roundId: r2, clues: [{ clueId: whiteId, polarity: "seen", note: null, utteranceIds: [] }] },
      ]);
      // A later run over Round 1's part only, which found nothing there.
      await run("18:59:00", "19:02:30", "21:00:00");
      // An open run never takes effect.
      const open = await run("19:02:30", "19:06:00", null);
      await insertRunRoundClues(handle.db, open, duoId, [{ roundId: r2, clues: [{ clueId: yellowId, polarity: "seen", note: null, utteranceIds: [] }] }]);

      const current = await deriveCurrentRoundClues(handle.db, duoId, [r1, r2]);
      expect(current.get(r1)).toBeUndefined();
      expect(current.get(r2)?.map((c) => c.clueId)).toEqual([whiteId]);
    });

    it("saying a Round again in one run replaces that run's earlier Clues for it", async () => {
      const id = await run("19:00:00", "19:06:00", "20:00:00");
      await insertRunRoundClues(handle.db, id, duoId, [{ roundId: r1, clues: [{ clueId: yellowId, polarity: "seen", note: null, utteranceIds: [] }] }]);
      await insertRunRoundClues(handle.db, id, duoId, [{ roundId: r1, clues: [{ clueId: whiteId, polarity: "seen", note: "white", utteranceIds: [] }] }]);
      expect((await handle.db.select().from(roundClues)).map((l) => l.clueId)).toEqual([whiteId]);
    });
  });
});
