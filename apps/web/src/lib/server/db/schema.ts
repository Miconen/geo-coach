import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  DerivedGuess,
  EvidenceDirection,
  EvidenceKind,
  GameMode,
  LearningRegion,
  SourceKind,
  ProcessingRunPurpose,
  RoundPhaseInterval,
  WordTiming,
} from "@geo-coach/shared";

export interface DeletedSpeechRange {
  startUtc: string;
  endUtc: string;
  deletedAt: string;
}

export const duos = pgTable("duos", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  geoguessrTeamId: text("geoguessr_team_id").notNull().unique(),
  targetRating: integer("target_rating").notNull().default(1200),
  targetDivision: text("target_division").notNull().default("Champion (1200)"),
  hotwords: jsonb("hotwords").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  geoguessrUserId: text("geoguessr_user_id").unique(),
  geoguessrName: text("geoguessr_name"),
  avatarColor: text("avatar_color").notNull().default("#2563eb"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duoMemberships = pgTable(
  "duo_memberships",
  {
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.duoId, table.playerId] })],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_sessions_player_idx").on(table.playerId)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    scope: text("scope").$type<"companion" | "mcp">().notNull(),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_tokens_player_scope_idx").on(table.playerId, table.scope)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_duo_idx").on(table.duoId)],
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    stopReason: text("stop_reason").$type<"stop" | "silence" | "reconnect" | "tab-closed">(),
    continuedFromRecordingId: uuid("continued_from_recording_id"),
    companionVersion: text("companion_version").notNull(),
    clockAnchorMs: bigint("clock_anchor_ms", { mode: "number" }).notNull(),
    manualOffsetOverrideMs: integer("manual_offset_override_ms"),
    effectiveOffsetMs: integer("effective_offset_ms").notNull().default(0),
    isCalibrated: boolean("is_calibrated").notNull().default(false),
    deletedRanges: jsonb("deleted_ranges").$type<DeletedSpeechRange[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recordings_duo_started_idx").on(table.duoId, table.startedAt),
    index("recordings_session_idx").on(table.sessionId),
    index("recordings_player_duo_live_idx").on(table.playerId, table.duoId, table.stoppedAt),
  ],
);

export const clockOffsetMeasurements = pgTable(
  "clock_offset_measurements",
  {
    id: uuid("id").primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    pcTimeMs: bigint("pc_time_ms", { mode: "number" }).notNull(),
    offsetMs: integer("offset_ms").notNull(),
    rttMs: integer("rtt_ms").notNull(),
  },
  (table) => [index("clock_offsets_recording_idx").on(table.recordingId)],
);

export const transcriptVersions = pgTable(
  "transcript_versions",
  {
    id: uuid("id").primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    hotwordsUsed: jsonb("hotwords_used").$type<string[]>().notNull().default([]),
    isComplete: boolean("is_complete").notNull().default(false),
    expectedChunks: integer("expected_chunks"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("transcript_versions_recording_idx").on(table.recordingId, table.createdAt)],
);

export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    transcriptVersionId: uuid("transcript_version_id")
      .notNull()
      .references(() => transcriptVersions.id, { onDelete: "cascade" }),
    chunkNo: integer("chunk_no").notNull(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    utteranceCount: integer("utterance_count").notNull().default(0),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.transcriptVersionId, table.chunkNo] }),
    index("transcript_chunks_recording_idx").on(table.recordingId),
  ],
);

export const utterances = pgTable(
  "utterances",
  {
    id: uuid("id").primaryKey(),
    transcriptVersionId: uuid("transcript_version_id")
      .notNull()
      .references(() => transcriptVersions.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    chunkNo: integer("chunk_no").notNull(),
    text: text("text").notNull(),
    startSampleMs: integer("start_sample_ms").notNull(),
    endSampleMs: integer("end_sample_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    words: jsonb("words").$type<WordTiming[]>().notNull().default([]),
    avgLogprob: doublePrecision("avg_logprob"),
    noSpeechProb: doublePrecision("no_speech_prob"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("utterances_duo_time_idx").on(table.duoId, table.startedAt, table.endedAt),
    index("utterances_version_chunk_idx").on(table.transcriptVersionId, table.chunkNo),
    index("utterances_recording_time_idx").on(table.recordingId, table.startedAt),
  ],
);

export const transcriptRules = pgTable(
  "transcript_rules",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    replacement: text("replacement").notNull(),
    /** ISO 3166-1 alpha-2, or "" for a rule that applies everywhere. */
    countryCode: text("country_code").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    createdByPlayerId: uuid("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transcript_rules_duo_source_country_uidx").on(
      table.duoId,
      table.source,
      table.countryCode,
    ),
  ],
);

export const utteranceEdits = pgTable(
  "utterance_edits",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    utteranceId: uuid("utterance_id")
      .notNull()
      .references(() => utterances.id, { onDelete: "cascade" }),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    originalText: text("original_text").notNull(),
    replacement: text("replacement").notNull(),
    createdByPlayerId: uuid("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("utterance_edits_span_uidx").on(table.utteranceId, table.charStart, table.charEnd),
    index("utterance_edits_duo_idx").on(table.duoId, table.createdAt),
  ],
);

export const transcriptSuggestionDismissals = pgTable(
  "transcript_suggestion_dismissals",
  {
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    replacement: text("replacement").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.duoId, table.source, table.replacement] })],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    geoguessrGameId: text("geoguessr_game_id").notNull(),
    rawDuel: jsonb("raw_duel").$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    won: boolean("won"),
    duoRatingBefore: integer("duo_rating_before"),
    duoRatingAfter: integer("duo_rating_after"),
    duoPositionBefore: integer("duo_position_before"),
    duoPositionAfter: integer("duo_position_after"),
    winStreak: integer("win_streak"),
    duoFinalHealth: integer("duo_final_health"),
    opponentFinalHealth: integer("opponent_final_health"),
    opponentTeamName: text("opponent_team_name"),
    opponentRatingBefore: integer("opponent_rating_before"),
    mapName: text("map_name"),
    mode: text("mode").$type<GameMode>(),
    roundCount: integer("round_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("games_duo_gg_id_uidx").on(table.duoId, table.geoguessrGameId),
    index("games_duo_time_idx").on(table.duoId, table.startedAt, table.endedAt),
  ],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    countryCode: text("country_code"),
    regionCode: text("region_code"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    panoId: text("pano_id"),
    damageMultiplier: doublePrecision("damage_multiplier").notNull().default(1),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    timerStartTime: timestamp("timer_start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    resultsEndTime: timestamp("results_end_time", { withTimezone: true }).notNull(),
    phases: jsonb("phases").$type<RoundPhaseInterval[]>().notNull().default([]),
    duoBestScore: integer("duo_best_score").notNull().default(0),
    opponentBestScore: integer("opponent_best_score").notNull().default(0),
    hpDelta: integer("hp_delta").notNull().default(0),
    guesses: jsonb("guesses").$type<DerivedGuess[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("rounds_game_round_uidx").on(table.gameId, table.roundNumber),
    index("rounds_duo_time_idx").on(table.duoId, table.startTime, table.resultsEndTime),
  ],
);

export const replays = pgTable(
  "replays",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    geoguessrGameId: text("geoguessr_game_id").notNull(),
    geoguessrPlayerId: text("geoguessr_player_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    rawEvents: jsonb("raw_events").$type<unknown[]>().notNull(),
    hasEvents: boolean("has_events").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("replays_game_player_round_uidx").on(
      table.gameId,
      table.geoguessrPlayerId,
      table.roundNumber,
    ),
  ],
);

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    startedByPlayerId: uuid("started_by_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<ProcessingRunPurpose>().notNull(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    rangeStart: timestamp("range_start", { withTimezone: true }).notNull(),
    rangeEnd: timestamp("range_end", { withTimezone: true }).notNull(),
    status: text("status").$type<"open" | "finished" | "abandoned">().notNull().default("open"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("processing_runs_session_purpose_idx").on(
      table.duoId,
      table.sessionId,
      table.purpose,
      table.status,
    ),
  ],
);

export const processingRunInputs = pgTable(
  "processing_run_inputs",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    transcriptVersionId: uuid("transcript_version_id")
      .notNull()
      .references(() => transcriptVersions.id, { onDelete: "cascade" }),
    chunkCount: integer("chunk_count").notNull(),
    effectiveOffsetMs: integer("effective_offset_ms").notNull().default(0),
    deletedRangeCount: integer("deleted_range_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.runId, table.recordingId] })],
);

export const learnings = pgTable(
  "learnings",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => processingRuns.id, { onDelete: "cascade" }),
    authorPlayerId: uuid("author_player_id").references(() => players.id, { onDelete: "set null" }),
    purpose: text("purpose").$type<"extract" | "tips">(),
    kind: text("kind")
      .$type<"clue" | "distinguisher" | "mistake" | "strategy" | "study" | "other">()
      .notNull(),
    origin: text("origin").$type<"speech" | "agent" | "manual">().notNull(),
    text: text("text").notNull(),
    detail: text("detail"),
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    regions: jsonb("regions").$type<LearningRegion[]>().notNull().default([]),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    agentNote: text("agent_note"),
    claimId: uuid("claim_id").references(() => claims.id, { onDelete: "set null" }),
    sourceSpanStart: timestamp("source_span_start", { withTimezone: true }),
    sourceSpanEnd: timestamp("source_span_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("learnings_duo_created_idx").on(table.duoId, table.createdAt),
    index("learnings_run_idx").on(table.runId),
    index("learnings_claim_idx").on(table.claimId),
  ],
);

export const learningUtterances = pgTable(
  "learning_utterances",
  {
    learningId: uuid("learning_id")
      .notNull()
      .references(() => learnings.id, { onDelete: "cascade" }),
    utteranceId: uuid("utterance_id")
      .notNull()
      .references(() => utterances.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.learningId, table.utteranceId] })],
);

export const learningRounds = pgTable(
  "learning_rounds",
  {
    learningId: uuid("learning_id")
      .notNull()
      .references(() => learnings.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.learningId, table.roundId] })],
);

export const learningReactions = pgTable(
  "learning_reactions",
  {
    learningId: uuid("learning_id")
      .notNull()
      .references(() => learnings.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    reaction: text("reaction").$type<"star" | "dismiss" | "done">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.learningId, table.playerId, table.reaction] })],
);

/**
 * A `calls` Processing run's label for one Split or Spread Round (GLOSSARY: Call).
 * Like Learnings, labels take effect when their run finishes and are replaced by
 * a later finished `calls` run over the Round, never deleted (ADR 0001, 0002).
 */
export const callLabels = pgTable(
  "call_labels",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    called: boolean("called").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("call_labels_run_round_uidx").on(table.runId, table.roundId),
    index("call_labels_duo_idx").on(table.duoId),
    index("call_labels_round_idx").on(table.roundId),
  ],
);

export const callLabelUtterances = pgTable(
  "call_label_utterances",
  {
    callLabelId: uuid("call_label_id")
      .notNull()
      .references(() => callLabels.id, { onDelete: "cascade" }),
    utteranceId: uuid("utterance_id")
      .notNull()
      .references(() => utterances.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.callLabelId, table.utteranceId] })],
);

/**
 * One statement about the world in a Duo's knowledge bank (GLOSSARY: Claim).
 * Its status is derived from its Evidence, never stored (ADR 0005). A Claim made
 * in a Processing run records that run, but outlives the run being superseded.
 */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => processingRuns.id, { onDelete: "set null" }),
    createdByPlayerId: uuid("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    regions: jsonb("regions").$type<LearningRegion[]>().notNull().default([]),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("claims_duo_idx").on(table.duoId, table.createdAt)],
);

/**
 * Something that counts for or against a Claim (GLOSSARY: Evidence): a Round,
 * a Player's ✓/✗ (one per Player per Claim), or a section of a Source.
 */
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    kind: text("kind").$type<EvidenceKind>().notNull(),
    direction: text("direction").$type<EvidenceDirection>().notNull(),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").references(() => players.id, { onDelete: "cascade" }),
    /** Documentation Evidence stays pinned to the Source version it cited. */
    sourceVersionId: uuid("source_version_id").references(() => sourceVersions.id, {
      onDelete: "cascade",
    }),
    sectionAnchor: text("section_anchor"),
    runId: uuid("run_id").references(() => processingRuns.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("claim_evidence_claim_idx").on(table.claimId),
    index("claim_evidence_duo_idx").on(table.duoId),
    uniqueIndex("claim_evidence_claim_round_uidx").on(table.claimId, table.roundId),
    uniqueIndex("claim_evidence_claim_player_uidx").on(table.claimId, table.playerId),
    uniqueIndex("claim_evidence_claim_section_uidx").on(
      table.claimId,
      table.sourceVersionId,
      table.sectionAnchor,
    ),
    check("claim_evidence_round_only_for", sql`${table.kind} <> 'round' OR ${table.direction} = 'for'`),
    check(
      "claim_evidence_kind_ref",
      sql`(${table.kind} = 'round' AND ${table.roundId} IS NOT NULL) OR (${table.kind} = 'player' AND ${table.playerId} IS NOT NULL) OR (${table.kind} = 'documentation' AND ${table.sourceVersionId} IS NOT NULL AND ${table.sectionAnchor} IS NOT NULL)`,
    ),
  ],
);

/**
 * A reference document in a Duo's knowledge bank (GLOSSARY: Source). Agents
 * ingest it from what a Player hands them; the server never fetches it.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    kind: text("kind").$type<SourceKind>().notNull(),
    createdByPlayerId: uuid("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sources_duo_idx").on(table.duoId)],
);

/** One ingestion of a Source. Re-ingesting adds a version; older ones are kept for their Evidence. */
export const sourceVersions = pgTable(
  "source_versions",
  {
    id: uuid("id").primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    markdown: text("markdown").notNull(),
    createdByPlayerId: uuid("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("source_versions_source_no_uidx").on(table.sourceId, table.versionNo)],
);

/** A heading-delimited section of a Source version, addressed by a stable anchor. */
export const sourceSections = pgTable(
  "source_sections",
  {
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    anchor: text("anchor").notNull(),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading").notNull(),
    level: integer("level").notNull(),
    body: text("body").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceVersionId, table.anchor] })],
);

/** An image of a Source version, stored on disk (never in git) under `storageKey`. */
export const sourceImages = pgTable(
  "source_images",
  {
    id: uuid("id").primaryKey(),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("source_images_version_name_uidx").on(table.sourceVersionId, table.name)],
);

/** Source images a Claim shows, attached with its Documentation Evidence. */
export const claimImages = pgTable(
  "claim_images",
  {
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceImageId: uuid("source_image_id")
      .notNull()
      .references(() => sourceImages.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.sourceImageId] })],
);
