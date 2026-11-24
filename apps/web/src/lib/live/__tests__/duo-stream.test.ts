import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuoSseEvent } from "@geo-coach/shared";
import { duoSseEventSchema } from "@geo-coach/shared";
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, DuoStream, type EventSourceLike, type StreamBatch } from "../duo-stream.js";
import { heartbeats, needsRefresh } from "../dependencies.js";
import { singleFlight } from "../single-flight.js";

// #56 1b-live(i): the shared store (connection, catch-up, held events, backoff, authorization probe).

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  message(ev: DuoSseEvent) {
    this.onmessage?.({ data: JSON.stringify(ev) } as MessageEvent);
  }
  /** An HTTP error: EventSource gives up (CLOSED). */
  fail() {
    this.readyState = 2;
    this.onerror?.({} as Event);
  }
  /** A network drop: EventSource retries itself (CONNECTING). */
  drop() {
    this.readyState = 0;
    this.onerror?.({} as Event);
  }
}

const changed = (entity: Extract<DuoSseEvent, { type: "changed" }>["entity"]): DuoSseEvent => ({
  type: "changed",
  entity,
  at: new Date().toISOString(),
});

describe("DuoStream", () => {
  let sources: FakeEventSource[];
  let probeStatus: number | Error;
  let fetchCalls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    probeStatus = 200;
    fetchCalls = [];
  });
  afterEach(() => vi.useRealTimers());

  function make(duoId = "duo-a") {
    const stream = new DuoStream(duoId, {
      createEventSource: (url) => {
        const es = new FakeEventSource(url);
        sources.push(es);
        return es;
      },
      fetch: async (url) => {
        fetchCalls.push(url);
        if (probeStatus instanceof Error) throw probeStatus;
        return { status: probeStatus };
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    const batches: StreamBatch[] = [];
    stream.subscribe((b) => batches.push(b));
    return { stream, batches };
  }

  it("catches up on the first open and every reconnect, and delivers events one by one", () => {
    const { stream, batches } = make();
    stream.start();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toBe("/api/duos/duo-a/events");
    sources[0]!.open();
    sources[0]!.message(changed("game"));
    sources[0]!.drop();
    expect(stream.status).toBe("retrying");
    sources[0]!.open();
    expect(batches).toEqual([
      { events: [], reopened: true },
      { events: [expect.objectContaining({ entity: "game" })], reopened: false },
      { events: [], reopened: true },
    ]);
  });

  it("a stream that never opens retries with exponential backoff and keeps data on unknown probe results", async () => {
    const { stream, batches } = make();
    probeStatus = 500;
    stream.start();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = sources.length;
      sources.at(-1)!.fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.status).toBe("retrying");
      const expected = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** i);
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(sources.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sources.length).toBe(before + 1);
      delays.push(expected);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(batches).toEqual([]);
    expect(fetchCalls.every((u) => u === "/api/duos/duo-a/pending-work")).toBe(true);
    // A network error on the probe also keeps the stream.
    probeStatus = new Error("offline");
    expect(await stream.probe()).toBe("unknown");
    expect(stream.status).not.toBe("revoked");
  });

  it("revokes on 401 or 404 from the probe: closed for good, nothing more delivered", async () => {
    for (const [status, reason] of [
      [401, "signed-out"],
      [404, "not-member"],
    ] as const) {
      sources = [];
      const { stream, batches } = make();
      stream.start();
      sources[0]!.open();
      probeStatus = status;
      sources[0]!.fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.status).toBe("revoked");
      expect(stream.revokedBy).toBe(reason);
      await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
      expect(sources).toHaveLength(1);
      sources[0]!.message(changed("run"));
      expect(batches).toHaveLength(1);
    }
  });

  it("concurrent probes share one request", async () => {
    const { stream } = make();
    const [a, b] = await Promise.all([stream.probe(), stream.probe()]);
    expect([a, b]).toEqual(["ok", "ok"]);
    expect(fetchCalls).toHaveLength(1);
  });

  it("holds events during a navigation and delivers them once after it commits", () => {
    const { stream, batches } = make();
    stream.start();
    sources[0]!.open();
    batches.length = 0;
    stream.beginNavigation();
    sources[0]!.message(changed("game"));
    sources[0]!.drop();
    sources[0]!.open();
    sources[0]!.message(changed("learning"));
    expect(batches).toEqual([]);
    stream.endNavigation();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.reopened).toBe(true);
    expect(batches[0]!.events.map((e) => (e.type === "changed" ? e.entity : e.type))).toEqual(["game", "learning"]);
    // A navigation with no events delivers nothing.
    stream.beginNavigation();
    stream.endNavigation();
    expect(batches).toHaveLength(1);
  });

  it("switching Duos closes the old connection and drops what it held", () => {
    const { stream, batches } = make("duo-a");
    stream.start();
    sources[0]!.open();
    batches.length = 0;
    stream.beginNavigation();
    sources[0]!.message(changed("game"));
    stream.switchDuo("duo-b");
    expect(sources[0]!.closed).toBe(true);
    expect(sources[1]!.url).toBe("/api/duos/duo-b/events");
    sources[0]!.message(changed("run"));
    stream.endNavigation();
    expect(batches).toEqual([]);
  });

  it("dispose closes the connection and cancels a pending reconnect", async () => {
    const { stream } = make();
    stream.start();
    sources[0]!.fail();
    stream.dispose();
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(sources).toHaveLength(1);
  });
});

describe("refresh dependencies", () => {
  const entities = (duoSseEventSchema.options[1].shape.entity as unknown as { options: string[] }).options;

  it("every existing changed event type reaches Review, and every reconnect refreshes", () => {
    expect(entities.length).toBeGreaterThanOrEqual(11);
    for (const entity of entities) {
      expect(needsRefresh("review", { events: [changed(entity as never)], reopened: false }), entity).toBe(true);
    }
    expect(needsRefresh("review", { events: [], reopened: true })).toBe(true);
  });

  it("the pending-work badge refreshes on Session and run events only", () => {
    const hits = entities.filter((entity) =>
      needsRefresh("pending-work", { events: [changed(entity as never)], reopened: false }),
    );
    expect(hits.sort()).toEqual(["run", "session"]);
  });

  it("Stats refreshes on game, run, learning, reaction and Session bounds; never on replay, chunk, offset or transcript", () => {
    const hits = entities.filter((entity) => needsRefresh("stats", { events: [changed(entity as never)], reopened: false }));
    expect(hits.sort()).toEqual(["game", "learning", "reaction", "run", "session"]);
    const session = (kind?: "bounds" | "chunk" | "offset" | "transcript"): DuoSseEvent => ({ ...changed("session"), ...(kind ? { kind } : {}) }) as DuoSseEvent;
    const one = (ev: DuoSseEvent) => needsRefresh("stats", { events: [ev], reopened: false });
    expect(one(changed("replay"))).toBe(false);
    for (const kind of ["chunk", "offset", "transcript"] as const) expect(one(session(kind)), kind).toBe(false);
    expect(one(session("bounds"))).toBe(true);
    // Delete-speech that removes a Learning also emits a learning event, which rebuilds Stats; one without stays offset-free.
    expect(needsRefresh("stats", { events: [session("chunk"), changed("learning")], reopened: false })).toBe(true);
    expect(needsRefresh("stats", { events: [], reopened: true })).toBe(true);
  });

  it("heartbeats never trigger a refresh on their own", () => {
    const hb: DuoSseEvent = {
      type: "heartbeat",
      playerId: "00000000-0000-4000-8000-000000000001",
      playerName: "P",
      recording: true,
      recordingId: null,
      uploadOk: true,
      pendingChunks: 0,
      transcriptionLagSec: 0,
      geoguessrAuthOk: true,
      seenAt: new Date().toISOString(),
    };
    const batch = { events: [hb], reopened: false };
    expect(needsRefresh("review", batch)).toBe(false);
    expect(heartbeats(batch)).toEqual([hb]);
  });

  it("the schema accepts the scope fields and 'replay'", () => {
    expect(
      duoSseEventSchema.parse({
        type: "changed",
        entity: "session",
        kind: "chunk",
        sessionId: "00000000-0000-4000-8000-000000000001",
        recordingId: "00000000-0000-4000-8000-000000000002",
        at: new Date().toISOString(),
      }),
    ).toMatchObject({ kind: "chunk" });
    expect(duoSseEventSchema.parse(changed("replay"))).toMatchObject({ entity: "replay" });
  });
});

describe("singleFlight", () => {
  it("a burst runs the task at most twice, in order", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const calls: number[] = [];
    let n = 0;
    const run = singleFlight(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      calls.push(++n);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    await Promise.all(Array.from({ length: 10 }, () => run()));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([1, 2]);
    expect(maxConcurrent).toBe(1);
  });

  it("responses arriving in reverse order never leave the older payload showing", async () => {
    // Two refreshes: the first fetch answers last. Single-flight starts the second only after the first lands.
    const answers: Array<(v: string) => void> = [];
    let shown = "load";
    let version = 0;
    const fetchStats = () => new Promise<string>((resolve) => answers.push(resolve));
    const refresh = singleFlight(async () => {
      shown = await fetchStats();
    });
    const first = refresh();
    void refresh();
    expect(answers).toHaveLength(1);
    // The server has the newer payload by the time the queued refresh asks.
    answers[0]!(`v${++version}`);
    await new Promise((r) => setTimeout(r, 0));
    expect(shown).toBe("v1");
    expect(answers).toHaveLength(2);
    answers[1]!(`v${++version}`);
    await first;
    expect(shown).toBe("v2");
  });

  it("runs again when the task asks for it", async () => {
    let n = 0;
    const run = singleFlight(async () => ++n < 3);
    await run();
    expect(n).toBe(3);
  });
});
