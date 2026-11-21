import type { Handle } from "@sveltejs/kit";
import { getDb } from "$lib/server/db/index.js";
import { SESSION_COOKIE_NAME, verifyAuthSession } from "$lib/server/auth/index.js";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.player = null;
  event.locals.sessionId = null;

  const rawSession = event.cookies.get(SESSION_COOKIE_NAME);
  if (rawSession) {
    try {
      const verified = await verifyAuthSession(getDb(), rawSession);
      if (verified) {
        event.locals.player = verified.player;
        event.locals.sessionId = verified.sessionId;
      }
    } catch {
      // Ignore DB lookup errors on non-authenticated paths such as /healthz
    }
  }

  return resolve(event);
};
