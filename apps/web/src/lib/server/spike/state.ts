/** Spike-only server state for the router spike (#56 0-spike, ADR 0007). Never reachable unless E2E_SPIKE=1. */
export const spikeState = {
  loads: new Map<string, number>(),
  revoked: new Set<string>(),
  streams: new Set<ReadableStreamDefaultController<string>>(),
  nextEventId: 1,
};

export function spikeEnabled(): boolean {
  return process.env.E2E_SPIKE === "1";
}

export function countLoad(key: string): number {
  const n = (spikeState.loads.get(key) ?? 0) + 1;
  spikeState.loads.set(key, n);
  return n;
}

export function emitSpikeEvent(): number {
  const id = spikeState.nextEventId++;
  for (const c of spikeState.streams) {
    try {
      c.enqueue(`data: ${JSON.stringify({ id })}\n\n`);
    } catch {
      spikeState.streams.delete(c);
    }
  }
  return id;
}
