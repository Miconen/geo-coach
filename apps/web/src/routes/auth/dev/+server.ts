import { redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { players } from "$lib/server/db/schema.js";
import {
  SESSION_COOKIE_NAME,
  createAuthSession,
  isDevLoginEnabled,
} from "$lib/server/auth/index.js";

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!isDevLoginEnabled()) {
    return new Response("Dev login is disabled outside development.", { status: 404 });
  }

  const form = await request.formData();
  const playerId = String(form.get("playerId") ?? "");
  if (!playerId) {
    return new Response("Missing playerId", { status: 400 });
  }

  const player = await getDb().query.players.findFirst({ where: eq(players.id, playerId) });
  if (!player) {
    return new Response("Player not found", { status: 404 });
  }

  const { rawSessionToken, expiresAt } = await createAuthSession(getDb(), player.id);
  cookies.set(SESSION_COOKIE_NAME, rawSessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    expires: expiresAt,
  });

  redirect(302, "/");
};
