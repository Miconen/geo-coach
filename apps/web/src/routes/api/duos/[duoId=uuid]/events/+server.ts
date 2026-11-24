import type { RequestHandler } from "./$types";
import { duoRoute } from "$lib/server/auth/guards.js";
import { createDuoEventStream } from "$lib/server/events/stream.js";

// Plain-text 401, 404 and 503 from the wrapper: EventSource never reads a JSON error body.
export const GET: RequestHandler = duoRoute(
  async (event, { db, duoId }) =>
    new Response(createDuoEventStream({ db, duoId, sessionId: event.locals.sessionId ?? "" }), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }),
  { stream: true },
);
