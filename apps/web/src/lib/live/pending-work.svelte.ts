import { getContext, setContext } from "svelte";
import type { PendingWork } from "@geo-coach/shared";

export const WORKER_POLL_MS = 15_000;

/**
 * The Duo chrome's pending work (#56 1b-shell, 2a(i)): extract ranges for the badge and whether the processing
 * worker is online. Refetched by the layout on stream (re)opens and Session or run events; while Review or the
 * Session page is mounted it also polls every 15 s (worker status changes without an event), and at once after an
 * enqueue answered 503.
 */
export class PendingWorkStore {
  extractCount = $state<number | null>(null);
  workerOnline = $state<boolean | null>(null);
  private duoId: string;
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    duoId: string,
    private onAuthError: () => void,
  ) {
    this.duoId = duoId;
  }

  setDuo(duoId: string): void {
    if (duoId === this.duoId) return;
    this.duoId = duoId;
    this.extractCount = null;
    this.workerOnline = null;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const id = this.duoId;
    try {
      const res = await fetch(`/api/duos/${id}/pending-work`);
      if (res.status === 401 || res.status === 404) this.onAuthError();
      if (!res.ok) return;
      const body = (await res.json()) as PendingWork;
      if (id !== this.duoId) return;
      this.extractCount = body.ranges.filter((r) => r.purpose === "extract").reduce((sum, r) => sum + r.count, 0);
      this.workerOnline = body.workerOnline;
    } catch {
      // Offline: keep what is shown.
    }
  }

  /** Polls worker status while the caller is mounted; returns the stop function. */
  watchWorker(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) this.timer = setInterval(() => void this.refresh(), WORKER_POLL_MS);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.watchers -= 1;
      if (this.watchers === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watchers = 0;
  }
}

const KEY = Symbol("pending-work");

export function setPendingWork(store: PendingWorkStore): void {
  setContext(KEY, store);
}

export function getPendingWork(): PendingWorkStore | null {
  return getContext<PendingWorkStore | undefined>(KEY) ?? null;
}
