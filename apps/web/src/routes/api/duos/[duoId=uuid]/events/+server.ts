import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { assertPlayerInDuo, DomainError } from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.player) {
    return new Response("Unauthorized", { status: 401 });
  }
  const duoId = params.duoId;
  try {
    await assertPlayerInDuo(getDb(), locals.player.id, duoId);
  } catch (err) {
    if (err instanceof DomainError) {
      return new Response(err.message, { status: err.status });
    }
    return new Response("Forbidden", { status: 403 });
  }

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
};
