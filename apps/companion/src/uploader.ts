import type { CompanionStore, OutboxItem } from "./store.js";

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export function computeBackoffMs(attempts: number): number {
  const safeAttempts = Math.max(1, attempts);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (safeAttempts - 1));
}

export interface SendOutboxResult {
  ok: boolean;
  updateRequired?: boolean;
  highestContiguousChunkNo?: number;
}

export class OutboxUploader {
  public lastUploadOk = true;
  public updateRequired = false;

  constructor(
    private readonly store: CompanionStore,
    private readonly sender: (item: OutboxItem) => Promise<SendOutboxResult>,
  ) {}

  private scheduleRetry(item: OutboxItem, nowMs: number): void {
    this.lastUploadOk = false;
    const nextAttempts = item.attempts + 1;
    this.store.scheduleOutboxRetry(item.id, nextAttempts, nowMs + computeBackoffMs(nextAttempts));
  }

  async drainOnce(nowMs: number = Date.now()): Promise<{ sent: number; failed: number }> {
    const pending = this.store.listPendingOutbox(nowMs);
    let sent = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const res = await this.sender(item);
        if (res.updateRequired) {
          this.updateRequired = true;
          this.scheduleRetry(item, nowMs);
          failed += 1;
          break;
        }

        if (!res.ok) {
          this.scheduleRetry(item, nowMs);
          failed += 1;
          // Preserve strict ordering on transient failures
          break;
        }

        this.store.markOutboxSent(item.id);
        this.lastUploadOk = true;
        this.updateRequired = false;
        sent += 1;

        if (item.kind === "chunk" && typeof res.highestContiguousChunkNo === "number") {
          const parsed = JSON.parse(item.payloadJson) as {
            transcriptVersionId?: string;
            chunkNo?: number;
          };
          if (
            parsed.transcriptVersionId &&
            typeof parsed.chunkNo === "number" &&
            res.highestContiguousChunkNo < parsed.chunkNo
          ) {
            this.store.requeueChunkGaps(
              parsed.transcriptVersionId,
              res.highestContiguousChunkNo,
              parsed.chunkNo,
            );
          }
        }
      } catch {
        this.scheduleRetry(item, nowMs);
        failed += 1;
        break;
      }
    }

    return { sent, failed };
  }
}
