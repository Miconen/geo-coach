import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  loadProcessorConfig,
  parseClaudeUsage,
  pickJobModel,
  type ClaimedJob,
} from "../worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// A real Claude Code `-p --output-format json` result's shape: the job's model plus Claude Code's own small model.
const RESULT = readFileSync(path.join(here, "claude-result.json"), "utf8");

const env = { PROCESSOR_SECRET: "s", CLAUDE_CODE_OAUTH_TOKEN: "t" };
const tagJob = (model: string | null): ClaimedJob => ({
  jobId: "j",
  runId: null,
  purpose: "tag-claims",
  mcpToken: "gc_job_x",
  claimCount: 3,
  model,
});
const sessionJob: ClaimedJob = { jobId: "j", runId: "r", purpose: "extract", mcpToken: "gc_job_x" };

describe("the model a job runs with (#94)", () => {
  it("a tagging job uses its own model, then PROCESSOR_CLUE_TAG_MODEL, then PROCESSOR_MODEL", () => {
    const all = loadProcessorConfig({ ...env, PROCESSOR_MODEL: "claude-haiku-5-5", PROCESSOR_CLUE_TAG_MODEL: "claude-sonnet-5-5" })!;
    expect(pickJobModel(tagJob("claude-opus-5-5"), all)).toEqual({ model: "claude-opus-5-5" });
    expect(pickJobModel(tagJob(null), all)).toEqual({ model: "claude-sonnet-5-5" });

    const noTagModel = loadProcessorConfig({ ...env, PROCESSOR_MODEL: "claude-haiku-5-5", PROCESSOR_CLUE_TAG_MODEL: "" })!;
    expect(noTagModel.clueTagModel).toBeNull();
    expect(pickJobModel(tagJob(null), noTagModel)).toEqual({ model: "claude-haiku-5-5" });
  });

  it("Session jobs are unchanged: always PROCESSOR_MODEL", () => {
    const config = loadProcessorConfig({ ...env, PROCESSOR_MODEL: "claude-haiku-5-5", PROCESSOR_CLUE_TAG_MODEL: "claude-sonnet-5-5" })!;
    expect(pickJobModel(sessionJob, config)).toEqual({ model: "claude-haiku-5-5" });
  });

  it("rejects a model that isn't on the known list", () => {
    const config = loadProcessorConfig({ ...env, PROCESSOR_CLUE_TAG_MODEL: "gpt-5" })!;
    expect(pickJobModel(tagJob("claude-sonnet-9"), config)).toEqual({ error: expect.stringContaining("claude-sonnet-9") });
    expect(pickJobModel(tagJob(null), config)).toEqual({ error: expect.stringContaining("gpt-5") });
  });

  it("passes the picked model to Claude Code", () => {
    const config = loadProcessorConfig(env)!;
    const args = buildClaudeArgs(config, "/tmp/mcp.json", "claude-sonnet-5-5");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
  });
});

describe("usage from Claude Code's JSON result (#94)", () => {
  it("reads turns, duration, the API-equivalent cost and every model's tokens", () => {
    const usage = parseClaudeUsage(RESULT)!;
    expect(usage.models).toEqual(["claude-haiku-5-5", "claude-haiku-4-5"]);
    expect(usage.numTurns).toBe(17);
    expect(usage.durationMs).toBe(94213);
    expect(usage.costUsd).toBeCloseTo(0.4127355);
    // Totals add up every model, Claude Code's own small model included.
    expect(usage.inputTokens).toBe(61 + 1630);
    expect(usage.outputTokens).toBe(21877 + 214);
    expect(usage.cacheReadTokens).toBe(512904);
    expect(usage.cacheCreationTokens).toBe(38112);
    expect(usage.byModel).toEqual([
      { model: "claude-haiku-5-5", inputTokens: 61, outputTokens: 21877, cacheReadTokens: 512904, cacheCreationTokens: 38112, costUsd: 0.4101 },
      { model: "claude-haiku-4-5", inputTokens: 1630, outputTokens: 214, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.0026355 },
    ]);
  });

  it("falls back to the top-level usage when modelUsage is missing", () => {
    const { modelUsage: _, ...rest } = JSON.parse(RESULT) as Record<string, unknown>;
    const usage = parseClaudeUsage(JSON.stringify(rest))!;
    expect(usage.models).toEqual([]);
    expect(usage.byModel).toEqual([]);
    expect([usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheCreationTokens]).toEqual([61, 21877, 512904, 38112]);
  });

  it("reads an error result too, and nothing from output that isn't JSON", () => {
    const failed = { ...(JSON.parse(RESULT) as object), subtype: "error_max_turns", is_error: true, num_turns: 41 };
    expect(parseClaudeUsage(JSON.stringify(failed))?.numTurns).toBe(41);
    expect(parseClaudeUsage("Error: not logged in")).toBeNull();
    expect(parseClaudeUsage("")).toBeNull();
  });
});
