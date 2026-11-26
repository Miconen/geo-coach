import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { extractBearerToken } from "$lib/server/auth/index.js";
import { getDb } from "$lib/server/db/index.js";
import {
  claimNextProcessingJob,
  extendProcessingJobLease,
  finishProcessingJob,
  verifyProcessorSecret,
} from "$lib/server/mcp/processing-jobs.js";

const tokens = { inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheCreationTokens: z.number() };

/** What a Claim tagging job's Claude Code run used (#94), as the worker parsed it. */
const usageSchema = z.object({
  ...tokens,
  models: z.array(z.string().max(100)).max(20),
  numTurns: z.number().nullable(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  byModel: z.array(z.object({ model: z.string().max(100), costUsd: z.number().nullable(), ...tokens })).max(20),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), model: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("heartbeat"), jobId: z.string().uuid() }),
  z.object({
    action: z.literal("finish"),
    jobId: z.string().uuid(),
    ok: z.boolean(),
    error: z.string().max(300).nullable().optional(),
    model: z.string().trim().min(1).max(100).optional(),
    usage: usageSchema.optional(),
  }),
]);

export const POST: RequestHandler = async ({ request }) => {
  if (!verifyProcessorSecret(extractBearerToken(request.headers))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid processor request" }, { status: 400 });

  const db = getDb();
  const body = parsed.data;
  if (body.action === "claim") {
    return json({ job: await claimNextProcessingJob(db, body.model) });
  }
  if (body.action === "heartbeat") {
    return json({ active: await extendProcessingJobLease(db, body.jobId) });
  }
  return json(
    await finishProcessingJob(db, body.jobId, { ok: body.ok, error: body.error, model: body.model, usage: body.usage }),
  );
};
