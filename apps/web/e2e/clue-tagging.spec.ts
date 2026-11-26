import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #94: a Claim tagging job records the model it ran and what it used, and the Clues page shows it on the job's row.
const s = seed();

const asWorker = (request: import("@playwright/test").APIRequestContext, data: Record<string, unknown>) =>
  request.post("/api/processor", { headers: { Authorization: "Bearer e2e-processor-secret" }, data });

/** One stateless MCP call with a job's token, as the worker's Claude Code makes it. */
async function mcpCall(request: import("@playwright/test").APIRequestContext, token: string, name: string, args: Record<string, unknown>) {
  const res = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  expect(body.result.isError ?? false).toBe(false);
  return JSON.parse(body.result.content[0]!.text);
}

test("a tagging job's row shows its model, prompt version, duration, turns, tokens and API-equivalent cost", async ({ page }) => {
  try {
    await login(page, s.mikoId);
    // The worker polls (and is online), then the Player queues one Claim.
    expect((await asWorker(page.request, { action: "claim", model: "e2e" })).status()).toBe(200);
    const queued = await page.request.post(`/api/duos/${s.duoId}/clues`, { data: { limit: 1 } });
    expect(queued.status()).toBe(202);

    const claimed = await asWorker(page.request, { action: "claim", model: "e2e" });
    const { job } = (await claimed.json()) as { job: { jobId: string; purpose: string; mcpToken: string; model: string | null } };
    expect(job.purpose).toBe("tag-claims");
    expect(job.model).toBeNull();

    const listed = await mcpCall(page.request, job.mcpToken, "list_claims_to_tag", {});
    expect(listed.claims).toHaveLength(1);
    await mcpCall(page.request, job.mcpToken, "tag_claims", { items: [{ claimId: listed.claims[0].claimId, clues: [] }] });

    const finished = await asWorker(page.request, {
      action: "finish",
      jobId: job.jobId,
      ok: true,
      error: null,
      model: "claude-sonnet-5-5",
      usage: {
        models: ["claude-sonnet-5-5", "claude-haiku-4-5"],
        numTurns: 17,
        durationMs: 94_213,
        costUsd: 0.4127,
        inputTokens: 1691,
        outputTokens: 22_091,
        cacheReadTokens: 512_904,
        cacheCreationTokens: 38_112,
        byModel: [
          { model: "claude-sonnet-5-5", costUsd: 0.41, inputTokens: 61, outputTokens: 21_877, cacheReadTokens: 512_904, cacheCreationTokens: 38_112 },
          { model: "claude-haiku-4-5", costUsd: 0.0027, inputTokens: 1630, outputTokens: 214, cacheReadTokens: 0, cacheCreationTokens: 0 },
        ],
      },
    });
    expect(await finished.json()).toEqual({ status: "succeeded" });

    await page.goto(`/duos/${s.duoId}/knowledge/clues`);
    const row = page.getByTestId("tagging-job").first();
    await expect(row).toContainText("Tagged 1 Claims");
    await expect(row.getByTestId("tagging-job-metrics")).toHaveText(
      "claude-sonnet-5-5 · clue-tag-v3 · 1 min 34 s · 17 turns · 1.7k in · 22.1k out · 512.9k cache read · 38.1k cache write · $0.41 API-equivalent",
    );
  } finally {
    // Later specs edit Claims: with no Claim tagged, that queues no tagging. The seeded Clues go too (the seed has
    // none; clue-lens inserts its own).
    await withSql(async (sql) => {
      await sql`DELETE FROM claim_tagging_jobs WHERE duo_id = ${s.duoId}`;
      await sql`DELETE FROM clues WHERE duo_id = ${s.duoId}`;
      await sql`UPDATE claims SET clues_prompt_version = NULL, clues_tagged_at = NULL WHERE duo_id = ${s.duoId}`;
    });
  }
});
