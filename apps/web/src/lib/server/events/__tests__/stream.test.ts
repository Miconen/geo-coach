import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7, type DuoSseEvent } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { authSessions, players } from "../../db/schema.js";
import type { AppDb } from "../../db/index.js";
import { closeStreamsForSession, createDuoEventStream, registeredStreamCount } from "../stream.js";

// #56 1b-live(i): /events streams close on logout, on expiry and when their session read fails; every close
// path is idempotent and leaves no registry entry, subscription or timer.

const DUO = "11111111-1111-4111-8111-111111111111";

function fakeBus() {
  const listeners = new Set<(e: DuoSseEvent) => void>();
  return {
    listeners,
    subscribe: vi.fn((_duoId: string, l: (e: DuoSseEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    getLiveStatuses: vi.fn(() => []),
    emit(e: DuoSseEvent) {
      for (const l of listeners) l(e);
    },
  };
}

const changed = (): DuoSseEvent => ({ type: "changed", entity: "run", at: new Date().toISOString() });

async function readAll(stream: ReadableStream<Uint8Array>, max = 20): Promise<{ text: string; done: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < max; i++) {
    const next = await Promise.race([
      reader.read(),
      new Promise<"pending">((r) => setTimeout(() => r("pending"), 30)),
    ]);
    if (next === "pending") {
      reader.releaseLock();
      return { text, done: false };
    }
    if (next.done) {
      reader.releaseLock();
      return { text, done: true };
    }
    text += decoder.decode(next.value);
  }
  reader.releaseLock();
  return { text, done: false };
}

describe("Duo event stream", () => {
  let handle: TestDbHandle;
  let sessionId: string;
  let now: number;

  beforeEach(async () => {
    handle = await createTestDb();
    const playerId = uuidv7();
    sessionId = `s-${uuidv7()}`;
    now = Date.parse("2026-01-01T00:00:00Z");
    await handle.db.insert(players).values({ id: playerId, discordId: "d", displayName: "P" });
    await handle.db.insert(authSessions).values({ id: sessionId, playerId, expiresAt: new Date(now + 60_000) });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await handle.close();
  });

  const open = (bus = fakeBus(), db: AppDb = handle.db, pingMs = 25_000) => ({
    bus,
    stream: createDuoEventStream({ db, duoId: DUO, sessionId, bus, now: () => now, pingMs }),
  });

  it("re-reads its session, then sends ': ready', statuses and events", async () => {
    const { bus, stream } = open();
    const first = await readAll(stream);
    expect(first.text.startsWith(": ready\n\n")).toBe(true);
    expect(registeredStreamCount(sessionId)).toBe(1);
    bus.emit(changed());
    const second = await readAll(stream);
    expect(second.text).toContain('"entity":"run"');
    await stream.cancel();
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect(bus.listeners.size).toBe(0);
  });

  it("closes with nothing sent when the session is gone after registering (logout raced the request)", async () => {
    await handle.db.delete(authSessions).where(eq(authSessions.id, sessionId));
    const { bus, stream } = open();
    expect(await readAll(stream)).toEqual({ text: "", done: true });
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect(bus.subscribe).not.toHaveBeenCalled();
  });

  it("closes with nothing sent when the session read throws", async () => {
    const throwing = {
      query: { authSessions: { findFirst: () => Promise.reject(new Error("db down")) } },
    } as unknown as AppDb;
    const { bus, stream } = open(fakeBus(), throwing);
    expect(await readAll(stream)).toEqual({ text: "", done: true });
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect(bus.subscribe).not.toHaveBeenCalled();
  });

  it("returns at once when logout or cancel lands during the session read", async () => {
    for (const how of ["logout", "cancel"] as const) {
      const bus = fakeBus();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = {
        query: {
          authSessions: {
            findFirst: async () => {
              await gate;
              return { expiresAt: new Date(now + 60_000) };
            },
          },
        },
      } as unknown as AppDb;
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const stream = createDuoEventStream({ db: slow, duoId: DUO, sessionId, bus, now: () => now });
      const reader = stream.getReader();
      const read = reader.read();
      await Promise.resolve();
      expect(registeredStreamCount(sessionId)).toBe(1);
      if (how === "logout") closeStreamsForSession(sessionId);
      else await reader.cancel();
      release();
      await new Promise((r) => setTimeout(r, 10));
      expect(await read).toEqual({ done: true, value: undefined });
      expect(bus.subscribe).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(registeredStreamCount(sessionId)).toBe(0);
      setIntervalSpy.mockRestore();
    }
  });

  it("logout closes every stream of the session, once, and later closes are no-ops", async () => {
    const a = open();
    const b = open();
    await readAll(a.stream);
    await readAll(b.stream);
    expect(registeredStreamCount(sessionId)).toBe(2);
    closeStreamsForSession(sessionId);
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect((await readAll(a.stream)).done).toBe(true);
    expect((await readAll(b.stream)).done).toBe(true);
    // Repeated: logout again, cancel after logout.
    closeStreamsForSession(sessionId);
    await a.stream.cancel();
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect(a.bus.listeners.size + b.bus.listeners.size).toBe(0);
  });

  it("an idle stream closes at the first keepalive after its session expires", async () => {
    const { bus, stream } = open(fakeBus(), handle.db, 20);
    expect((await readAll(stream)).text).toContain(": ready");
    const alive = await readAll(stream);
    expect(alive.done).toBe(false);
    now += 61_000;
    await new Promise((r) => setTimeout(r, 40));
    const after = await readAll(stream);
    expect(after.done).toBe(true);
    expect(after.text).not.toContain("keepalive");
    expect(registeredStreamCount(sessionId)).toBe(0);
    expect(bus.listeners.size).toBe(0);
  });

  it("an event after expiry is not delivered and closes the stream", async () => {
    const { bus, stream } = open();
    await readAll(stream);
    now += 61_000;
    bus.emit(changed());
    const after = await readAll(stream);
    expect(after).toEqual({ text: "", done: true });
    expect(registeredStreamCount(sessionId)).toBe(0);
    // Logout after expiry: still a no-op.
    closeStreamsForSession(sessionId);
    expect(bus.listeners.size).toBe(0);
  });
});
