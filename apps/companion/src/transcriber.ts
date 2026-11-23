import { readFile } from "node:fs/promises";
import type { ChunkUtterance } from "@geo-coach/shared";

export interface TranscriberResponse {
  model: string;
  utterances: ChunkUtterance[];
}

export type TranscriberHealth = "ready" | "loading" | "idle" | "offline";

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
    const res = await fetch(`${this.baseUrl}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Hotwords": opts.hotwords.join(" "),
        "X-Offset-Ms": String(opts.chunkOffsetMs),
      },
      body: pcmBytes,
    });

    if (!res.ok) {
      throw new Error(`Transcriber failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as {
      model: string;
      segments: Array<{
        text: string;
        start_ms: number;
        end_ms: number;
        avg_logprob?: number;
        no_speech_prob?: number;
        words?: Array<{ word: string; start_ms: number; end_ms: number; probability: number }>;
      }>;
    };

    return {
      model: data.model,
      utterances: data.segments
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
}
