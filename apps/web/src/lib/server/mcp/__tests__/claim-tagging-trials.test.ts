import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimClueTrials, claimClues, claimTaggingJobs, claims, clues, duoMemberships, duos, players } from "../../db/schema.js";
import { insertClaim, replaceClaimClues } from "../../services/index.js";
import { loadProcessorConfig, parseClaudeUsage, pickJobModel } from "../../processor/worker.js";
import { mcpListClaimsToTag, mcpListClues, mcpTagClaims } from "../clue-tagging.js";
import { mcpPromoteClaimTaggingTrial } from "../claim-tagging-jobs.js";
import {
  claimNextProcessingJob,
  enqueueClaimTagging,
  finishProcessingJob,
  startClaimTagging,
  verifyProcessingJobToken,
  type ProcessingJobScope,
} from "../processing-jobs.js";
import { createGeoCoachMcpServer } from "../server.js";

type TagScope = Extract<ProcessingJobScope, { kind: "tag-claims" }>;
const RESULT = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../processor/__tests__/claude-result.json"),
  "utf8",
);

describe("Claim tagging trials (#94)", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;
  let claimIds: string[];

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" });
    await handle.db.insert(players).values({ id: mikoId, discordId: "d_miko", displayName: "Miko" });
    await handle.db.insert(duoMemberships).values({ duoId, playerId: mikoId });
    claimIds = [];
    for (const text of [
      "Norway has yellow centre lines.",
      "Madagascar has both white and yellow centre lines.",
      "In Ghana a solid or double solid white line means no overtaking.",
    ]) {
      claimIds.push(await insertClaim(handle.db, { duoId, runId: null, createdByPlayerId: mikoId, text, countries: [], regions: [], topics: [] }));
    }
    await mcpListClues(handle.db, mikoId, {});
  });
  afterEach(async () => handle.close());

  async function claimTagJob(): Promise<{ scope: TagScope; jobId: string; model: string | null }> {
    const claimed = await claimNextProcessingJob(handle.db, "test-model");
    if (!claimed || claimed.purpose !== "tag-claims") throw new Error("expected a Claim tagging job");
    const scope = await verifyProcessingJobToken(handle.db, claimed.mcpToken);
    if (scope?.kind !== "tag-claims") throw new Error("expected a tagging scope");
    return { scope, jobId: claimed.jobId, model: claimed.model };
  }

  const snapshot = async () => ({
    links: await handle.db.select().from(claimClues).orderBy(asc(claimClues.claimId), asc(claimClues.clueId)),
    marks: await handle.db
      .select({ id: claims.id, v: claims.cluesPromptVersion, at: claims.cluesTaggedAt })
      .from(claims)
      .orderBy(asc(claims.id)),
    clues: await handle.db.select().from(clues).orderBy(asc(clues.id)),
  });

  it("a trial's tag_claims writes only to the trial store: live links, tagging marks and Clues are unchanged", async () => {
    // Norway is already tagged live.
    await mcpTagClaims(handle.db, mikoId, {
      items: [{ claimId: claimIds[0], clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "typical", countries: ["NO"] }] }],
    });
    const before = await snapshot();

    const started = await startClaimTagging(handle.db, mikoId, { duoId, claimIds: [claimIds[0]!, claimIds[1]!], trial: true, model: "claude-sonnet-5-5" });
    expect(started).toMatchObject({ trial: true, claimCount: 2, model: "claude-sonnet-5-5", promptVersion: "clue-tag-v3" });
    const { scope, jobId, model } = await claimTagJob();
    expect(model).toBe("claude-sonnet-5-5");
    expect(scope).toMatchObject({ trial: true, promptVersion: "clue-tag-v3" });
    // A trial lists its named Claims even when they are already tagged live.
    expect((await mcpListClaimsToTag(handle.db, mikoId, {}, scope)).claims.map((c) => c.claimId).sort()).toEqual([claimIds[0], claimIds[1]].sort());

    const res = await mcpTagClaims(
      handle.db,
      mikoId,
      {
        items: [
          { claimId: claimIds[0], clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "some", countries: ["NO"] }] },
          {
            claimId: claimIds[1],
            clues: [
              { family: "Road lines", name: "White centre line", prevalence: "some", countries: ["MG"] },
              { family: "Road lines", name: "Faded centre line", prevalence: "some", countries: ["MG"] },
            ],
          },
          // Not one of the trial's Claims.
          { claimId: claimIds[2], clues: [] },
        ],
      },
      scope,
    );
    expect(res.savedCount).toBe(2);
    expect(res.errors).toEqual([{ index: 2, message: expect.stringContaining("isn't one of this job's Claims") }]);
    expect(res.createdClues).toEqual([{ clueId: null, family: "Road lines", name: "Faded centre line" }]);

    expect(await snapshot()).toEqual(before);
    const trialRows = await handle.db.select().from(claimClueTrials).where(eq(claimClueTrials.jobId, jobId));
    expect(trialRows.map((r) => [r.claimId === claimIds[0] ? "NO" : "MG", r.name, r.prevalence, r.clueId === null]).sort()).toEqual([
      ["MG", "Faded centre line", "some", true],
      ["MG", "White centre line", "some", false],
      ["NO", "Yellow/orange centre line", "some", false],
    ]);
    expect((await mcpListClaimsToTag(handle.db, mikoId, {}, scope)).claims).toEqual([]);

    expect(await finishProcessingJob(handle.db, jobId, { ok: true, model: "claude-sonnet-5-5", usage: parseClaudeUsage(RESULT) })).toEqual({ status: "succeeded" });
    const job = await handle.db.query.claimTaggingJobs.findFirst({ where: eq(claimTaggingJobs.id, jobId) });
    expect(job).toMatchObject({ taggedCount: 2, model: "claude-sonnet-5-5", promptVersion: "clue-tag-v3", costUsd: 0.4127355 });
    expect(job?.usage?.numTurns).toBe(17);
    expect(job?.createdClues).toEqual([{ clueId: null, family: "Road lines", name: "Faded centre line" }]);
    // The live queue never saw the trial.
    expect(await snapshot()).toEqual(before);
  });

  it("a trial runs the prompt version it names, and a live job can't", async () => {
    await startClaimTagging(handle.db, mikoId, { duoId, limit: 2, trial: true, promptVersion: "clue-tag-v2" });
    const { scope } = await claimTagJob();
    expect(scope.claimIds).toHaveLength(2);
    expect((await mcpListClaimsToTag(handle.db, mikoId, {}, scope)).promptVersion).toBe("clue-tag-v2");
    const server = createGeoCoachMcpServer(handle.db, mikoId, scope);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = (await client.callTool({ name: "get_instructions", arguments: { purpose: "clue-tag" } })) as { content: Array<{ text: string }> };
    expect(JSON.parse(res.content[0]!.text).promptVersion).toBe("clue-tag-v2");
    await client.close();

    await expect(startClaimTagging(handle.db, mikoId, { duoId, limit: 2, trial: false, promptVersion: "clue-tag-v2" })).rejects.toThrow(/Only a trial/);
    await expect(startClaimTagging(handle.db, mikoId, { duoId, limit: 2, trial: true, model: "gpt-5" })).rejects.toThrow(/Unknown model/);
    await expect(startClaimTagging(handle.db, mikoId, { duoId, claimIds: [uuidv7()], trial: true })).rejects.toThrow(/Unknown or other Duo's/);
  });

  it("promotion applies a trial's links as a live job would: untagged and older-version Claims only, unless forced", async () => {
    const [untagged, older, same] = claimIds as [string, string, string];
    const white = (await handle.db.query.clues.findFirst({ where: eq(clues.name, "White centre line") }))!;
    await replaceClaimClues(handle.db, duoId, older, [{ clueId: white.id, country: "MG", prevalence: "typical" }], {
      promptVersion: "clue-tag-v2",
      taggedAt: new Date("2026-11-26T08:00:00Z"),
    });
    await replaceClaimClues(handle.db, duoId, same, [{ clueId: white.id, country: "GH", prevalence: "typical" }], {
      promptVersion: "clue-tag-v3",
      taggedAt: new Date("2026-11-26T08:00:00Z"),
    });

    await startClaimTagging(handle.db, mikoId, { duoId, claimIds, trial: true });
    const { scope, jobId } = await claimTagJob();
    await mcpTagClaims(
      handle.db,
      mikoId,
      {
        items: [
          { claimId: untagged, clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "typical", countries: ["NO"] }] },
          {
            claimId: older,
            clues: [
              { family: "Road lines", name: "White centre line", prevalence: "some", countries: ["MG"] },
              { family: "Road lines", name: "Faded centre line", prevalence: "some", countries: ["MG"] },
            ],
          },
          { claimId: same, clues: [] },
        ],
      },
      scope,
    );
    await expect(mcpPromoteClaimTaggingTrial(handle.db, mikoId, { jobId })).rejects.toThrow(/once it has finished/);
    await finishProcessingJob(handle.db, jobId, { ok: true });

    const res = await mcpPromoteClaimTaggingTrial(handle.db, mikoId, { jobId });
    expect(res.promoted).toBe(2);
    expect(res.skipped).toEqual([{ claimId: same, reason: "Already tagged by clue-tag-v3" }]);
    expect(res.createdClues.map((c) => c.name)).toEqual(["Faded centre line"]);

    const links = await handle.db
      .select({ claimId: claimClues.claimId, name: clues.name, country: claimClues.country, prevalence: claimClues.prevalence })
      .from(claimClues)
      .innerJoin(clues, eq(clues.id, claimClues.clueId));
    const of = (id: string) => links.filter((l) => l.claimId === id).map((l) => [l.name, l.country, l.prevalence]).sort();
    expect(of(untagged)).toEqual([["Yellow/orange centre line", "NO", "typical"]]);
    expect(of(older)).toEqual([["Faded centre line", "MG", "some"], ["White centre line", "MG", "some"]]);
    expect(of(same)).toEqual([["White centre line", "GH", "typical"]]);
    // Marked as tagged by the trial's version when the trial ran, like a live job's Claims.
    const marks = await handle.db.select().from(claims);
    const mark = (id: string) => marks.find((c) => c.id === id)!;
    expect([mark(untagged).cluesPromptVersion, mark(untagged).cluesTaggedAt]).toEqual(["clue-tag-v3", scope.startedAt]);
    expect(mark(older).cluesPromptVersion).toBe("clue-tag-v3");
    expect(mark(same).cluesTaggedAt).toEqual(new Date("2026-11-26T08:00:00Z"));
    // So they leave the live queue.
    expect((await mcpListClaimsToTag(handle.db, mikoId, { limit: 100 })).claims).toEqual([]);

    const forced = await mcpPromoteClaimTaggingTrial(handle.db, mikoId, { jobId, force: true });
    expect([forced.promoted, forced.skipped]).toEqual([3, []]);
    expect((await handle.db.select().from(claimClues).where(eq(claimClues.claimId, same))).length).toBe(0);
  });

  it("over MCP: start a trial on a live job's Claims, read it back, and compare the two", async () => {
    // The live job: the worker tags the queue's Claims, recording its usage.
    await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 3 });
    const liveJob = await claimTagJob();
    await mcpTagClaims(
      handle.db,
      mikoId,
      {
        items: [
          { claimId: claimIds[0], clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "typical", countries: ["NO"] }] },
          {
            claimId: claimIds[1],
            clues: [
              { family: "Road lines", name: "White centre line", prevalence: "typical", countries: ["MG"] },
              { family: "Road lines", name: "Yellow/orange centre line", prevalence: "typical", countries: ["MG"] },
            ],
          },
          { claimId: claimIds[2], clues: [{ family: "Road lines", name: "White centre line", prevalence: "typical", countries: ["GH"] }] },
        ],
      },
      liveJob.scope,
    );
    await finishProcessingJob(handle.db, liveJob.jobId, { ok: true, model: "claude-haiku-5-5", usage: parseClaudeUsage(RESULT) });

    // The Player's agent, over MCP.
    const server = createGeoCoachMcpServer(handle.db, mikoId);
    const client = new Client({ name: "maintainer-agent", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      if (res.isError) throw new Error(res.content[0]!.text);
      return JSON.parse(res.content[0]!.text);
    };

    const listed = await call("list_claim_tagging_jobs", {});
    expect(listed.jobs).toHaveLength(1);
    const first = listed.jobs[0];
    expect(first).toMatchObject({ jobId: liveJob.jobId, trial: false, model: "claude-haiku-5-5", promptVersion: "clue-tag-v3", numTurns: 17 });
    expect([...first.claimIds].sort()).toEqual([...claimIds].sort());

    const started = await call("start_claim_tagging", { claimIds: first.claimIds, trial: true, model: "claude-sonnet-5-5" });
    expect(started).toMatchObject({ trial: true, claimCount: 3, model: "claude-sonnet-5-5" });

    // The fake worker: claims the trial, picks its model, tags with the trial's token, and reports Claude Code's result.
    const trialJob = await claimTagJob();
    expect(trialJob.jobId).toBe(started.jobId);
    const config = loadProcessorConfig({ PROCESSOR_SECRET: "s", CLAUDE_CODE_OAUTH_TOKEN: "t", PROCESSOR_CLUE_TAG_MODEL: "claude-haiku-5-5" })!;
    const picked = pickJobModel({ jobId: trialJob.jobId, runId: null, purpose: "tag-claims", mcpToken: "x", claimCount: 3, model: trialJob.model }, config);
    expect(picked).toEqual({ model: "claude-sonnet-5-5" });
    const jobServer = createGeoCoachMcpServer(handle.db, mikoId, trialJob.scope);
    const worker = new Client({ name: "worker", version: "0" });
    const [c, d] = InMemoryTransport.createLinkedPair();
    await Promise.all([jobServer.connect(c), worker.connect(d)]);
    await worker.callTool({
      name: "tag_claims",
      arguments: {
        items: [
          { claimId: claimIds[0], clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "typical", countries: ["NO"] }] },
          {
            claimId: claimIds[1],
            clues: [
              { family: "Road lines", name: "White centre line", prevalence: "some", countries: ["MG"] },
              { family: "Road lines", name: "Yellow/orange centre line", prevalence: "some", countries: ["MG"] },
            ],
          },
          { claimId: claimIds[2], clues: [] },
        ],
      },
    });
    await worker.close();
    const sonnet = { ...(JSON.parse(RESULT) as Record<string, unknown>), num_turns: 9, total_cost_usd: 1.2 };
    await finishProcessingJob(handle.db, trialJob.jobId, { ok: true, model: "claude-sonnet-5-5", usage: parseClaudeUsage(JSON.stringify(sonnet)) });

    const trial = await call("get_claim_tagging_job", { jobId: started.jobId });
    expect(trial).toMatchObject({
      status: "succeeded",
      trial: true,
      links: "trial",
      model: "claude-sonnet-5-5",
      promptVersion: "clue-tag-v3",
      numTurns: 9,
      apiEquivalentCostUsd: 1.2,
      tokens: { input: 1691, output: 22091, cacheRead: 512904, cacheCreation: 38112 },
      taggedCount: 3,
    });
    expect(trial.claims.find((x: { claimId: string }) => x.claimId === claimIds[2]).links).toEqual([]);

    const live = await call("get_claim_tagging_job", { jobId: liveJob.jobId });
    expect(live).toMatchObject({ links: "live", apiEquivalentCostUsd: 0.4127355 });
    expect(live.claims.every((x: { tagged: boolean }) => x.tagged)).toBe(true);

    const cmp = await call("compare_claim_tagging_jobs", { jobIds: [liveJob.jobId, started.jobId] });
    expect(cmp.totals).toEqual({ claimsInBoth: 3, claimsDiffering: 2, onlyInA: 0, onlyInB: 0, added: 0, removed: 1, changed: 2 });
    const diff = (id: string) => cmp.claims.find((x: { claimId: string }) => x.claimId === id).differences;
    expect(diff(claimIds[0]!)).toEqual([]);
    expect(diff(claimIds[1]!).map((x: { change: string; name: string; from: string; to: string }) => [x.change, x.name, x.from, x.to])).toEqual([
      ["changed", "White centre line", "typical", "some"],
      ["changed", "Yellow/orange centre line", "typical", "some"],
    ]);
    expect(diff(claimIds[2]!)).toEqual([{ change: "removed", family: "Road lines", name: "White centre line", country: "GH", regionCode: null, from: "typical", to: null }]);
    expect((await call("compare_claim_tagging_jobs", { jobIds: [liveJob.jobId, started.jobId], onlyDifferences: true })).claims).toHaveLength(2);

    // The live links still hold the live job's tagging.
    expect((await handle.db.select().from(claimClues).where(eq(claimClues.claimId, claimIds[2]!))).map((l) => l.prevalence)).toEqual(["typical"]);
    await client.close();
  });

  it("Player job tools are never exposed to a job token", async () => {
    await startClaimTagging(handle.db, mikoId, { duoId, limit: 1, trial: true });
    const { scope } = await claimTagJob();
    const server = createGeoCoachMcpServer(handle.db, mikoId, scope);
    const tools = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
    expect(tools).toEqual(["get_instructions", "list_claims_to_tag", "list_clues", "tag_claims"]);
  });
});
