import { readFile } from "node:fs/promises";
import type { ChunkUtterance } from "@geo-coach/shared";

export interface TranscriberResponse {
  model: string;
  utterances: ChunkUtterance[];
}

export type TranscriberHealth = "ready" | "loading" | "idle" | "offline";

interface TranscriberSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  avg_logprob?: number;
  no_speech_prob?: number;
  words?: Array<{ word: string; start_ms: number; end_ms: number; probability: number }>;
}

const STOCK_HALLUCINATION =
  /\b(?:thanks|thank you) for watching\b|\blike,? comment,? and subscribe\b|\bsubscribe to (?:the|my|our) channel\b|\bsubtitles by\b|\bamara\.org\b/i;
const MIN_RECOVERED_CONFIDENCE = 0.5;

function hotwordTokens(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  );
}

function meanWordProbability(segment: { words?: Array<{ probability: number }> }): number | null {
  const words = segment.words ?? [];
  if (words.length === 0) return null;
  return words.reduce((sum, w) => sum + w.probability, 0) / words.length;
}

/** Whisper can recite its hotword prompt, or stock video outros, instead of what was said. */
export function isHallucinatedSegment(
  segment: { text: string; words?: Array<{ probability: number }> },
  hotwords: readonly string[],
): boolean {
  if (STOCK_HALLUCINATION.test(segment.text)) return true;
  const confidence = meanWordProbability(segment);
  if (confidence === null) return false;

  const phrases = hotwords
    .map(hotwordTokens)
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
  const tokens = hotwordTokens(segment.text);
  if (tokens.length === 0) return false;

  let covered = 0;
  let matches = 0;
  for (let i = 0; i < tokens.length; ) {
    const at = i;
    const phrase = phrases.find((p) => p.every((w, j) => tokens[at + j] === w));
    if (phrase) {
      covered += phrase.length;
      matches += 1;
      i += phrase.length;
    } else {
      i += 1;
    }
  }
  if (covered / tokens.length < 0.8) return false;
  return matches >= 3 ? confidence < 0.7 : matches === 2 && confidence < 0.4;
}

function segmentsOverlap(a: TranscriberSegment, b: TranscriberSegment): boolean {
  return a.start_ms < b.end_ms && b.start_ms < a.end_ms;
}

export class TranscriberClient {
  private readonly mode: "fake" | "http";
  private readonly baseUrl: string;

  constructor(opts: { mode?: "fake" | "http"; baseUrl?: string } = {}) {
    this.mode = opts.mode ?? (process.env.TRANSCRIBER_MODE === "fake" ? "fake" : "http");
    this.baseUrl = (opts.baseUrl ?? process.env.TRANSCRIBER_URL ?? "http://127.0.0.1:8787").replace(
      /\/$/,
      "",
    );
  }

  /** ready: model on the GPU · loading: cold load running · idle: up, model unloaded · offline: unreachable */
  async health(): Promise<TranscriberHealth> {
    if (this.mode === "fake") return "ready";
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return "offline";
      const data = (await res.json()) as { loadedModel?: string | null; loading?: boolean };
      if (data.loading) return "loading";
      return data.loadedModel ? "ready" : "idle";
    } catch {
      return "offline";
    }
  }

  async warmLoad(): Promise<void> {
    if (this.mode === "fake") return;
    try {
      await fetch(`${this.baseUrl}/load`, { method: "POST" });
    } catch {
      // Transcriber may warm lazily on first chunk
    }
  }

  async transcribePcmChunk(opts: {
    pcmPath: string;
    chunkOffsetMs: number;
    hotwords: string[];
  }): Promise<TranscriberResponse> {
    if (this.mode === "fake") {
      const buf = await readFile(opts.pcmPath);
      const durationMs = Math.max(500, Math.round((buf.byteLength / 2 / 16000) * 1000));
      const hint = opts.hotwords[0] ? ` (${opts.hotwords[0]})` : "";
      return {
        model: "fake-transcriber",
        utterances: [
          {
            text: `Fake transcribed segment at ${Math.round(opts.chunkOffsetMs / 1000)}s${hint}`,
            startSampleMs: opts.chunkOffsetMs,
            endSampleMs: opts.chunkOffsetMs + durationMs,
            words: [],
            avgLogprob: -0.2,
            noSpeechProb: 0.05,
          },
        ],
      };
    }

    const pcmBytes = await readFile(opts.pcmPath);
    const data = await this.requestSegments(pcmBytes, opts.hotwords, opts.chunkOffsetMs);
    let segments = data.segments;
    const echoes = segments.filter((s) => isHallucinatedSegment(s, opts.hotwords));
    if (echoes.length > 0) {
      // An echo can overwrite short real speech, so recover those spans from a plain pass.
      const plain = await this.requestSegments(pcmBytes, [], opts.chunkOffsetMs);
      const kept = segments.filter((s) => !echoes.includes(s));
      const recovered = plain.segments.filter(
        (s) =>
          !isHallucinatedSegment(s, []) &&
          (meanWordProbability(s) ?? 0) >= MIN_RECOVERED_CONFIDENCE &&
          echoes.some((e) => segmentsOverlap(e, s)) &&
          !kept.some((k) => segmentsOverlap(k, s)),
      );
      segments = [...kept, ...recovered].sort((a, b) => a.start_ms - b.start_ms);
    }

    return {
      model: data.model,
      utterances: segments
        .filter((s) => s.text.trim().length > 0)
        .map((s) => ({
          text: s.text.trim(),
          startSampleMs: opts.chunkOffsetMs + s.start_ms,
          endSampleMs: opts.chunkOffsetMs + s.end_ms,
          avgLogprob: s.avg_logprob ?? null,
          noSpeechProb: s.no_speech_prob ?? null,
          words: (s.words ?? []).map((w) => ({
            word: w.word,
            startMs: opts.chunkOffsetMs + w.start_ms,
            endMs: opts.chunkOffsetMs + w.end_ms,
            probability: w.probability,
          })),
        })),
    };
  }

  private async requestSegments(
    pcmBytes: Buffer,
    hotwords: readonly string[],
    chunkOffsetMs: number,
  ): Promise<{ model: string; segments: TranscriberSegment[] }> {
    const res = await fetch(`${this.baseUrl}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Hotwords": encodeURIComponent(hotwords.join(" ")),
        "X-Hotwords-Encoding": "uri",
        "X-Offset-Ms": String(chunkOffsetMs),
      },
      body: pcmBytes,
    });

    if (!res.ok) {
      throw new Error(`Transcriber failed (${res.status}): ${await res.text()}`);
    }

    return (await res.json()) as { model: string; segments: TranscriberSegment[] };
  }
}
