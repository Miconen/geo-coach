import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { tokenScopeSchema } from "@geo-coach/shared";
import { getDb } from "$lib/server/db/index.js";
import { issueApiToken, revokeApiToken } from "$lib/server/auth/index.js";

const createTokenSchema = z.object({
  scope: tokenScopeSchema,
  label: z.string().trim().min(1).max(80),
  ttlDays: z.number().int().min(1).max(365).default(90),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createTokenSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json({ error: "Invalid token request" }, { status: 400 });
  }
  const issued = await issueApiToken(
    getDb(),
    locals.player.id,
    parsed.data.scope,
    parsed.data.label,
    parsed.data.ttlDays,
  );
  return json(issued, { status: 201 });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing token id" }, { status: 400 });
  const ok = await revokeApiToken(getDb(), locals.player.id, id);
  return json({ ok });
};
