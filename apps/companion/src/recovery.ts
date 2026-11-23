import { stat } from "node:fs/promises";
import type { CompanionStore } from "./store.js";

/**
 * Finishes Recordings that were never stopped because the Companion crashed or the PC lost
 * power mid-Recording: sets their length from the audio on disk, converts it to FLAC, and
 * queues the stop for the server (which already closed it as "reconnect" if the page
 * reconnected into a new Recording). Returns how many were recovered.
 */
export async function recoverUnfinishedRecordings(
  store: CompanionStore,
  convertPcmToFlac: (pcmPath: string) => Promise<string | null>,
  activeRecordingId: string | null = null,
): Promise<number> {
  let recovered = 0;
  for (const rec of store.listLocalRecordings()) {
    if (rec.stoppedAt || rec.id === activeRecordingId || rec.audioFormat !== "pcm") continue;

    const pcmBytes = (await stat(rec.audioPath).catch(() => null))?.size ?? 0;
    const durationMs = Math.round((pcmBytes / 2 / 16000) * 1000);
    const stopIso = new Date(rec.clockAnchorMs + durationMs).toISOString();

    store.enqueueOutbox("stopRecording", `stop:${rec.id}`, {
      recordingId: rec.id,
      stoppedAt: stopIso,
      stopReason: "reconnect",
    });

    const flacPath = pcmBytes > 0 ? await convertPcmToFlac(rec.audioPath) : null;
    const finalBytes = flacPath ? ((await stat(flacPath).catch(() => null))?.size ?? pcmBytes) : pcmBytes;
    store.saveLocalRecording({
      ...rec,
      stoppedAt: stopIso,
      stopReason: "reconnect",
      audioPath: flacPath ?? rec.audioPath,
      audioFormat: flacPath ? "flac" : "pcm",
      durationMs,
      bytes: finalBytes,
    });
    recovered += 1;
  }
  return recovered;
}
