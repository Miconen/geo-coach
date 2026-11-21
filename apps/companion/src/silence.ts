/**
 * Tracks detected speech timestamps during a live Recording and triggers auto-stop
 * after `timeoutMs` (default 30 min) of continuous silence, returning the trimmed stop timestamp.
 */
export class SilenceWatcher {
  private lastSpeechMs: number;

  constructor(
    private readonly timeoutMs: number = 30 * 60 * 1000,
    startedAtMs: number = Date.now(),
  ) {
    this.lastSpeechMs = startedAtMs;
  }

  recordSpeech(atMs: number = Date.now()): void {
    if (atMs > this.lastSpeechMs) {
      this.lastSpeechMs = atMs;
    }
  }

  getLastSpeechMs(): number {
    return this.lastSpeechMs;
  }

  /**
   * Returns the trimmed stop timestamp (last speech) if silence exceeded timeoutMs, else null.
   */
  checkAutoStop(nowMs: number = Date.now()): number | null {
    if (nowMs - this.lastSpeechMs >= this.timeoutMs) {
      return this.lastSpeechMs;
    }
    return null;
  }
}
