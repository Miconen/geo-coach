import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players, rounds } from "../../db/schema.js";
import {
  completeTranscriptVersion,
  deriveClaims,
  deriveLearningsWithStatus,
  insertClaim,
  setPlayerEvidence,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";
import {
  mcpAddClaims,
  mcpAddLearnings,
  mcpFinishRun,
  mcpGetInstructions,
  mcpReadRange,
  mcpSearchClaims,
  mcpStartRun,
} from "../workflow.js";

const at = (hms: string) => `2026-11-20T${hms}.000Z`;

describe("knowledge bank: Claims, Evidence and MCP tools (#46)", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let otherDuoId: string;
  let mikoId: string;
  let soraId: string;
  let sessionId: string;
  let bgRoundId: string;

  const RANGE = { startUtc: at("19:01:30"), endUtc: at("19:05:00") };

  async function startExtract(range = RANGE) {
    return mcpStartRun(handle.db, mikoId, {
      sessionId,
      ...range,
      purpose: "extract",
      agent: "claude",
      model: "claude-opus",
    });
  }

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    otherDuoId = uuidv7();
    mikoId = uuidv7();
    soraId = uuidv7();

    await handle.db.insert(duos).values([
      { id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" },
      { id: otherDuoId, name: "Other Duo", geoguessrTeamId: "gg_team_other" },
    ]);
    await handle.db.insert(players).values([
      { id: mikoId, discordId: "d_miko", displayName: "Miko", geoguessrUserId: "gg_p1" },
      { id: soraId, discordId: "d_sora", displayName: "Sora", geoguessrUserId: "gg_p2" },
    ]);
    await handle.db.insert(duoMemberships).values([
      { duoId, playerId: mikoId },
      { duoId, playerId: soraId },
      { duoId: otherDuoId, playerId: soraId },
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
    await uploadTranscriptChunk(handle.db, mikoId, tvId, {
      recordingId: recId,
      chunkNo: 0,
      utterances: [
        {
          text: "Yellow top bollards, Bulgaria, and I think they have truck coverage too",
          startSampleMs: 185_000, // 19:03:05
          endSampleMs: 190_000,
          words: [],
          avgLogprob: -0.2,
        },
      ],
    });
    await completeTranscriptVersion(handle.db, mikoId, tvId, { totalChunks: 1 });
    await stopRecording(handle.db, mikoId, recId, {
      stoppedAt: new Date(anchor + 300_000).toISOString(),
      stopReason: "stop",
    });

    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "gg_duel_claims",
      fetchedAt: at("19:04:30"),
      rawDuel: {
        gameId: "gg_duel_claims",
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
                nick: "Miko",
                guesses: [
                  { roundNumber: 1, lat: 44.43, lng: 26.1, distance: 300_000, score: 3000, created: at("19:03:20") },
                ],
              },
            ],
          },
          { id: "gg_team_opp", name: "Opp", health: 5000, players: [] },
        ],
        rounds: [
          {
            roundNumber: 1,
            panorama: { panoId: "p1", lat: 42.69, lng: 25.32, countryCode: "bg" },
            startTime: at("19:03:00"),
            timerStartTime: at("19:03:20"),
            endTime: at("19:03:35"),
            damageMultiplier: 1,
          },
        ],
        result: { winningTeamId: "gg_team_duo" },
      },
    });
    const [bgRound] = await handle.db.select().from(rounds).where(eq(rounds.duoId, duoId));
    bgRoundId = bgRound!.id;
  });

  afterEach(async () => {
    await handle.close();
  });

  it("serves the v3 extract and tips prompts", async () => {
    const extract = await mcpGetInstructions("extract");
    const tips = await mcpGetInstructions("tips");
    expect(extract.promptVersion).toBe("extract-v3");
    expect(tips.promptVersion).toBe("tips-v3");
    expect(extract.instructions).toContain("search_claims");
    expect(tips.instructions).toContain("speculated");
    const run = await startExtract();
    expect(run.promptVersion).toBe("extract-v3");
  });

  it("lists the Duo's Claims for the range's countries in read_range, with status", async () => {
    const bollards = await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Bulgarian bollards have yellow tops.",
      countries: ["BG"],
      regions: [],
      topics: ["bollards"],
    });
    await setPlayerEvidence(handle.db, soraId, bollards, "for");
    await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Romania has Gen 4 coverage.",
      countries: ["RO"],
      regions: [],
      topics: [],
    });
    await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Panama has truck coverage.",
      countries: ["PA"],
      regions: [],
      topics: ["coverage"],
    });
    await insertClaim(handle.db, {
      duoId: otherDuoId,
      runId: null,
      createdByPlayerId: soraId,
      text: "Another Duo's Bulgaria Claim.",
      countries: ["BG"],
      regions: [],
      topics: [],
    });

    const run = await startExtract();
    const view = await mcpReadRange(handle.db, mikoId, run.runId);
    if (view.purpose === "calls") throw new Error("expected an extract range");
    // True country BG and the Duo's guess RO; PA appears nowhere
    expect(view.claimCountries).toEqual(["BG", "RO"]);
    expect(view.claims.map((c) => c.text).sort()).toEqual([
      "Bulgarian bollards have yellow tops.",
      "Romania has Gen 4 coverage.",
    ]);
    const bg = view.claims.find((c) => c.id === bollards)!;
    expect(bg.status).toBe("verified");
    expect(bg.evidence).toBe("Player 1✓ 0✗");
    expect(view.claims.find((c) => c.countries.includes("RO"))!.status).toBe("speculated");
  });

  it("filters search_claims by country, topic, status and text", async () => {
    const make = (text: string, countries: string[], topics: string[]) =>
      insertClaim(handle.db, { duoId, runId: null, createdByPlayerId: mikoId, text, countries, regions: [], topics });
    const bollards = await make("Bulgarian bollards have yellow tops.", ["BG"], ["bollards"]);
    await make("Panama has truck coverage.", ["PA"], ["coverage"]);
    await make("Bosnia might have truck coverage.", ["BA"], ["coverage"]);
    await setPlayerEvidence(handle.db, mikoId, bollards, "for");

    const ids = async (filters: Parameters<typeof mcpSearchClaims>[2]) =>
      (await mcpSearchClaims(handle.db, mikoId, filters)).claims.map((c) => c.text).sort();

    expect(await ids({ countries: ["BG"] })).toEqual(["Bulgarian bollards have yellow tops."]);
    expect(await ids({ topics: ["coverage"] })).toEqual([
      "Bosnia might have truck coverage.",
      "Panama has truck coverage.",
    ]);
    expect(await ids({ status: "verified" })).toEqual(["Bulgarian bollards have yellow tops."]);
    expect(await ids({ status: "speculated", query: "truck" })).toHaveLength(2);
    expect(await ids({ query: "panama" })).toEqual(["Panama has truck coverage."]);
    // A country name matches too, not only the code
    expect(await ids({ query: "bosnia and herzegovina" })).toEqual(["Bosnia might have truck coverage."]);
    // Sora's other Duo has none of these
    expect((await mcpSearchClaims(handle.db, soraId, { duo: otherDuoId })).total).toBe(0);
  });

  it("add_claims validates items, cites only in-range Rounds and saves valid items when others fail", async () => {
    const run = await startExtract();
    const res = await mcpAddClaims(handle.db, mikoId, {
      runId: run.runId,
      items: [
        {
          text: "Bulgarian bollards have yellow tops.",
          countries: ["BG"],
          topics: ["Bollards"],
          evidence: [{ kind: "round", roundId: bgRoundId }],
        },
        { text: "Bad country", countries: ["ZZ"] },
        { text: "Region outside countries", countries: ["BG"], regions: [{ country: "RO", name: "Cluj" }] },
        { text: "Round against", countries: ["BG"], evidence: [{ kind: "round", roundId: bgRoundId, direction: "against" }] },
        { text: "Round elsewhere", countries: ["BG"], evidence: [{ kind: "round", roundId: uuidv7() }] },
        { text: "Bulgaria might have truck coverage.", countries: ["BG"], topics: ["coverage"] },
      ],
    });
    expect(res.savedCount).toBe(2);
    expect(res.errors.map((e) => e.index)).toEqual([1, 2, 3, 4]);
    expect(res.errors[2]!.message).toMatch(/Round only ever counts for/);
    expect(res.errors[3]!.message).toMatch(/not inside this run's range/);

    const claims = await deriveClaims(handle.db, duoId);
    const bollards = claims.find((c) => c.text.startsWith("Bulgarian bollards"))!;
    expect(bollards.status).toBe("verified");
    expect(bollards.topics).toEqual(["bollards"]);
    expect(bollards.runId).toBe(run.runId);
    expect(bollards.evidence).toMatchObject([{ kind: "round", direction: "for", roundId: bgRoundId, runId: run.runId }]);
    expect(claims.find((c) => c.text.includes("truck"))!.status).toBe("speculated");

    // Citing the same Round again for an existing Claim adds nothing
    const again = await mcpAddClaims(handle.db, mikoId, {
      runId: run.runId,
      items: [{ claimId: bollards.id, evidence: [{ kind: "round", roundId: bgRoundId }] }],
    });
    expect(again.saved).toEqual([{ index: 0, claimId: bollards.id, created: false, evidenceAdded: 0 }]);

    // A run whose range doesn't cover the Round can't cite it; nor can a call without a run
    await mcpFinishRun(handle.db, mikoId, run.runId);
    const later = await startExtract({ startUtc: at("19:04:00"), endUtc: at("19:05:00") });
    const outside = await mcpAddClaims(handle.db, mikoId, {
      runId: later.runId,
      items: [{ claimId: bollards.id, evidence: [{ kind: "round", roundId: bgRoundId }] }],
    });
    expect(outside.errors[0]!.message).toMatch(/not inside this run's range/);
    const noRun = await mcpAddClaims(handle.db, mikoId, {
      items: [{ claimId: bollards.id, evidence: [{ kind: "round", roundId: bgRoundId }] }],
    });
    expect(noRun.errors[0]!.message).toMatch(/needs a runId/);

    // Another Duo's Claim is unknown here
    const foreign = await insertClaim(handle.db, {
      duoId: otherDuoId,
      runId: null,
      createdByPlayerId: soraId,
      text: "x",
      countries: [],
      regions: [],
      topics: [],
    });
    const cross = await mcpAddClaims(handle.db, mikoId, {
      runId: later.runId,
      items: [{ claimId: foreign, evidence: [{ kind: "round", roundId: bgRoundId }] }],
    });
    expect(cross.errors[0]!.message).toMatch(/other Duo's claimId/);
  });

  it("round-trips a Learning's claimId and refuses another Duo's Claim", async () => {
    const run = await startExtract();
    const { saved } = await mcpAddClaims(handle.db, mikoId, {
      runId: run.runId,
      items: [{ text: "Bulgarian bollards have yellow tops.", countries: ["BG"] }],
    });
    const claimId = saved[0]!.claimId;
    const foreign = await insertClaim(handle.db, {
      duoId: otherDuoId,
      runId: null,
      createdByPlayerId: soraId,
      text: "x",
      countries: [],
      regions: [],
      topics: [],
    });

    const res = await mcpAddLearnings(handle.db, mikoId, run.runId, [
      { kind: "clue", text: "Yellow-top bollards point to Bulgaria.", countries: ["BG"], utteranceRefs: ["u1"], claimId },
      { kind: "clue", text: "Foreign Claim", countries: ["BG"], utteranceRefs: ["u1"], claimId: foreign },
      { kind: "strategy", text: "Strategy with a Claim", utteranceRefs: ["u1"], claimId },
    ]);
    expect(res.savedCount).toBe(1);
    expect(res.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(res.errors[0]!.message).toMatch(/other Duo's claimId/);
    await mcpFinishRun(handle.db, mikoId, run.runId);

    const [learning] = await deriveLearningsWithStatus(handle.db, duoId);
    expect(learning!.claimId).toBe(claimId);
    const [claim] = await deriveClaims(handle.db, duoId);
    expect(claim!.learningIds).toEqual([learning!.id]);

    const view = await mcpReadRange(handle.db, mikoId, (await startExtract()).runId);
    if (view.purpose === "calls") throw new Error("expected an extract range");
    expect(view.existingLearnings[0]!.claimId).toBe(claimId);
    expect(view.claims[0]!.learningCount).toBe(1);
  });

  it("backfills Claims by re-running extract over a processed range, keeping Claims when superseded", async () => {
    // An earlier run made a Learning with no Claim
    const old = await startExtract();
    await mcpAddLearnings(handle.db, mikoId, old.runId, [
      { kind: "clue", text: "Yellow-top bollards are Bulgarian.", countries: ["BG"], utteranceRefs: ["u1"] },
    ]);
    await mcpFinishRun(handle.db, mikoId, old.runId);

    // Re-running extract under v3 creates the Claims and linked Learnings
    const rerun = await startExtract();
    expect(rerun.promptVersion).toBe("extract-v3");
    const { saved } = await mcpAddClaims(handle.db, mikoId, {
      runId: rerun.runId,
      items: [
        { text: "Bulgarian bollards have yellow tops.", countries: ["BG"], evidence: [{ kind: "round", roundId: bgRoundId }] },
        { text: "Bulgaria might have truck coverage.", countries: ["BG"], topics: ["coverage"] },
      ],
    });
    await mcpAddLearnings(handle.db, mikoId, rerun.runId, [
      { kind: "clue", text: "Yellow-top bollards point to Bulgaria.", countries: ["BG"], utteranceRefs: ["u1"], claimId: saved[0]!.claimId },
      { kind: "clue", text: "Bulgaria may have truck coverage; unconfirmed.", countries: ["BG"], utteranceRefs: ["u1"], claimId: saved[1]!.claimId },
    ]);
    await mcpFinishRun(handle.db, mikoId, rerun.runId);

    const learnings = await deriveLearningsWithStatus(handle.db, duoId);
    const current = learnings.filter((l) => l.status === "current");
    expect(current.map((l) => l.claimId).sort()).toEqual([saved[0]!.claimId, saved[1]!.claimId].sort());
    expect(learnings.find((l) => l.runId === old.runId)!.status).toBe("superseded");
    expect((await deriveClaims(handle.db, duoId)).map((c) => c.status).sort()).toEqual(["speculated", "verified"]);

    // A later run supersedes the Learnings, but the Claims and their Evidence stay (ADR 0001)
    const third = await startExtract();
    await mcpFinishRun(handle.db, mikoId, third.runId);
    const after = await deriveLearningsWithStatus(handle.db, duoId);
    expect(after.filter((l) => l.status === "current")).toHaveLength(0);
    const claimsAfter = await deriveClaims(handle.db, duoId);
    expect(claimsAfter).toHaveLength(2);
    expect(claimsAfter.find((c) => c.id === saved[0]!.claimId)!.status).toBe("verified");
  });

  it("lets each Player set, change and withdraw only their own Evidence", async () => {
    const claimId = await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Bulgaria might have truck coverage.",
      countries: ["BG"],
      regions: [],
      topics: [],
    });
    const status = async () => (await deriveClaims(handle.db, duoId))[0]!.status;

    await setPlayerEvidence(handle.db, mikoId, claimId, "for");
    expect(await status()).toBe("verified");
    await setPlayerEvidence(handle.db, soraId, claimId, "against");
    expect(await status()).toBe("disputed");
    await setPlayerEvidence(handle.db, mikoId, claimId, "against");
    expect(await status()).toBe("disproved");
    // Miko withdrawing removes only Miko's Evidence
    await setPlayerEvidence(handle.db, mikoId, claimId, null);
    const [claim] = await deriveClaims(handle.db, duoId);
    expect(claim!.evidence).toMatchObject([{ kind: "player", playerId: soraId, direction: "against" }]);

    const outsiderId = uuidv7();
    await handle.db.insert(players).values({ id: outsiderId, discordId: "d_out", displayName: "Out" });
    await expect(setPlayerEvidence(handle.db, outsiderId, claimId, "for")).rejects.toThrow();
  });
});
