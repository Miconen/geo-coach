import type { DuoSseEvent } from "@geo-coach/shared";
import type { StreamBatch } from "./duo-stream.js";

type Changed = Extract<DuoSseEvent, { type: "changed" }>;
export type ChangedEntity = Changed["entity"];

/** Which consumer a batch is checked against (#56 X5 Consumers). */
export type Consumer = "review" | "pending-work" | "game" | "round" | "session" | "session-runs";

/** X5 Consumers, by event type (learning and reaction name no Game, Round or Session: pages refresh Duo-wide). */
const CONSUMES: Record<Exclude<Consumer, "review" | "pending-work">, ReadonlySet<ChangedEntity>> = {
  game: new Set(["game", "replay", "learning", "reaction", "run", "processing", "session", "claim", "source", "corrections"]),
  round: new Set(["game", "replay", "learning", "reaction", "run", "processing", "session", "claim", "source", "corrections"]),
  session: new Set(["session", "game", "run", "learning", "processing", "reaction", "claim", "corrections"]),
  // Events that change RunTimeline rows or counts: they reset the paged history to page one.
  "session-runs": new Set(["run", "processing", "claim", "learning", "session"]),
};

/** True when the batch needs one refresh for this consumer: always after a (re)connection, else per event type. */
export function needsRefresh(consumer: Consumer, batch: StreamBatch): boolean {
  if (batch.reopened) return true;
  return batch.events.some((ev) => ev.type === "changed" && matches(consumer, ev));
}

function matches(consumer: Consumer, ev: Changed): boolean {
  switch (consumer) {
    // Review refreshes on every changed event, 'replay' included (as it did before the store).
    case "review":
      return true;
    // The chrome's pending-work badge: Session changes of any kind and runs change pending ranges.
    case "pending-work":
      return ev.entity === "session" || ev.entity === "run";
    default:
      return CONSUMES[consumer].has(ev.entity);
  }
}

/** Heartbeats in a batch (Review and the Session page show them). */
export function heartbeats(batch: StreamBatch) {
  return batch.events.filter((ev): ev is Extract<DuoSseEvent, { type: "heartbeat" }> => ev.type === "heartbeat");
}
