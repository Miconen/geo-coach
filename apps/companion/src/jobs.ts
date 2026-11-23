export type TranscriptKind = "live" | "retranscribe";

interface TranscriptProgress {
  transcriptVersionId: string;
  recordingId: string;
  kind: TranscriptKind;
  chunksQueued: number;
  chunksDone: number;
  lastError: string | null;
  updatedAtMs: number;
}

export type RecordingStatus =
  | { state: "recording"; chunksQueued: number; chunksDone: number; error: string | null }
  | { state: "transcribing"; kind: TranscriptKind; chunksQueued: number; chunksDone: number; error: string | null }
  | { state: "uploading"; kind: TranscriptKind; pendingUploads: number }
  | { state: "done"; kind: TranscriptKind };

/**
 * In-memory progress of each Transcript Version's chunks through the transcription queue,
 * so the recording page can show what is happening. Lost on restart, like the queue itself.
 */
export class TranscriptJobTracker {
  private readonly byVersion = new Map<string, TranscriptProgress>();

  chunkQueued(transcriptVersionId: string, recordingId: string, kind: TranscriptKind): void {
    const p = this.byVersion.get(transcriptVersionId) ?? {
      transcriptVersionId,
      recordingId,
      kind,
      chunksQueued: 0,
      chunksDone: 0,
      lastError: null,
      updatedAtMs: 0,
    };
    p.chunksQueued += 1;
    p.updatedAtMs = Date.now();
    this.byVersion.set(transcriptVersionId, p);
  }

  chunkDone(transcriptVersionId: string): void {
    const p = this.byVersion.get(transcriptVersionId);
    if (!p) return;
    p.chunksDone += 1;
    p.lastError = null;
    p.updatedAtMs = Date.now();
  }

  chunkFailed(transcriptVersionId: string, err: unknown): void {
    const p = this.byVersion.get(transcriptVersionId);
    if (!p) return;
    p.lastError = err instanceof Error ? err.message : String(err);
    p.updatedAtMs = Date.now();
  }

  /** The most recently touched Transcript Version of a Recording */
  latestFor(recordingId: string): TranscriptProgress | null {
    let latest: TranscriptProgress | null = null;
    for (const p of this.byVersion.values()) {
      if (p.recordingId === recordingId && (!latest || p.updatedAtMs >= latest.updatedAtMs)) latest = p;
    }
    return latest;
  }

  /** Status of a Recording, or null when nothing ran for it since the Companion started */
  statusOf(
    recordingId: string,
    opts: { isActive: boolean; pendingUploads: (transcriptVersionId: string) => number },
  ): RecordingStatus | null {
    const p = this.latestFor(recordingId);
    if (opts.isActive) {
      return {
        state: "recording",
        chunksQueued: p?.chunksQueued ?? 0,
        chunksDone: p?.chunksDone ?? 0,
        error: p?.lastError ?? null,
      };
    }
    if (!p) return null;
    if (p.chunksDone < p.chunksQueued) {
      return {
        state: "transcribing",
        kind: p.kind,
        chunksQueued: p.chunksQueued,
        chunksDone: p.chunksDone,
        error: p.lastError,
      };
    }
    const pendingUploads = opts.pendingUploads(p.transcriptVersionId);
    if (pendingUploads > 0) return { state: "uploading", kind: p.kind, pendingUploads };
    return { state: "done", kind: p.kind };
  }

  isBusy(): boolean {
    for (const p of this.byVersion.values()) {
      if (p.chunksDone < p.chunksQueued) return true;
    }
    return false;
  }
}
