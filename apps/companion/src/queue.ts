export interface TranscriptionJob {
  id: string;
  priority: "live" | "retranscribe";
  recordingId: string;
  transcriptVersionId: string;
  chunkNo: number;
  pcmPath: string;
  hotwords: string[];
  offsetMs: number;
  enqueuedAtMs?: number;
  completeAfter?: { totalChunks: number };
}

/**
 * Single transcription queue that always runs live chunks ahead of re-transcription jobs
 * and pauses re-transcription whenever a live Recording is active.
 */
export class PriorityTranscriptionQueue {
  private liveQueue: TranscriptionJob[] = [];
  private retransQueue: TranscriptionJob[] = [];
  private liveActive = false;
  private running = false;

  constructor(private readonly worker: (job: TranscriptionJob) => Promise<void>) {}

  setLiveRecordingActive(active: boolean): void {
    this.liveActive = active;
  }

  isLiveRecordingActive(): boolean {
    return this.liveActive;
  }

  enqueue(job: TranscriptionJob): void {
    const withTs = { ...job, enqueuedAtMs: job.enqueuedAtMs ?? Date.now() };
    if (withTs.priority === "live") {
      this.liveQueue.push(withTs);
    } else {
      this.retransQueue.push(withTs);
    }
  }

  getLagSeconds(nowMs: number = Date.now()): number {
    const oldest = this.liveQueue[0];
    if (!oldest?.enqueuedAtMs) return 0;
    return Math.max(0, (nowMs - oldest.enqueuedAtMs) / 1000);
  }

  getDepth(): { live: number; retranscribe: number } {
    return { live: this.liveQueue.length, retranscribe: this.retransQueue.length };
  }

  private nextJob(): TranscriptionJob | undefined {
    if (this.liveQueue.length > 0) {
      return this.liveQueue.shift();
    }
    if (!this.liveActive && this.retransQueue.length > 0) {
      return this.retransQueue.shift();
    }
    return undefined;
  }

  async drainAvailable(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      while (true) {
        const job = this.nextJob();
        if (!job) break;
        await this.worker(job);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }
}
