CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clock_offset_measurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recording_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"pc_time_ms" bigint NOT NULL,
	"offset_ms" integer NOT NULL,
	"rtt_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duo_memberships" (
	"duo_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duo_memberships_duo_id_player_id_pk" PRIMARY KEY("duo_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "duos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"geoguessr_team_id" text NOT NULL,
	"target_rating" integer DEFAULT 1200 NOT NULL,
	"target_division" text DEFAULT 'Champion (1200)' NOT NULL,
	"hotwords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duos_geoguessr_team_id_unique" UNIQUE("geoguessr_team_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"geoguessr_game_id" text NOT NULL,
	"raw_duel" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"won" boolean,
	"duo_rating_before" integer,
	"duo_rating_after" integer,
	"duo_position_before" integer,
	"duo_position_after" integer,
	"win_streak" integer,
	"duo_final_health" integer,
	"opponent_final_health" integer,
	"opponent_team_name" text,
	"round_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_reactions" (
	"learning_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_reactions_learning_id_player_id_reaction_pk" PRIMARY KEY("learning_id","player_id","reaction")
);
--> statement-breakpoint
CREATE TABLE "learning_rounds" (
	"learning_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	CONSTRAINT "learning_rounds_learning_id_round_id_pk" PRIMARY KEY("learning_id","round_id")
);
--> statement-breakpoint
CREATE TABLE "learning_utterances" (
	"learning_id" uuid NOT NULL,
	"utterance_id" uuid NOT NULL,
	CONSTRAINT "learning_utterances_learning_id_utterance_id_pk" PRIMARY KEY("learning_id","utterance_id")
);
--> statement-breakpoint
CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"run_id" uuid,
	"author_player_id" uuid,
	"purpose" text,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"text" text NOT NULL,
	"detail" text,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_note" text,
	"source_span_start" timestamp with time zone,
	"source_span_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"display_name" text NOT NULL,
	"geoguessr_user_id" text,
	"geoguessr_name" text,
	"avatar_color" text DEFAULT '#2563eb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_discord_id_unique" UNIQUE("discord_id"),
	CONSTRAINT "players_geoguessr_user_id_unique" UNIQUE("geoguessr_user_id")
);
--> statement-breakpoint
CREATE TABLE "processing_run_inputs" (
	"run_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"transcript_version_id" uuid NOT NULL,
	"chunk_count" integer NOT NULL,
	"effective_offset_ms" integer DEFAULT 0 NOT NULL,
	"deleted_range_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "processing_run_inputs_run_id_recording_id_pk" PRIMARY KEY("run_id","recording_id")
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_by_player_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"continued_from_recording_id" uuid,
	"companion_version" text NOT NULL,
	"clock_anchor_ms" bigint NOT NULL,
	"manual_offset_override_ms" integer,
	"effective_offset_ms" integer DEFAULT 0 NOT NULL,
	"is_calibrated" boolean DEFAULT false NOT NULL,
	"deleted_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"geoguessr_game_id" text NOT NULL,
	"geoguessr_player_id" text NOT NULL,
	"round_number" integer NOT NULL,
	"raw_events" jsonb NOT NULL,
	"has_events" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"country_code" text,
	"region_name" text,
	"lat" double precision,
	"lng" double precision,
	"pano_id" text,
	"damage_multiplier" double precision DEFAULT 1 NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"timer_start_time" timestamp with time zone,
	"end_time" timestamp with time zone NOT NULL,
	"results_end_time" timestamp with time zone NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duo_best_score" integer DEFAULT 0 NOT NULL,
	"opponent_best_score" integer DEFAULT 0 NOT NULL,
	"hp_delta" integer DEFAULT 0 NOT NULL,
	"guesses" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_chunks" (
	"transcript_version_id" uuid NOT NULL,
	"chunk_no" integer NOT NULL,
	"recording_id" uuid NOT NULL,
	"utterance_count" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_chunks_transcript_version_id_chunk_no_pk" PRIMARY KEY("transcript_version_id","chunk_no")
);
--> statement-breakpoint
CREATE TABLE "transcript_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recording_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"model" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hotwords_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"expected_chunks" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utterances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transcript_version_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"chunk_no" integer NOT NULL,
	"text" text NOT NULL,
	"start_sample_ms" integer NOT NULL,
	"end_sample_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avg_logprob" double precision,
	"no_speech_prob" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_offset_measurements" ADD CONSTRAINT "clock_offset_measurements_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_memberships" ADD CONSTRAINT "duo_memberships_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_memberships" ADD CONSTRAINT "duo_memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reactions" ADD CONSTRAINT "learning_reactions_learning_id_learnings_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learnings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reactions" ADD CONSTRAINT "learning_reactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_rounds" ADD CONSTRAINT "learning_rounds_learning_id_learnings_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learnings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_rounds" ADD CONSTRAINT "learning_rounds_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_utterances" ADD CONSTRAINT "learning_utterances_learning_id_learnings_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learnings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_utterances" ADD CONSTRAINT "learning_utterances_utterance_id_utterances_id_fk" FOREIGN KEY ("utterance_id") REFERENCES "public"."utterances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_author_player_id_players_id_fk" FOREIGN KEY ("author_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_run_inputs" ADD CONSTRAINT "processing_run_inputs_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_run_inputs" ADD CONSTRAINT "processing_run_inputs_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_run_inputs" ADD CONSTRAINT "processing_run_inputs_transcript_version_id_transcript_versions_id_fk" FOREIGN KEY ("transcript_version_id") REFERENCES "public"."transcript_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_started_by_player_id_players_id_fk" FOREIGN KEY ("started_by_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_transcript_version_id_transcript_versions_id_fk" FOREIGN KEY ("transcript_version_id") REFERENCES "public"."transcript_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_versions" ADD CONSTRAINT "transcript_versions_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_versions" ADD CONSTRAINT "transcript_versions_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_transcript_version_id_transcript_versions_id_fk" FOREIGN KEY ("transcript_version_id") REFERENCES "public"."transcript_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_player_scope_idx" ON "api_tokens" USING btree ("player_id","scope");--> statement-breakpoint
CREATE INDEX "auth_sessions_player_idx" ON "auth_sessions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "clock_offsets_recording_idx" ON "clock_offset_measurements" USING btree ("recording_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_duo_gg_id_uidx" ON "games" USING btree ("duo_id","geoguessr_game_id");--> statement-breakpoint
CREATE INDEX "games_duo_time_idx" ON "games" USING btree ("duo_id","started_at","ended_at");--> statement-breakpoint
CREATE INDEX "learnings_duo_created_idx" ON "learnings" USING btree ("duo_id","created_at");--> statement-breakpoint
CREATE INDEX "learnings_run_idx" ON "learnings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "processing_runs_session_purpose_idx" ON "processing_runs" USING btree ("duo_id","session_id","purpose","status");--> statement-breakpoint
CREATE INDEX "recordings_duo_started_idx" ON "recordings" USING btree ("duo_id","started_at");--> statement-breakpoint
CREATE INDEX "recordings_session_idx" ON "recordings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "recordings_player_duo_live_idx" ON "recordings" USING btree ("player_id","duo_id","stopped_at");--> statement-breakpoint
CREATE UNIQUE INDEX "replays_game_player_round_uidx" ON "replays" USING btree ("game_id","geoguessr_player_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_game_round_uidx" ON "rounds" USING btree ("game_id","round_number");--> statement-breakpoint
CREATE INDEX "rounds_duo_time_idx" ON "rounds" USING btree ("duo_id","start_time","results_end_time");--> statement-breakpoint
CREATE INDEX "sessions_duo_idx" ON "sessions" USING btree ("duo_id");--> statement-breakpoint
CREATE INDEX "transcript_chunks_recording_idx" ON "transcript_chunks" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "transcript_versions_recording_idx" ON "transcript_versions" USING btree ("recording_id","created_at");--> statement-breakpoint
CREATE INDEX "utterances_duo_time_idx" ON "utterances" USING btree ("duo_id","started_at","ended_at");--> statement-breakpoint
CREATE INDEX "utterances_version_chunk_idx" ON "utterances" USING btree ("transcript_version_id","chunk_no");--> statement-breakpoint
CREATE INDEX "utterances_recording_time_idx" ON "utterances" USING btree ("recording_id","started_at");