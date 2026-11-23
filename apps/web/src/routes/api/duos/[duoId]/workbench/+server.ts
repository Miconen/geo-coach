import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { assertPlayerInDuo, DomainError } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    await assertPlayerInDuo(db, locals.player.id, params.duoId);
    return json(await buildWorkbenchData(db, params.duoId, locals.player.id));
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
};
