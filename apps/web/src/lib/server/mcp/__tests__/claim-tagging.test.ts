import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimClues, claimTaggingJobs, claims, duoMemberships, duos, players } from "../../db/schema.js";
import { insertClaim } from "../../services/index.js";
import { mcpListClaimsToTag, mcpListClues, mcpTagClaims } from "../clue-tagging.js";
import {
  claimNextProcessingJob,
  enqueueClaimTagging,
  finishProcessingJob,
  verifyProcessingJobToken,
  type ProcessingJobScope,
} from "../processing-jobs.js";
import { createGeoCoachMcpServer } from "../server.js";
import { mcpAddClaims, mcpEditClaims } from "../workflow.js";

type TagScope = Extract<ProcessingJobScope, { kind: "tag-claims" }>;

describe("tagging Claims with Clues (#89)", () => {
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
    for (let i = 0; i < 5; i++) {
      claimIds.push(
        await insertClaim(handle.db, {
          duoId,
          runId: null,
          createdByPlayerId: mikoId,
          text: `Claim ${i}: Norway has yellow centre lines.`,
          countries: ["NO"],
          regions: [],
          topics: [],
        }),
      );
    }
  });
  afterEach(async () => handle.close());

  async function claimTagJob(): Promise<{ scope: TagScope; jobId: string }> {
    const claimed = await claimNextProcessingJob(handle.db, "test-model");
    if (!claimed || claimed.purpose !== "tag-claims") throw new Error("expected a Claim tagging job");
    const scope = await verifyProcessingJobToken(handle.db, claimed.mcpToken);
    if (scope?.kind !== "tag-claims") throw new Error("expected a tagging scope");
    return { scope, jobId: claimed.jobId };
  }

  const untagged = (scope: TagScope) => mcpListClaimsToTag(handle.db, mikoId, {}, scope);
  const tagNone = (ids: string[], scope: TagScope | null = null) =>
    mcpTagClaims(handle.db, mikoId, { items: ids.map((claimId) => ({ claimId, clues: [] })) }, scope);

  it("a job with a limit of N tags at most N Claims, and the next job continues where it stopped", async () => {
    expect(await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 3 })).toEqual({ jobs: 1, claims: 3 });
    const first = await claimTagJob();
    expect(first.scope.claimIds).toHaveLength(3);
    const listed = await untagged(first.scope);
    expect(listed.claims.map((c) => c.claimId).sort()).toEqual([...first.scope.claimIds].sort());

    const outside = claimIds.find((id) => !first.scope.claimIds.includes(id))!;
    const res = await tagNone([...first.scope.claimIds, outside], first.scope);
    expect(res.savedCount).toBe(3);
    expect(res.errors).toEqual([{ index: 3, message: expect.stringContaining("isn't one of this job's Claims") }]);
    expect((await untagged(first.scope)).claims).toEqual([]);
    expect(await finishProcessingJob(handle.db, first.jobId, { ok: true })).toEqual({ status: "succeeded" });

    // Only two are left in the queue, and the next job takes exactly those.
    expect(await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 3 })).toEqual({ jobs: 1, claims: 2 });
    const second = await claimTagJob();
    expect([...second.scope.claimIds].sort()).toEqual(claimIds.filter((id) => !first.scope.claimIds.includes(id)).sort());
    await expect(enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 3 })).rejects.toThrow(/already/);
  });

  it("a job that stops early fails and leaves its untagged Claims in the queue", async () => {
    await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 3 });
    const { scope, jobId } = await claimTagJob();
    await tagNone([scope.claimIds[0]!], scope);
    expect(await finishProcessingJob(handle.db, jobId, { ok: true })).toEqual({ status: "failed" });
    const job = await handle.db.query.claimTaggingJobs.findFirst({ where: eq(claimTaggingJobs.id, jobId) });
    expect(job?.error).toMatch(/^Tagged 1 of 3 Claims/);
    expect((await mcpListClaimsToTag(handle.db, mikoId, { limit: 100 })).claims).toHaveLength(4);
  });

  it("without a limit, queues the whole queue", async () => {
    expect(await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: null })).toEqual({ jobs: 1, claims: 5 });
  });

  it("reuses the seed Clues, creates new ones only inside a family, reports them, and caps lacks", async () => {
    const before = await mcpListClues(handle.db, mikoId, {});
    expect(before.families).toHaveLength(17);
    const roadLines = before.families.find((f) => f.family === "Road lines")!;
    expect(roadLines.clues.map((c) => c.name)).toContain("Yellow/orange centre line");

    const lacks15 = ["SE", "DK", "DE", "NL", "BE", "FR", "ES", "PT", "IT", "AT", "CH", "PL", "CZ", "SK", "HU", "SI"];
    const res = await mcpTagClaims(handle.db, mikoId, {
      items: [
        {
          claimId: claimIds[0],
          clues: [
            { family: "road lines", name: "yellow/orange centre line", prevalence: "typical", countries: ["NO"] },
            { family: "Road surface and markings", name: "Red-and-white striped kerb", prevalence: "some", countries: ["NO"] },
          ],
        },
        { claimId: claimIds[1], clues: [{ family: "Weather", name: "Fog", prevalence: "typical", countries: ["GB"] }] },
        { claimId: claimIds[2], clues: [{ family: "Road lines", name: "Yellow/orange centre line", prevalence: "lacks", countries: lacks15 }] },
      ],
    });
    expect(res.saved.map((s) => [s.claimId, s.links])).toEqual([[claimIds[0], 2]]);
    expect(res.createdClues.map((c) => [c.family, c.name])).toEqual([["Road surface and markings", "Red-and-white striped kerb"]]);
    expect(res.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(res.errors[0]!.message).toMatch(/not a Clue family/);
    expect(res.errors[1]!.message).toMatch(/at most 15/);
    const links = await handle.db.select().from(claimClues);
    expect(links.map((l) => [l.country, l.prevalence]).sort()).toEqual([["NO", "some"], ["NO", "typical"]]);
  });

  it("queues tagging of new and edited Claims only once the Duo's tagging has started", async () => {
    await mcpAddClaims(handle.db, mikoId, { items: [{ text: "Iceland has no yellow lines.", countries: ["IS"] }] });
    expect(await handle.db.select().from(claimTaggingJobs)).toEqual([]);

    await tagNone([claimIds[0]!]);
    await mcpAddClaims(handle.db, mikoId, { items: [{ text: "Finland has yellow centre lines.", countries: ["FI"] }] });
    await mcpEditClaims(handle.db, mikoId, { items: [{ claimId: claimIds[0], text: "Norway has yellow/orange centre lines." }] });
    const jobs = await handle.db.select().from(claimTaggingJobs);
    expect(jobs.map((j) => [j.status, j.claimLimit])).toEqual([["queued", 2]]);

    // The job takes the newest touched Claims: the edited one and the new one.
    const { scope } = await claimTagJob();
    const texts = (await handle.db.select({ id: claims.id, text: claims.text }).from(claims)).filter((c) => scope.claimIds.includes(c.id));
    expect(texts.map((c) => c.text).sort()).toEqual(["Finland has yellow centre lines.", "Norway has yellow/orange centre lines."]);
  });

  it("a tagging job's token exposes only the tagging tools", async () => {
    await enqueueClaimTagging(handle.db, mikoId, { duoId, limit: 1 });
    const { scope } = await claimTagJob();
    const server = createGeoCoachMcpServer(handle.db, mikoId, scope);
    const tools = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
    expect(tools).toEqual(["get_instructions", "list_claims_to_tag", "list_clues", "tag_claims"]);
  });
});
