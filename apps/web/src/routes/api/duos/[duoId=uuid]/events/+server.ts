import type { RequestHandler } from "./$types";
import { duoEventBus } from "$lib/server/events/bus.js";
import { duoRoute } from "$lib/server/auth/guards.js";

// Plain-text 401, 404 and 503 from the wrapper: EventSource never reads a JSON error body.
export const GET: RequestHandler = duoRoute(
  async (_event, { duoId }) => {

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        // Send current live statuses immediately
        for (const st of duoEventBus.getLiveStatuses(duoId)) {
          send({ type: "heartbeat", ...st });
        }

        unsubscribe = duoEventBus.subscribe(duoId, send);
        pingTimer = setInterval(() => {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 25_000);
      },
      cancel() {
        unsubscribe?.();
        if (pingTimer) clearInterval(pingTimer);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
  { stream: true },
);
