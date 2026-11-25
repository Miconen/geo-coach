import type { DuoSseEvent } from "@geo-coach/shared";

type Listener = (event: DuoSseEvent) => void;
type ChangedEvent = Extract<DuoSseEvent, { type: "changed" }>;

export interface PlayerLiveStatus {
  playerId: string;
  playerName: string;
  recording: boolean;
  recordingId: string | null;
  uploadOk: boolean;
  pendingChunks: number;
  transcriptionLagSec: number;
  geoguessrAuthOk: boolean;
  seenAt: string;
}

class DuoEventBus {
  private listeners = new Map<string, Set<Listener>>();
  /** When each Duo last had a changed event in this process; before any, the process start. */
  private lastChanged = new Map<string, number>();
  private readonly startedAt = Date.now();

  changedAt(duoId: string): number {
    return this.lastChanged.get(duoId) ?? this.startedAt;
  }
  /** How many changed events each Duo has had in this process: a cache version (workbench/cache.ts). */
  private changes = new Map<string, number>();

  changeCount(duoId: string): number {
    return this.changes.get(duoId) ?? 0;
  }
  private heartbeats = new Map<string, Map<string, PlayerLiveStatus>>();

  subscribe(duoId: string, listener: Listener): () => void {
    let set = this.listeners.get(duoId);
    if (!set) {
      set = new Set();
      this.listeners.set(duoId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(duoId);
      }
    };
  }

  publish(duoId: string, event: DuoSseEvent): void {
    if (event.type === "heartbeat") {
      let map = this.heartbeats.get(duoId);
      if (!map) {
        map = new Map();
        this.heartbeats.set(duoId, map);
      }
      map.set(event.playerId, {
        playerId: event.playerId,
        playerName: event.playerName,
        recording: event.recording,
        recordingId: event.recordingId,
        uploadOk: event.uploadOk,
        pendingChunks: event.pendingChunks,
        transcriptionLagSec: event.transcriptionLagSec,
        geoguessrAuthOk: event.geoguessrAuthOk,
        seenAt: event.seenAt,
      });
    }

    if (event.type === "changed") {
      this.lastChanged.set(duoId, Date.now());
      this.changes.set(duoId, this.changeCount(duoId) + 1);
    }

    const set = this.listeners.get(duoId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  emitChanged(
    duoId: string,
    entity: Extract<DuoSseEvent, { type: "changed" }>["entity"],
    id?: string,
    scope: Pick<ChangedEvent, "sessionId" | "recordingId" | "kind"> = {},
  ): void {
    this.publish(duoId, {
      type: "changed",
      entity,
      id,
      ...scope,
      at: new Date().toISOString(),
    });
  }

  getLiveStatuses(duoId: string): PlayerLiveStatus[] {
    const map = this.heartbeats.get(duoId);
    if (!map) return [];
    const cutoff = Date.now() - 90_000;
    return [...map.values()].filter((s) => Date.parse(s.seenAt) >= cutoff);
  }
}

export const duoEventBus = new DuoEventBus();
