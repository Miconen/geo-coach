import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  SESSION_GAP_MS,
  computeRecordingOffsetMs,
  deriveUtteranceUtc,
  uuidv7,
  type CompleteTranscriptRequest,
  type OffsetMeasurementRequest,
  type StartRecordingRequest,
  type StartRetranscriptionRequest,
  type StopRecordingRequest,
  type UploadChunkRequest,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  clockOffsetMeasurements,
  duoMemberships,
  learnings,
  learningUtterances,
  recordings,
  sessions,
  transcriptChunks,
  transcriptVersions,
  utterances,
} from "../db/schema.js";
import { recordingInDuo, speechInDuo } from "./scope.js";

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export async function assertPlayerInDuo(
  db: AppDb,
  playerId: string,
  duoId: string,
): Promise<void> {
  const membership = await db.query.duoMemberships.findFirst({
    where: and(eq(duoMemberships.duoId, duoId), eq(duoMemberships.playerId, playerId)),
  });
  if (!membership) {
    throw new DomainError("FORBIDDEN", "Player does not belong to this Duo", 403);
  }
}

/**
 * Finds the Session a Recording starting at `startedAt` belongs to (30-min gap rule),
 * or creates a new Session for the Duo.
 */
async function resolveOrCreateSession(
  db: AppDb,
  duoId: string,
  startedAt: Date,
): Promise<string> {
  // Only Recordings whose Session belongs to this Duo can lend their Session (Recording-to-Session check).
  const existing = await db.query.recordings.findMany({
    where: recordingInDuo(duoId),
    orderBy: [desc(recordings.startedAt)],
  });

  const startMs = startedAt.getTime();
  for (const rec of existing) {
    const recStartMs = rec.startedAt.getTime();
    const recEndMs = rec.stoppedAt ? rec.stoppedAt.getTime() : null;

    if (recEndMs === null) {
      // A live Recording in the Duo: join if our start is within 30 min before its start or anytime after
      if (startMs >= recStartMs - SESSION_GAP_MS) {
        return rec.sessionId;
      }
    } else {
      // Stopped Recording: join if intervals are within SESSION_GAP_MS of each other
      const withinAfter = startMs >= recStartMs - SESSION_GAP_MS && startMs <= recEndMs + SESSION_GAP_MS;
      if (withinAfter) {
        return rec.sessionId;
      }
    }
  }

  const sessionId = uuidv7(startMs);
  await db.insert(sessions).values({ id: sessionId, duoId });
  return sessionId;
}

export async function startRecording(
  db: AppDb,
  playerId: string,
  input: StartRecordingRequest,
): Promise<{ recordingId: string; sessionId: string; transcriptVersionId: string }> {
  await assertPlayerInDuo(db, playerId, input.duoId);

  // Idempotent retry if Companion retries Start with the same recordingId
  const existing = await db.query.recordings.findFirst({
    where: eq(recordings.id, input.recordingId),
  });
  if (existing) {
    if (existing.playerId !== playerId || existing.duoId !== input.duoId) {
      throw new DomainError("CONFLICT", "Recording id belongs to another Player or Duo", 409);
    }
    return {
      recordingId: existing.id,
      sessionId: existing.sessionId,
      transcriptVersionId: input.transcriptVersionId,
    };
  }

  // Enforce one live Recording per Player per Duo (unless continuing from a live one on reconnect)
  const liveRecording = await db.query.recordings.findFirst({
    where: and(
      eq(recordings.playerId, playerId),
      eq(recordings.duoId, input.duoId),
      isNull(recordings.stoppedAt),
    ),
  });

  if (liveRecording) {
    if (input.continuedFromRecordingId && input.continuedFromRecordingId === liveRecording.id) {
      // Auto-close the interrupted Recording on seamless reconnect
      await db
        .update(recordings)
        .set({
          stoppedAt: new Date(input.startedAt),
          stopReason: "reconnect",
        })
        .where(eq(recordings.id, liveRecording.id));
    } else {
      throw new DomainError(
        "ALREADY_RECORDING",
        "Player is already recording elsewhere for this Duo",
        409,
      );
    }
  }

  const startedAt = new Date(input.startedAt);
  const sessionId = await resolveOrCreateSession(db, input.duoId, startedAt);

  await db.insert(recordings).values({
    id: input.recordingId,
    duoId: input.duoId,
    playerId,
    sessionId,
    startedAt,
    continuedFromRecordingId: input.continuedFromRecordingId ?? null,
    companionVersion: input.companionVersion,
    clockAnchorMs: input.clockAnchorMs,
    effectiveOffsetMs: 0,
    isCalibrated: false,
  });

  await db
    .insert(transcriptVersions)
    .values({
      id: input.transcriptVersionId,
      recordingId: input.recordingId,
      duoId: input.duoId,
      model: input.model,
      settings: input.transcriberSettings,
      hotwordsUsed: input.hotwordsUsed,
      isComplete: false,
    })
    .onConflictDoNothing();

  return {
    recordingId: input.recordingId,
    sessionId,
    transcriptVersionId: input.transcriptVersionId,
  };
}

export async function stopRecording(
  db: AppDb,
  playerId: string,
  recordingId: string,
  input: StopRecordingRequest,
): Promise<{ recordingId: string; sessionId: string }> {
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, recordingId),
  });
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }
  if (rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Cannot stop another Player's Recording", 403);
  }

  await db
    .update(recordings)
    .set({
      stoppedAt: new Date(input.stoppedAt),
      stopReason: input.stopReason,
    })
    .where(eq(recordings.id, recordingId));

  return { recordingId: rec.id, sessionId: rec.sessionId };
}

export async function startRetranscription(
  db: AppDb,
  playerId: string,
  input: StartRetranscriptionRequest,
): Promise<{ transcriptVersionId: string; recordingId: string }> {
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, input.recordingId),
  });
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }
  if (rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Cannot re-transcribe another Player's Recording", 403);
  }

  await db
    .insert(transcriptVersions)
    .values({
      id: input.transcriptVersionId,
      recordingId: rec.id,
      duoId: rec.duoId,
      model: input.model,
      settings: input.transcriberSettings,
      hotwordsUsed: input.hotwordsUsed,
      isComplete: false,
    })
    .onConflictDoNothing();

  return { transcriptVersionId: input.transcriptVersionId, recordingId: rec.id };
}

export async function computeHighestContiguousChunkNo(
  db: AppDb,
  transcriptVersionId: string,
): Promise<number> {
  const chunks = await db
    .select({ chunkNo: transcriptChunks.chunkNo })
    .from(transcriptChunks)
    .where(eq(transcriptChunks.transcriptVersionId, transcriptVersionId))
    .orderBy(asc(transcriptChunks.chunkNo));

  let contiguous = -1;
  for (const row of chunks) {
    if (row.chunkNo === contiguous + 1) {
      contiguous = row.chunkNo;
    } else if (row.chunkNo > contiguous + 1) {
      break;
    }
  }
  return contiguous;
}

export async function uploadTranscriptChunk(
  db: AppDb,
  playerId: string,
  transcriptVersionId: string,
  input: UploadChunkRequest,
): Promise<{
  duplicate: boolean;
  highestContiguousChunkNo: number;
  utteranceCount: number;
}> {
  const tv = await db.query.transcriptVersions.findFirst({
    where: eq(transcriptVersions.id, transcriptVersionId),
  });
  if (!tv) {
    throw new DomainError("NOT_FOUND", "Transcript version not found", 404);
  }
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, tv.recordingId),
  });
  if (!rec || rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Cannot upload chunks to another Player's Recording", 403);
  }
  if (tv.isComplete) {
    throw new DomainError("CONFLICT", "Transcript version is already complete", 409);
  }

  const existingChunk = await db.query.transcriptChunks.findFirst({
    where: and(
      eq(transcriptChunks.transcriptVersionId, transcriptVersionId),
      eq(transcriptChunks.chunkNo, input.chunkNo),
    ),
  });

  if (existingChunk) {
    const highestContiguousChunkNo = await computeHighestContiguousChunkNo(
      db,
      transcriptVersionId,
    );
    return {
      duplicate: true,
      highestContiguousChunkNo,
      utteranceCount: existingChunk.utteranceCount,
    };
  }

  await db.insert(transcriptChunks).values({
    transcriptVersionId,
    chunkNo: input.chunkNo,
    recordingId: rec.id,
    utteranceCount: input.utterances.length,
  });

  if (input.utterances.length > 0) {
    const rows = input.utterances.map((u) => {
      const utc = deriveUtteranceUtc(
        rec.clockAnchorMs,
        u.startSampleMs,
        u.endSampleMs,
        rec.effectiveOffsetMs,
      );
      return {
        id: uuidv7(utc.startedAt.getTime()),
        transcriptVersionId,
        recordingId: rec.id,
        duoId: rec.duoId,
        playerId: rec.playerId,
        chunkNo: input.chunkNo,
        text: u.text,
        startSampleMs: u.startSampleMs,
        endSampleMs: u.endSampleMs,
        startedAt: utc.startedAt,
        endedAt: utc.endedAt,
        words: u.words,
        avgLogprob: u.avgLogprob ?? null,
        noSpeechProb: u.noSpeechProb ?? null,
      };
    });
    await db.insert(utterances).values(rows);
  }

  const highestContiguousChunkNo = await computeHighestContiguousChunkNo(db, transcriptVersionId);
  return {
    duplicate: false,
    highestContiguousChunkNo,
    utteranceCount: input.utterances.length,
  };
}

export async function completeTranscriptVersion(
  db: AppDb,
  playerId: string,
  transcriptVersionId: string,
  input: CompleteTranscriptRequest,
): Promise<{ transcriptVersionId: string; recordingId: string; duoId: string }> {
  const tv = await db.query.transcriptVersions.findFirst({
    where: eq(transcriptVersions.id, transcriptVersionId),
  });
  if (!tv) {
    throw new DomainError("NOT_FOUND", "Transcript version not found", 404);
  }
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, tv.recordingId),
  });
  if (!rec || rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Cannot complete another Player's Transcript version", 403);
  }

  await db
    .update(transcriptVersions)
    .set({
      isComplete: true,
      expectedChunks: input.totalChunks,
      completedAt: new Date(),
    })
    .where(eq(transcriptVersions.id, transcriptVersionId));

  return { transcriptVersionId: tv.id, recordingId: rec.id, duoId: rec.duoId };
}

/**
 * Current Transcript version for a Recording:
 * the newest complete version, or the live (incomplete) version while it is the only one.
 */
export async function getCurrentTranscriptVersionId(
  db: AppDb,
  recordingId: string,
): Promise<string | null> {
  // Elect only on the verified chain: the version, its Recording and that Recording's Session share one Duo.
  const versions = await db.query.transcriptVersions.findMany({
    where: and(
      eq(transcriptVersions.recordingId, recordingId),
      sql`exists (select 1 from ${recordings} r join ${sessions} s on s.id = r.session_id
        where r.id = ${transcriptVersions.recordingId} and r.duo_id = ${transcriptVersions.duoId}
          and s.duo_id = ${transcriptVersions.duoId})`,
    ),
    orderBy: [desc(transcriptVersions.createdAt), desc(transcriptVersions.id)],
  });
  if (versions.length === 0) return null;
  const newestComplete = versions.find((v) => v.isComplete);
  return newestComplete ? newestComplete.id : versions[0]!.id;
}

/**
 * getCurrentTranscriptVersionId for many Recordings in one query (#56 1a-derivation), same election on the
 * verified chain. Recordings without a version are absent from the map.
 */
export async function getCurrentTranscriptVersionIds(
  db: AppDb,
  recordingIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (recordingIds.length === 0) return out;
  const versions = await db
    .select({
      id: transcriptVersions.id,
      recordingId: transcriptVersions.recordingId,
      isComplete: transcriptVersions.isComplete,
    })
    .from(transcriptVersions)
    .where(
      and(
        inArray(transcriptVersions.recordingId, [...recordingIds]),
        sql`exists (select 1 from ${recordings} r join ${sessions} s on s.id = r.session_id
          where r.id = ${transcriptVersions.recordingId} and r.duo_id = ${transcriptVersions.duoId}
            and s.duo_id = ${transcriptVersions.duoId})`,
      ),
    )
    .orderBy(desc(transcriptVersions.createdAt), desc(transcriptVersions.id));
  const newest = new Map<string, string>();
  for (const v of versions) {
    if (!newest.has(v.recordingId)) newest.set(v.recordingId, v.id);
    if (v.isComplete && !out.has(v.recordingId)) out.set(v.recordingId, v.id);
  }
  for (const [rec, id] of newest) if (!out.has(rec)) out.set(rec, id);
  return out;
}

async function recomputeRecordingOffsetAndUtterances(
  db: AppDb,
  recordingId: string,
): Promise<{ effectiveOffsetMs: number; isCalibrated: boolean }> {
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, recordingId),
  });
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }

  const samples = await db.query.clockOffsetMeasurements.findMany({
    where: eq(clockOffsetMeasurements.recordingId, recordingId),
  });

  const computed = computeRecordingOffsetMs(samples, rec.manualOffsetOverrideMs);

  await db
    .update(recordings)
    .set({
      effectiveOffsetMs: computed.offsetMs,
      isCalibrated: computed.calibrated,
    })
    .where(eq(recordings.id, recordingId));

  // Recompute derived UTC timestamps on all Utterances for this Recording
  const recUtterances = await db.query.utterances.findMany({
    where: and(eq(utterances.recordingId, recordingId), speechInDuo(rec.duoId)),
  });

  for (const u of recUtterances) {
    const utc = deriveUtteranceUtc(
      rec.clockAnchorMs,
      u.startSampleMs,
      u.endSampleMs,
      computed.offsetMs,
    );
    await db
      .update(utterances)
      .set({ startedAt: utc.startedAt, endedAt: utc.endedAt })
      .where(eq(utterances.id, u.id));
  }

  return { effectiveOffsetMs: computed.offsetMs, isCalibrated: computed.calibrated };
}

export async function addClockOffsetMeasurement(
  db: AppDb,
  playerId: string,
  recordingId: string,
  input: OffsetMeasurementRequest,
): Promise<{ effectiveOffsetMs: number; isCalibrated: boolean }> {
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, recordingId),
  });
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }
  if (rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Cannot add offsets to another Player's Recording", 403);
  }

  await db.insert(clockOffsetMeasurements).values({
    id: uuidv7(),
    recordingId,
    measuredAt: new Date(input.measuredAt),
    pcTimeMs: input.pcTimeMs,
    offsetMs: input.offsetMs,
    rttMs: input.rttMs,
  });

  return recomputeRecordingOffsetAndUtterances(db, recordingId);
}

export async function setManualOffsetOverride(
  db: AppDb,
  playerId: string,
  recordingId: string,
  manualOffsetOverrideMs: number | null,
): Promise<{ effectiveOffsetMs: number; isCalibrated: boolean }> {
  const rec = await db.query.recordings.findFirst({
    where: eq(recordings.id, recordingId),
  });
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }
  await assertPlayerInDuo(db, playerId, rec.duoId);

  await db
    .update(recordings)
    .set({ manualOffsetOverrideMs })
    .where(eq(recordings.id, recordingId));

  return recomputeRecordingOffsetAndUtterances(db, recordingId);
}

/**
 * Permanently deletes Utterances in [startUtc, endUtc] across ALL Transcript versions
 * of a Player's own Recording. Learnings that cited ONLY deleted Utterances are removed too.
 */
export async function deleteOwnSpeechRange(
  db: AppDb,
  playerId: string,
  duoId: string,
  input: { recordingId: string; startUtc: Date; endUtc: Date },
): Promise<{ deletedUtteranceCount: number; deletedLearningCount: number }> {
  await assertPlayerInDuo(db, playerId, duoId);
  const [rec] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, input.recordingId), recordingInDuo(duoId)))
    .limit(1);
  if (!rec) {
    throw new DomainError("NOT_FOUND", "Recording not found", 404);
  }
  if (rec.playerId !== playerId) {
    throw new DomainError("FORBIDDEN", "Players can only delete their own speech", 403);
  }

  // Find Utterances overlapping [startUtc, endUtc] across all versions of this Recording
  const toDelete = await db.query.utterances.findMany({
    where: and(
      eq(utterances.recordingId, rec.id),
      speechInDuo(duoId),
      lt(utterances.startedAt, input.endUtc),
      gt(utterances.endedAt, input.startUtc),
    ),
  });

  if (toDelete.length === 0) {
    return { deletedUtteranceCount: 0, deletedLearningCount: 0 };
  }

  const deletedIds = new Set(toDelete.map((u) => u.id));

  // Find Learnings referencing any of these Utterances before cascade-deleting them
  // Only this Duo's Learnings, and only the links of Learnings that cite a deleted Utterance.
  const touched = await db
    .selectDistinct({ learningId: learningUtterances.learningId })
    .from(learningUtterances)
    .innerJoin(learnings, eq(learnings.id, learningUtterances.learningId))
    .where(and(eq(learnings.duoId, duoId), inArray(learningUtterances.utteranceId, [...deletedIds])));
  const allLinks =
    touched.length === 0
      ? []
      : await db.query.learningUtterances.findMany({
          where: inArray(
            learningUtterances.learningId,
            touched.map((t) => t.learningId),
          ),
        });
  const learningToUtterances = new Map<string, Set<string>>();
  for (const link of allLinks) {
    const set = learningToUtterances.get(link.learningId) ?? new Set<string>();
    set.add(link.utteranceId);
    learningToUtterances.set(link.learningId, set);
  }

  const learningsToDelete: string[] = [];
  for (const [learningId, uSet] of learningToUtterances.entries()) {
    let hadDeleted = false;
    let hasSurviving = false;
    for (const uId of uSet) {
      if (deletedIds.has(uId)) {
        hadDeleted = true;
      } else {
        hasSurviving = true;
      }
    }
    if (hadDeleted && !hasSurviving) {
      learningsToDelete.push(learningId);
    }
  }

  for (const u of toDelete) {
    await db.delete(utterances).where(eq(utterances.id, u.id));
  }

  for (const lId of learningsToDelete) {
    await db.delete(learnings).where(and(eq(learnings.id, lId), eq(learnings.duoId, duoId)));
  }

  const nextDeletedRanges = [
    ...rec.deletedRanges,
    {
      startUtc: input.startUtc.toISOString(),
      endUtc: input.endUtc.toISOString(),
      deletedAt: new Date().toISOString(),
    },
  ];
  await db
    .update(recordings)
    .set({ deletedRanges: nextDeletedRanges })
    .where(eq(recordings.id, rec.id));

  return {
    deletedUtteranceCount: toDelete.length,
    deletedLearningCount: learningsToDelete.length,
  };
}
