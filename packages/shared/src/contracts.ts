import { z } from "zod";
import { isValidIsoCountryCode } from "./countries.js";

export const CURRENT_API_VERSION = 1;
export const PREVIOUS_API_VERSION: number | null = null;
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const RUN_ABANDON_MS = 2 * 60 * 60 * 1000;

export function isSupportedApiVersion(version: number): boolean {
  if (!Number.isInteger(version) || version <= 0) return false;
  if (version === CURRENT_API_VERSION) return true;
  if (PREVIOUS_API_VERSION !== null && version === PREVIOUS_API_VERSION) return true;
  return false;
}

export const tokenScopeSchema = z.enum(["companion", "mcp"]);
export type TokenScope = z.infer<typeof tokenScopeSchema>;

export const stopReasonSchema = z.enum(["stop", "silence", "reconnect", "tab-closed"]);
export type StopReason = z.infer<typeof stopReasonSchema>;

export const learningKindSchema = z.enum([
  "clue",
  "distinguisher",
  "mistake",
  "strategy",
  "study",
  "other",
]);
export type LearningKind = z.infer<typeof learningKindSchema>;

/** Learning kinds that can rest on a Claim; strategies, mistakes and Study items can't. */
export const CLAIM_LINKABLE_KINDS: ReadonlySet<LearningKind> = new Set(["clue", "distinguisher", "other"]);

export const learningOriginSchema = z.enum(["speech", "agent", "manual"]);
export type LearningOrigin = z.infer<typeof learningOriginSchema>;

export const reactionTypeSchema = z.enum(["star", "dismiss", "done"]);
export type ReactionType = z.infer<typeof reactionTypeSchema>;

export const processingRunPurposeSchema = z.enum(["extract", "tips", "calls"]);
export type ProcessingRunPurpose = z.infer<typeof processingRunPurposeSchema>;
/** The purposes whose runs produce Learnings; `calls` runs produce Call labels (ADR 0002). */
export type LearningRunPurpose = Exclude<ProcessingRunPurpose, "calls">;

/** What `get_instructions` serves: each Processing run purpose, plus Source ingestion (not a run). */
export const instructionPurposeSchema = z.enum(["extract", "tips", "calls", "ingest"]);
export type InstructionPurpose = z.infer<typeof instructionPurposeSchema>;

export const processingRunStatusSchema = z.enum(["open", "finished", "abandoned"]);
export type ProcessingRunStatus = z.infer<typeof processingRunStatusSchema>;

export const isoCountryCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => isValidIsoCountryCode(v), { message: "Invalid ISO 3166-1 alpha-2 country code" });

export const learningRegionSchema = z.object({
  country: isoCountryCodeSchema,
  name: z.string().trim().min(1).max(120),
});
export type LearningRegion = z.infer<typeof learningRegionSchema>;

function validateRegionsInCountries(
  val: { countries: string[]; regions: LearningRegion[] },
  ctx: z.RefinementCtx,
) {
  const countrySet = new Set(val.countries);
  for (let i = 0; i < val.regions.length; i++) {
    const reg = val.regions[i]!;
    if (!countrySet.has(reg.country)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regions", i, "country"],
        message: `Region "${reg.name}" references country ${reg.country} which is not in countries[]`,
      });
    }
  }
}

export const learningItemInputSchema = z
  .object({
    kind: learningKindSchema,
    text: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(4000).nullable().optional(),
    countries: z.array(isoCountryCodeSchema).default([]),
    regions: z.array(learningRegionSchema).default([]),
    topics: z
      .array(z.string().trim().toLowerCase().min(1).max(60))
      .default([]),
    origin: z.enum(["speech", "agent"]).default("speech"),
    agentNote: z.string().trim().max(1000).nullable().optional(),
    utteranceRefs: z.array(z.string().min(1)).min(1),
    roundIds: z.array(z.string().uuid()).default([]),
    /** The Claim this clue or distinguisher rests on (GLOSSARY: Claim). */
    claimId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    validateRegionsInCountries(val, ctx);
    if (val.claimId && !CLAIM_LINKABLE_KINDS.has(val.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimId"],
        message: `A ${val.kind} Learning isn't a statement about the world, so it links to no Claim`,
      });
    }
  });
export type LearningItemInput = z.infer<typeof learningItemInputSchema>;

/**
 * One Call label from a `calls` Processing run (GLOSSARY: Call): whether the Duo
 * agreed aloud on a Split or Spread Round. A Call must cite the Utterances it
 * rests on; "not called" may cite none when nobody spoke while guessing.
 */
export const callLabelInputSchema = z
  .object({
    roundId: z.string().uuid(),
    called: z.boolean(),
    utteranceRefs: z.array(z.string().min(1)).default([]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.called && item.utteranceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["utteranceRefs"],
        message: "A Call must cite at least one Utterance",
      });
    }
  });
export type CallLabelInput = z.infer<typeof callLabelInputSchema>;

export const manualLearningInputSchema = z
  .object({
    duoId: z.string().uuid(),
    kind: learningKindSchema,
    text: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(4000).nullable().optional(),
    countries: z.array(isoCountryCodeSchema).default([]),
    regions: z.array(learningRegionSchema).default([]),
    topics: z
      .array(z.string().trim().toLowerCase().min(1).max(60))
      .default([]),
    utteranceIds: z.array(z.string().uuid()).default([]),
    roundIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine(validateRegionsInCountries);
export type ManualLearningInput = z.infer<typeof manualLearningInputSchema>;

// Companion API schemas
export const wordTimingSchema = z.object({
  word: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  probability: z.number().min(0).max(1),
});
export type WordTiming = z.infer<typeof wordTimingSchema>;

export const chunkUtteranceSchema = z.object({
  text: z.string().trim().min(1),
  startSampleMs: z.number().int().min(0),
  endSampleMs: z.number().int().min(0),
  words: z.array(wordTimingSchema).default([]),
  avgLogprob: z.number().nullable().optional(),
  noSpeechProb: z.number().nullable().optional(),
});
export type ChunkUtterance = z.infer<typeof chunkUtteranceSchema>;

export const startRecordingRequestSchema = z.object({
  recordingId: z.string().uuid(),
  transcriptVersionId: z.string().uuid(),
  duoId: z.string().uuid(),
  startedAt: z.string().datetime(),
  clockAnchorMs: z.number().int(),
  continuedFromRecordingId: z.string().uuid().nullable().optional(),
  companionVersion: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  transcriberSettings: z.record(z.unknown()).default({}),
  hotwordsUsed: z.array(z.string()).default([]),
});
export type StartRecordingRequest = z.infer<typeof startRecordingRequestSchema>;

export const stopRecordingRequestSchema = z.object({
  stoppedAt: z.string().datetime(),
  stopReason: stopReasonSchema,
});
export type StopRecordingRequest = z.infer<typeof stopRecordingRequestSchema>;

export const offsetMeasurementRequestSchema = z.object({
  measuredAt: z.string().datetime(),
  pcTimeMs: z.number().int(),
  offsetMs: z.number().int(),
  rttMs: z.number().int().min(0),
});
export type OffsetMeasurementRequest = z.infer<typeof offsetMeasurementRequestSchema>;

export const startRetranscriptionRequestSchema = z.object({
  transcriptVersionId: z.string().uuid(),
  recordingId: z.string().uuid(),
  model: z.string().min(1).max(128),
  transcriberSettings: z.record(z.unknown()).default({}),
  hotwordsUsed: z.array(z.string()).default([]),
});
export type StartRetranscriptionRequest = z.infer<typeof startRetranscriptionRequestSchema>;

export const uploadChunkRequestSchema = z.object({
  recordingId: z.string().uuid(),
  chunkNo: z.number().int().min(0),
  utterances: z.array(chunkUtteranceSchema),
});
export type UploadChunkRequest = z.infer<typeof uploadChunkRequestSchema>;

export const completeTranscriptRequestSchema = z.object({
  totalChunks: z.number().int().min(0),
});
export type CompleteTranscriptRequest = z.infer<typeof completeTranscriptRequestSchema>;

export const companionHeartbeatSchema = z.object({
  duoId: z.string().uuid(),
  recordingId: z.string().uuid().nullable(),
  recording: z.boolean(),
  uploadOk: z.boolean(),
  pendingChunks: z.number().int().min(0),
  transcriptionLagSec: z.number().min(0),
  companionVersion: z.string().min(1).max(64),
  geoguessrAuthOk: z.boolean().default(true),
});
export type CompanionHeartbeat = z.infer<typeof companionHeartbeatSchema>;

export const geoguessrMissingRequestSchema = z.object({
  duoId: z.string().uuid(),
  gameIds: z.array(z.string().min(1)).max(500),
  replayCandidates: z
    .array(
      z.object({
        geoguessrGameId: z.string().min(1),
        geoguessrPlayerId: z.string().min(1),
        roundNumber: z.number().int().min(1),
      }),
    )
    .max(2000)
    .default([]),
  includeStoredReplayBackfill: z.boolean().default(false),
});
export type GeoguessrMissingRequest = z.infer<typeof geoguessrMissingRequestSchema>;

export const uploadGameRequestSchema = z.object({
  duoId: z.string().uuid(),
  geoguessrGameId: z.string().min(1),
  fetchedAt: z.string().datetime(),
  rawDuel: z.record(z.unknown()),
});
export type UploadGameRequest = z.infer<typeof uploadGameRequestSchema>;

export const uploadReplayRequestSchema = z.object({
  duoId: z.string().uuid(),
  geoguessrGameId: z.string().min(1),
  geoguessrPlayerId: z.string().min(1),
  roundNumber: z.number().int().min(1),
  fetchedAt: z.string().datetime(),
  rawEvents: z.array(z.unknown()),
});
export type UploadReplayRequest = z.infer<typeof uploadReplayRequestSchema>;

export const duoSseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heartbeat"),
    playerId: z.string().uuid(),
    playerName: z.string(),
    recording: z.boolean(),
    recordingId: z.string().uuid().nullable(),
    uploadOk: z.boolean(),
    pendingChunks: z.number().int(),
    transcriptionLagSec: z.number(),
    geoguessrAuthOk: z.boolean(),
    seenAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("changed"),
    entity: z.enum([
      "session",
      "game",
      "run",
      "learning",
      "reaction",
      "hotwords",
      "corrections",
      "claim",
      "source",
      "processing",
      "replay",
    ]),
    id: z.string().optional(),
    /** Scope hints (#56 X5): the Session and Recording a change touched, and what kind of Session change it was. */
    sessionId: z.string().uuid().optional(),
    recordingId: z.string().uuid().optional(),
    /** For entity "session"; absent counts as "bounds". */
    kind: z.enum(["bounds", "chunk", "offset", "transcript"]).optional(),
    at: z.string().datetime(),
  }),
  /**
   * Sent once right after a connection opens: when this Duo last changed on the server (its process start when it has
   * not changed since). A client whose page data was served later has nothing to catch up on.
   */
  z.object({
    type: z.literal("sync"),
    changedAt: z.string().datetime(),
  }),
]);
export type DuoSseEvent = z.infer<typeof duoSseEventSchema>;

/** GET /api/duos/[duoId]/pending-work: pending work ranges per Session and purpose (#56 1b-shell). */
export const pendingWorkSchema = z.object({
  ranges: z.array(
    z.object({
      sessionId: z.string().uuid(),
      purpose: z.enum(["extract", "tips", "calls"]),
      count: z.number().int().min(0),
    }),
  ),
  /** The processing worker polled within the last 45 s (#56 2a(i)). */
  workerOnline: z.boolean(),
});
export type PendingWork = z.infer<typeof pendingWorkSchema>;

/**
 * GET /api/duos/[duoId]/review (#56 3b): Review's refresh, the same payload as its page load. It takes no
 * parameters since 4 retired the legacy Session pane (its ?sessionId= and ?run= moved to the Session page); unknown
 * params are ignored.
 */
export const reviewQuerySchema = z.object({});
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
