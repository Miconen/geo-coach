import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { DomainError } from "$lib/server/services/index.js";
import { enqueueProcessingJobs, isProcessorOnline } from "$lib/server/mcp/processing-jobs.js";

const enqueueSchema = z
  .object({
    sessionId: z.string().uuid(),
    purpose: z.enum(["extract", "tips"]),
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
  })
  .refine((v) => Date.parse(v.endUtc) > Date.parse(v.startUtc), {
    message: "endUtc must be after startUtc",
  });

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  const parsed = enqueueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid processing request" }, { status: 400 });
  if (!isProcessorOnline()) {
    return json({ error: "The processing worker is offline." }, { status: 503 });
  }
  try {
    const result = await enqueueProcessingJobs(getDb(), locals.player.id, {
      duoId: params.duoId,
      sessionId: parsed.data.sessionId,
      purpose: parsed.data.purpose,
      startUtc: new Date(parsed.data.startUtc),
      endUtc: new Date(parsed.data.endUtc),
    });
    return json(result, { status: 202 });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
};
