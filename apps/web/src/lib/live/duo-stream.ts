import type { DuoSseEvent } from "@geo-coach/shared";

/**
 * One server-sent event connection per tab, owned by the Duo layout (#56 X5, 1b-live(i)).
 *
 * Pages subscribe for batches: one event at a time normally, or every event received while a navigation was in
 * flight, delivered once after it commits (so the destination reconciles against its own dependencies). `reopened`
 * marks a (re)connection: listeners fetch once to catch up, since the stream never replays missed events. On the
 * first open after a page load the server's sync event says when the Duo last changed: when that is not after the
 * page data was served (servedAt), there is nothing to catch up on and no refetch happens.
 */
export interface StreamBatch {
  events: DuoSseEvent[];
  reopened: boolean;
}
export type StreamListener = (batch: StreamBatch) => void;

/** "revoked": the probe got 401 (signed out) or 404 (no longer a member); the stream stays closed. */
export type StreamStatus = "idle" | "connecting" | "open" | "retrying" | "revoked";
export type ProbeResult = "ok" | "signed-out" | "not-member" | "unknown";

export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  close(): void;
}

export interface DuoStreamDeps {
  createEventSource: (url: string) => EventSourceLike;
  fetch: (url: string) => Promise<{ status: number }>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const CLOSED = 2;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

export class DuoStream {
  status: StreamStatus = "idle";
  /** Why the stream was revoked, for the layout's message. */
  revokedBy: Exclude<ProbeResult, "ok" | "unknown"> | null = null;

  private es: EventSourceLike | null = null;
  private listeners = new Set<StreamListener>();
  private statusListeners = new Set<(status: StreamStatus) => void>();
  private navigating = 0;
  private held: StreamBatch | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private probing: Promise<ProbeResult> | null = null;
  private started = false;
  /** The page data's server time, until the first open's sync event decides whether to catch up. */
  private servedAt: number | null = null;

  constructor(
    private duoId: string,
    private deps: DuoStreamDeps,
  ) {}

  /** Connects (browser only). Idempotent. servedAt: when the page data was served (server clock, ms). */
  start(servedAt: number | null = null): void {
    if (this.started) return;
    this.started = true;
    this.servedAt = servedAt;
    this.connect();
  }

  /** Points the stream at another Duo: closes the old connection and drops anything held for it. */
  switchDuo(duoId: string, servedAt: number | null = null): void {
    if (duoId === this.duoId) return;
    this.duoId = duoId;
    this.servedAt = servedAt;
    this.held = null;
    this.revokedBy = null;
    this.teardown();
    this.attempt = 0;
    this.setStatus("idle");
    if (this.started) this.connect();
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** A navigation started: hold events until it commits or is abandoned. */
  beginNavigation(): void {
    this.navigating += 1;
  }

  /** The navigation committed (or failed): deliver what was held, once. */
  endNavigation(): void {
    this.navigating = Math.max(0, this.navigating - 1);
    if (this.navigating > 0 || !this.held) return;
    const batch = this.held;
    this.held = null;
    this.emit(batch);
  }

  /**
   * Authorization probe (X5): 401 or 404 from pending-work revokes the stream (rendered Duo data is cleared by the
   * layout); anything else keeps data. Concurrent callers share one request.
   */
  probe(): Promise<ProbeResult> {
    if (this.status === "revoked") return Promise.resolve(this.revokedBy ?? "not-member");
    if (this.probing) return this.probing;
    const duoId = this.duoId;
    this.probing = this.deps
      .fetch(`/api/duos/${duoId}/pending-work?probe=1`)
      .then((res): ProbeResult => (res.status === 401 ? "signed-out" : res.status === 404 ? "not-member" : res.status === 200 ? "ok" : "unknown"))
      .catch((): ProbeResult => "unknown")
      .then((result) => {
        this.probing = null;
        if (duoId === this.duoId && (result === "signed-out" || result === "not-member")) this.revoke(result);
        return result;
      });
    return this.probing;
  }

  dispose(): void {
    this.teardown();
    this.listeners.clear();
    this.statusListeners.clear();
    this.held = null;
    this.started = false;
  }

  private revoke(reason: "signed-out" | "not-member") {
    this.revokedBy = reason;
    this.held = null;
    this.teardown();
    this.setStatus("revoked");
  }

  private teardown() {
    if (this.retryTimer !== null) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.es) {
      this.es.onopen = this.es.onmessage = this.es.onerror = null;
      this.es.close();
    }
    this.es = null;
  }

  private connect() {
    if (this.status === "revoked") return;
    this.setStatus("connecting");
    const es = this.deps.createEventSource(`/api/duos/${this.duoId}/events`);
    this.es = es;
    es.onopen = () => {
      if (es !== this.es) return;
      this.attempt = 0;
      this.setStatus("open");
      // The first open after a page load waits for the sync event; every other open catches up at once.
      if (this.servedAt === null) this.deliver({ events: [], reopened: true });
    };
    es.onmessage = (ev) => {
      if (es !== this.es) return;
      let parsed: DuoSseEvent;
      try {
        parsed = JSON.parse(String(ev.data)) as DuoSseEvent;
      } catch {
        return;
      }
      if (parsed.type === "sync") {
        const servedAt = this.servedAt;
        this.servedAt = null;
        if (servedAt !== null && Date.parse(parsed.changedAt) > servedAt) this.deliver({ events: [], reopened: true });
        return;
      }
      this.deliver({ events: [parsed], reopened: false });
    };
    es.onerror = () => {
      if (es !== this.es) return;
      // A lost first connection catches up in full on the next open.
      this.servedAt = null;
      void this.probe();
      // EventSource retries by itself unless the response was an HTTP error; then it is closed for good.
      if (es.readyState === CLOSED) {
        es.onopen = es.onmessage = es.onerror = null;
        es.close();
        this.es = null;
        this.scheduleReconnect();
      } else {
        this.setStatus("retrying");
      }
    };
  }

  private scheduleReconnect() {
    if (this.status === "revoked") return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    this.setStatus("retrying");
    this.retryTimer = this.deps.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private deliver(batch: StreamBatch) {
    if (this.navigating > 0) {
      this.held = this.held
        ? { events: [...this.held.events, ...batch.events], reopened: this.held.reopened || batch.reopened }
        : batch;
      return;
    }
    this.emit(batch);
  }

  private emit(batch: StreamBatch) {
    for (const listener of [...this.listeners]) {
      try {
        listener(batch);
      } catch {
        // One page's handler never breaks another's.
      }
    }
  }

  private setStatus(status: StreamStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }
}

/** The browser's EventSource, fetch and timers. */
export function browserStreamDeps(): DuoStreamDeps {
  return {
    createEventSource: (url) => new EventSource(url),
    fetch: (url) => fetch(url, { headers: { accept: "application/json" } }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
