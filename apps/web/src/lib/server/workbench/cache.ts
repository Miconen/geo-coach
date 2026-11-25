import type { AppDb } from "../db/index.js";
import { duoEventBus } from "../events/bus.js";
import { isProcessorOnline } from "../mcp/processing-jobs.js";
import { buildWorkbenchData, type WorkbenchData, type WorkbenchOptions } from "./view-model.js";

/**
 * Pages and their refresh endpoints all slice one derivation, which costs a few hundred ms on a large Duo. It is
 * cached per Duo, viewer and options until the Duo's next changed event (every write path emits one) or MAX_AGE_MS,
 * which bounds writes that emit nothing (open runs' drafts, job leases expiring). A build that a changed event
 * overtakes is served to its own callers but never cached. Heartbeat and worker status are read fresh on every call.
 * Callers must not mutate the result.
 */
const MAX_AGE_MS = 15_000;
// An entry is ~12 MB at 7k Claims and 12k Utterances; a Duo's two Players and their Session pages fit in eight.
const MAX_ENTRIES = 8;

interface Entry {
  version: number;
  at: number;
  data: Promise<WorkbenchData>;
}

const entries = new Map<string, Entry>();

/** Drops every cached derivation: e2e calls it (through /spike/control) after writing straight to the database. */
export function clearWorkbenchCache(): void {
  entries.clear();
}

export async function loadWorkbench(
  db: AppDb,
  duoId: string,
  viewerPlayerId: string,
  options: WorkbenchOptions = {},
): Promise<WorkbenchData> {
  const key = [duoId, viewerPlayerId, options.speech ?? "all", options.sessionId ?? "", options.runId ?? ""].join("|");
  const version = duoEventBus.changeCount(duoId);
  let entry = entries.get(key);
  if (!entry || entry.version !== version || Date.now() - entry.at > MAX_AGE_MS) {
    const data = buildWorkbenchData(db, duoId, viewerPlayerId, options);
    entry = { version, at: Date.now(), data };
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    const built = entry;
    data.then(
      () => {
        if (duoEventBus.changeCount(duoId) !== version && entries.get(key) === built) entries.delete(key);
      },
      () => {
        if (entries.get(key) === built) entries.delete(key);
      },
    );
  } else {
    // LRU: a hit moves to the back.
    entries.delete(key);
    entries.set(key, entry);
  }
  const wb = await entry.data;
  return {
    ...wb,
    liveStatuses: duoEventBus.getLiveStatuses(duoId),
    processing: { ...wb.processing, workerOnline: isProcessorOnline() },
  };
}
