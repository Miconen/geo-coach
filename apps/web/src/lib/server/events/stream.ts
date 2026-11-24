import { eq } from "drizzle-orm";
import type { DuoSseEvent } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { authSessions } from "../db/schema.js";
import { duoEventBus } from "./bus.js";

/**
 * Open /events streams by auth session id (hashToken of the cookie), so logout can close them (#56 1b-live(i)).
 * Each entry is the stream's idempotent cleanup.
 */
const registry = new Map<string, Set<() => void>>();

export function closeStreamsForSession(sessionId: string): void {
  for (const close of [...(registry.get(sessionId) ?? [])]) close();
}

export function registeredStreamCount(sessionId?: string): number {
  if (sessionId !== undefined) return registry.get(sessionId)?.size ?? 0;
  let n = 0;
  for (const set of registry.values()) n += set.size;
  return n;
}

type Bus = Pick<typeof duoEventBus, "subscribe" | "getLiveStatuses" | "changedAt">;

export interface DuoEventStreamOptions {
  db: AppDb;
  duoId: string;
  sessionId: string;
  bus?: Bus;
  now?: () => number;
  pingMs?: number;
}

/**
 * The Duo's server-sent events for one signed-in tab. After registering, the stream re-reads its auth session
 * (for expiresAt) before sending anything, and closes if it is gone, expired or unreadable; then ": ready" flushes
 * the headers, the live statuses follow, then events and a keepalive every pingMs. The cached expiry is checked
 * before every write, so an expired session's stream closes on its next event or keepalive.
 */
export function createDuoEventStream(opts: DuoEventStreamOptions): ReadableStream<Uint8Array> {
  const { db, duoId, sessionId, bus = duoEventBus, now = Date.now, pingMs = 25_000 } = opts;
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let expiresAt = 0;
  let unsubscribe: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const close = () => cleanup(false);
  function cleanup(fromCancel: boolean) {
    if (closed) return;
    closed = true;
    const set = registry.get(sessionId);
    set?.delete(close);
    if (set && set.size === 0) registry.delete(sessionId);
    unsubscribe?.();
    unsubscribe = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (!fromCancel) {
      try {
        controller?.close();
      } catch {
        // Already closed by the runtime.
      }
    }
  }

  function write(text: string) {
    if (closed) return;
    if (now() >= expiresAt) {
      close();
      return;
    }
    controller!.enqueue(encoder.encode(text));
  }
  const send = (event: DuoSseEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

  return new ReadableStream<Uint8Array>({
    async start(c) {
      controller = c;
      let set = registry.get(sessionId);
      if (!set) registry.set(sessionId, (set = new Set()));
      set.add(close);
      try {
        const row = await db.query.authSessions.findFirst({
          where: eq(authSessions.id, sessionId),
          columns: { expiresAt: true },
        });
        if (closed) return;
        if (!row || row.expiresAt.getTime() <= now()) {
          close();
          return;
        }
        expiresAt = row.expiresAt.getTime();
      } catch {
        close();
        return;
      }
      write(": ready\n\n");
      if (closed) return;
      send({ type: "sync", changedAt: new Date(bus.changedAt(duoId)).toISOString() });
      for (const st of bus.getLiveStatuses(duoId)) send({ type: "heartbeat", ...st });
      unsubscribe = bus.subscribe(duoId, send);
      pingTimer = setInterval(() => write(": keepalive\n\n"), pingMs);
    },
    cancel() {
      cleanup(true);
    },
  });
}
