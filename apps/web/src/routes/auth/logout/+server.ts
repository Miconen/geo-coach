import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { SESSION_COOKIE_NAME, deleteAuthSession, hashToken } from "$lib/server/auth/index.js";
import { LAST_DUO_COOKIE } from "$lib/server/auth/guards.js";
import { closeStreamsForSession } from "$lib/server/events/stream.js";

export const POST: RequestHandler = async ({ cookies }) => {
  const raw = cookies.get(SESSION_COOKIE_NAME);
  if (raw) {
    await deleteAuthSession(getDb(), raw);
    // Open /events streams of this session (also one whose session already expired) close now.
    closeStreamsForSession(hashToken(raw));
    cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
  }
  // Always, even without a session cookie: the next Player on this browser starts fresh.
  cookies.delete(LAST_DUO_COOKIE, { path: "/" });
  redirect(302, "/login");
};
