import type { RequestHandler } from "./$types";
import { checkDbReachable } from "$lib/server/db/index.js";

export const GET: RequestHandler = async () => {
  const dbOk = await checkDbReachable();
  return new Response(
    JSON.stringify({ ok: dbOk, db: dbOk ? "up" : "down", time: new Date().toISOString() }),
    {
      status: dbOk ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    },
  );
};
