import { eq, inArray } from "drizzle-orm";
import {
  CURRENT_API_VERSION,
  companionHeartbeatSchema,
  completeTranscriptRequestSchema,
  geoguessrMissingRequestSchema,
  isSupportedApiVersion,
  offsetMeasurementRequestSchema,
  startRecordingRequestSchema,
  startRetranscriptionRequestSchema,
  stopRecordingRequestSchema,
  uploadChunkRequestSchema,
  uploadGameRequestSchema,
  uploadReplayRequestSchema,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { duoMemberships, duos } from "../db/schema.js";
import { extractBearerToken, verifyApiToken } from "../auth/index.js";
import { duoEventBus } from "../events/bus.js";
import {
  DomainError,
  addClockOffsetMeasurement,
  assertPlayerInDuo,
  completeTranscriptVersion,
  findMissingGeoguessrData,
  startRecording,
  startRetranscription,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
  upsertRawReplay,
} from "../services/index.js";

export const LATEST_COMPANION_VERSION = process.env.LATEST_COMPANION_VERSION ?? "0.1.0";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-GeoCoach-Api-Version": String(CURRENT_API_VERSION),
      "X-GeoCoach-Latest-Companion-Version": LATEST_COMPANION_VERSION,
    },
  });
}

export type CompanionEndpoint =
  | "bootstrap"
  | "time"
  | "startRecording"
  | "stopRecording"
  | "addOffset"
  | "startRetranscription"
  | "uploadChunk"
  | "completeTranscript"
  | "heartbeat"
  | "geoguessrMissing"
  | "uploadGame"
  | "uploadReplay";

export async function handleCompanionRequest(
  db: AppDb,
  request: Request,
  endpoint: CompanionEndpoint,
  params: Record<string, string> = {},
): Promise<Response> {
  // Check API version header (accept current and previous; 426 otherwise)
  const rawVersion = request.headers.get("x-geocoach-api-version");
  const version = rawVersion ? Number.parseInt(rawVersion, 10) : CURRENT_API_VERSION;
  if (!isSupportedApiVersion(version)) {
    return jsonResponse(
      {
        error: "UPDATE_REQUIRED",
        message: "Companion API version is no longer supported. Please update your Companion.",
        currentApiVersion: CURRENT_API_VERSION,
        latestCompanionVersion: LATEST_COMPANION_VERSION,
      },
      426,
    );
  }

  const rawToken = extractBearerToken(request.headers);
  if (!rawToken) {
    return jsonResponse({ error: "UNAUTHORIZED", message: "Missing bearer token" }, 401);
  }

  const verified = await verifyApiToken(db, rawToken, "companion");
  if (!verified) {
    return jsonResponse(
      { error: "UNAUTHORIZED", message: "Invalid, expired, or wrong-scope bearer token" },
      401,
    );
  }

  const { player } = verified;

  try {
    if (endpoint === "time") {
      return jsonResponse({ serverTimeMs: Date.now() });
    }

    if (endpoint === "bootstrap") {
      const memberships = await db.query.duoMemberships.findMany({
        where: eq(duoMemberships.playerId, player.id),
      });
      const duoIds = memberships.map((m) => m.duoId);
      const playerDuos =
        duoIds.length > 0
          ? await db.query.duos.findMany({ where: inArray(duos.id, duoIds) })
          : [];

      return jsonResponse({
        serverTimeMs: Date.now(),
        latestCompanionVersion: LATEST_COMPANION_VERSION,
        player: {
          id: player.id,
          displayName: player.displayName,
          geoguessrUserId: player.geoguessrUserId,
        },
        duos: playerDuos.map((d) => ({
          id: d.id,
          name: d.name,
          geoguessrTeamId: d.geoguessrTeamId,
          hotwords: d.hotwords,
        })),
      });
    }

    const body = await request.json();

    if (endpoint === "startRecording") {
      const parsed = startRecordingRequestSchema.parse(body);
      const res = await startRecording(db, player.id, parsed);
      duoEventBus.emitChanged(parsed.duoId, "session", res.sessionId);
      return jsonResponse(res, 201);
    }

    if (endpoint === "stopRecording") {
      const recordingId = params.id;
      if (!recordingId) return jsonResponse({ error: "BAD_REQUEST" }, 400);
      const parsed = stopRecordingRequestSchema.parse(body);
      const res = await stopRecording(db, player.id, recordingId, parsed);
      return jsonResponse(res);
    }

    if (endpoint === "addOffset") {
      const recordingId = params.id;
      if (!recordingId) return jsonResponse({ error: "BAD_REQUEST" }, 400);
      const parsed = offsetMeasurementRequestSchema.parse(body);
      const res = await addClockOffsetMeasurement(db, player.id, recordingId, parsed);
      return jsonResponse(res);
    }

    if (endpoint === "startRetranscription") {
      const parsed = startRetranscriptionRequestSchema.parse(body);
      const res = await startRetranscription(db, player.id, parsed);
      return jsonResponse(res, 201);
    }

    if (endpoint === "uploadChunk") {
      const versionId = params.versionId;
      if (!versionId) return jsonResponse({ error: "BAD_REQUEST" }, 400);
      const parsed = uploadChunkRequestSchema.parse(body);
      const res = await uploadTranscriptChunk(db, player.id, versionId, parsed);
      return jsonResponse(res);
    }

    if (endpoint === "completeTranscript") {
      const versionId = params.versionId;
      if (!versionId) return jsonResponse({ error: "BAD_REQUEST" }, 400);
      const parsed = completeTranscriptRequestSchema.parse(body);
      const res = await completeTranscriptVersion(db, player.id, versionId, parsed);
      duoEventBus.emitChanged(res.duoId, "session", res.recordingId);
      return jsonResponse(res);
    }

    if (endpoint === "heartbeat") {
      const parsed = companionHeartbeatSchema.parse(body);
      await assertPlayerInDuo(db, player.id, parsed.duoId);
      const seenAt = new Date().toISOString();
      duoEventBus.publish(parsed.duoId, {
        type: "heartbeat",
        playerId: player.id,
        playerName: player.displayName,
        recording: parsed.recording,
        recordingId: parsed.recordingId,
        uploadOk: parsed.uploadOk,
        pendingChunks: parsed.pendingChunks,
        transcriptionLagSec: parsed.transcriptionLagSec,
        geoguessrAuthOk: parsed.geoguessrAuthOk,
        seenAt,
      });
      return jsonResponse({
        ok: true,
        serverTimeMs: Date.now(),
        latestCompanionVersion: LATEST_COMPANION_VERSION,
      });
    }

    if (endpoint === "geoguessrMissing") {
      const parsed = geoguessrMissingRequestSchema.parse(body);
      await assertPlayerInDuo(db, player.id, parsed.duoId);
      const res = await findMissingGeoguessrData(db, parsed);
      return jsonResponse(res);
    }

    if (endpoint === "uploadGame") {
      const parsed = uploadGameRequestSchema.parse(body);
      await assertPlayerInDuo(db, player.id, parsed.duoId);
      const res = await upsertRawGame(db, parsed);
      duoEventBus.emitChanged(parsed.duoId, "game", res.gameId);
      return jsonResponse(res, res.created ? 201 : 200);
    }

    if (endpoint === "uploadReplay") {
      const parsed = uploadReplayRequestSchema.parse(body);
      await assertPlayerInDuo(db, player.id, parsed.duoId);
      const res = await upsertRawReplay(db, parsed);
      return jsonResponse(res);
    }

    return jsonResponse({ error: "NOT_FOUND" }, 404);
  } catch (err) {
    if (err instanceof DomainError) {
      return jsonResponse({ error: err.code, message: err.message }, err.status);
    }
    if (err && typeof err === "object" && "issues" in err) {
      return jsonResponse({ error: "VALIDATION_ERROR", issues: err.issues }, 400);
    }
    console.error("Companion API error:", err);
    return jsonResponse({ error: "INTERNAL_ERROR", message: "Unexpected error" }, 500);
  }
}
