import { execFile } from "node:child_process";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Computes simple RMS energy over 16-bit signed little-endian PCM to detect speech activity.
 */
export function computePcmRms(pcmBuffer: Buffer): number {
  const sampleCount = Math.floor(pcmBuffer.byteLength / 2);
  if (sampleCount === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2) / 32768;
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / sampleCount);
}

/**
 * Converts a finished 16 kHz mono Int16 raw PCM Recording to lossless FLAC using ffmpeg.
 * Returns the FLAC path if conversion succeeded, or null if ffmpeg is unavailable.
 */
export async function convertPcmToFlac(pcmPath: string): Promise<string | null> {
  const flacPath = pcmPath.replace(/\.pcm$/i, ".flac");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-i",
      pcmPath,
      "-c:a",
      "flac",
      flacPath,
    ]);
    await unlink(pcmPath).catch(() => {});
    return flacPath;
  } catch {
    return null;
  }
}

export async function computeAudioDiskUsageBytes(audioDir: string): Promise<number> {
  try {
    const entries = await readdir(audioDir);
    let total = 0;
    for (const name of entries) {
      const s = await stat(path.join(audioDir, name)).catch(() => null);
      if (s?.isFile()) total += s.size;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function deleteAudioOlderThan(
  audioDir: string,
  cutoffDate: Date,
): Promise<{ deletedFiles: number; freedBytes: number }> {
  let deletedFiles = 0;
  let freedBytes = 0;
  try {
    const entries = await readdir(audioDir);
    for (const name of entries) {
      if (!name.endsWith(".flac") && !name.endsWith(".pcm")) continue;
      const fullPath = path.join(audioDir, name);
      const s = await stat(fullPath).catch(() => null);
      if (s?.isFile() && s.mtimeMs < cutoffDate.getTime()) {
        await unlink(fullPath);
        deletedFiles += 1;
        freedBytes += s.size;
      }
    }
  } catch {
    // ignore missing dir
  }
  return { deletedFiles, freedBytes };
}
