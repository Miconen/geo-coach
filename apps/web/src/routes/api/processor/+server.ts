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

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), model: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("heartbeat"), jobId: z.string().uuid() }),
  z.object({
    action: z.literal("finish"),
    jobId: z.string().uuid(),
    ok: z.boolean(),
    error: z.string().max(300).nullable().optional(),
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
  return json(await finishProcessingJob(db, body.jobId, { ok: body.ok, error: body.error }));
};
