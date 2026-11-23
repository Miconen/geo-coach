import { DatabaseSync } from "node:sqlite";

export type OutboxKind =
  | "startRecording"
  | "stopRecording"
  | "offset"
  | "startRetranscription"
  | "chunk"
  | "completeTranscript"
  | "game"
  | "replay";

export interface OutboxItem {
  id: number;
  kind: OutboxKind;
  dedupeKey: string;
  payloadJson: string;
  status: "pending" | "sent";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
}

export interface LocalRecordingRow {
  id: string;
  duoId: string;
  transcriptVersionId: string;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  clockAnchorMs: number;
  audioPath: string;
  audioFormat: "pcm" | "flac" | "deleted";
  durationMs: number;
  bytes: number;
}

export class CompanionStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_recordings (
        id TEXT PRIMARY KEY,
        duo_id TEXT NOT NULL,
        transcript_version_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        stop_reason TEXT,
        clock_anchor_ms INTEGER NOT NULL,
        audio_path TEXT NOT NULL,
        audio_format TEXT NOT NULL DEFAULT 'pcm',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status, next_attempt_at, id);
    `);
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  saveLocalRecording(rec: LocalRecordingRow): void {
    this.db
      .prepare(
        `INSERT INTO local_recordings
          (id, duo_id, transcript_version_id, started_at, stopped_at, stop_reason, clock_anchor_ms, audio_path, audio_format, duration_ms, bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          stopped_at = excluded.stopped_at,
          stop_reason = excluded.stop_reason,
          audio_path = excluded.audio_path,
          audio_format = excluded.audio_format,
          duration_ms = excluded.duration_ms,
          bytes = excluded.bytes`,
      )
      .run(
        rec.id,
        rec.duoId,
        rec.transcriptVersionId,
        rec.startedAt,
        rec.stoppedAt,
        rec.stopReason,
        rec.clockAnchorMs,
        rec.audioPath,
        rec.audioFormat,
        rec.durationMs,
        rec.bytes,
      );
  }

  listLocalRecordings(): LocalRecordingRow[] {
    const rows = this.db
      .prepare("SELECT * FROM local_recordings ORDER BY started_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      duoId: String(r.duo_id),
      transcriptVersionId: String(r.transcript_version_id),
      startedAt: String(r.started_at),
      stoppedAt: r.stopped_at ? String(r.stopped_at) : null,
      stopReason: r.stop_reason ? String(r.stop_reason) : null,
      clockAnchorMs: Number(r.clock_anchor_ms),
      audioPath: String(r.audio_path),
      audioFormat: String(r.audio_format) as "pcm" | "flac" | "deleted",
      durationMs: Number(r.duration_ms),
      bytes: Number(r.bytes),
    }));
  }

  getLocalRecording(id: string): LocalRecordingRow | null {
    return this.listLocalRecordings().find((r) => r.id === id) ?? null;
  }

  enqueueOutbox(kind: OutboxKind, dedupeKey: string, payload: unknown, nowMs: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO outbox (kind, dedupe_key, payload_json, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, 'pending', 0, 0, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(kind, dedupeKey, JSON.stringify(payload), nowMs);
  }

  listPendingOutbox(nowMs: number = Date.now()): OutboxItem[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id ASC",
      )
      .all(nowMs) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      kind: String(r.kind) as OutboxKind,
      dedupeKey: String(r.dedupe_key),
      payloadJson: String(r.payload_json),
      status: String(r.status) as "pending" | "sent",
      attempts: Number(r.attempts),
      nextAttemptAt: Number(r.next_attempt_at),
      createdAt: Number(r.created_at),
    }));
  }

  countPendingOutbox(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM outbox WHERE status = 'pending'")
      .get() as { cnt: number };
    return Number(row.cnt);
  }

  /** Pending uploads of one Transcript Version: its start, chunks and completion */
  countPendingOutboxForTranscript(transcriptVersionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM outbox WHERE status = 'pending'
         AND (dedupe_key IN (?, ?) OR dedupe_key LIKE ? ESCAPE '\\')`,
      )
      .get(
        `retrans:${transcriptVersionId}`,
        `complete:${transcriptVersionId}`,
        `${transcriptVersionId.replace(/[\\%_]/g, "\\$&")}:%`,
      ) as { cnt: number };
    return Number(row.cnt);
  }

  markOutboxSent(id: number): void {
    this.db.prepare("UPDATE outbox SET status = 'sent' WHERE id = ?").run(id);
  }

  scheduleOutboxRetry(id: number, attempts: number, nextAttemptAt: number): void {
    this.db
      .prepare("UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?")
      .run(attempts, nextAttemptAt, id);
  }

  /**
   * If the server reports a lower highestContiguousChunkNo than what we just sent,
   * re-mark any previously "sent" chunks for that TranscriptVersion above highestContiguousChunkNo
   * as pending so gaps are automatically refilled.
   */
  requeueChunkGaps(transcriptVersionId: string, highestContiguousChunkNo: number, upToChunkNo: number): number {
    let requeued = 0;
    for (let c = highestContiguousChunkNo + 1; c < upToChunkNo; c++) {
      const key = `${transcriptVersionId}:${c}`;
      const res = this.db
        .prepare(
          "UPDATE outbox SET status = 'pending', next_attempt_at = 0 WHERE dedupe_key = ? AND status = 'sent'",
        )
        .run(key);
      requeued += Number(res.changes ?? 0);
    }
    return requeued;
  }
}
