import type { Handle } from "@sveltejs/kit";
import { getDb } from "$lib/server/db/index.js";
import { SESSION_COOKIE_NAME, verifyAuthSession } from "$lib/server/auth/index.js";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.player = null;
  event.locals.sessionId = null;
  event.locals.authUnavailable = false;

  const rawSession = event.cookies.get(SESSION_COOKIE_NAME);
  if (rawSession) {
    try {
      const verified = await verifyAuthSession(getDb(), rawSession);
      if (verified) {
        event.locals.player = verified.player;
        event.locals.sessionId = verified.sessionId;
      }
    } catch {
      // Unknown, not signed out: cookie routes answer 503 (assertAuthAvailable); /healthz and others ignore it.
      event.locals.authUnavailable = true;
    }
  }

  return resolve(event);
};
