CREATE TABLE "claim_clues" (
	"claim_id" uuid NOT NULL,
	"clue_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"country" text NOT NULL,
	"prevalence" text NOT NULL,
	CONSTRAINT "claim_clues_claim_id_clue_id_country_pk" PRIMARY KEY("claim_id","clue_id","country")
);
--> statement-breakpoint
CREATE TABLE "claim_tagging_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"requested_by_player_id" uuid NOT NULL,
	"claim_limit" integer NOT NULL,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tagged_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"token_hash" text,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"family" text NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_clue_utterances" (
	"round_clue_id" uuid NOT NULL,
	"utterance_id" uuid NOT NULL,
	CONSTRAINT "round_clue_utterances_round_clue_id_utterance_id_pk" PRIMARY KEY("round_clue_id","utterance_id")
);
--> statement-breakpoint
CREATE TABLE "round_clues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"clue_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "clues_prompt_version" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "clues_tagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claim_clues" ADD CONSTRAINT "claim_clues_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_clues" ADD CONSTRAINT "claim_clues_clue_id_clues_id_fk" FOREIGN KEY ("clue_id") REFERENCES "public"."clues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_clues" ADD CONSTRAINT "claim_clues_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD CONSTRAINT "claim_tagging_jobs_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD CONSTRAINT "claim_tagging_jobs_requested_by_player_id_players_id_fk" FOREIGN KEY ("requested_by_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clues" ADD CONSTRAINT "clues_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clue_utterances" ADD CONSTRAINT "round_clue_utterances_round_clue_id_round_clues_id_fk" FOREIGN KEY ("round_clue_id") REFERENCES "public"."round_clues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clue_utterances" ADD CONSTRAINT "round_clue_utterances_utterance_id_utterances_id_fk" FOREIGN KEY ("utterance_id") REFERENCES "public"."utterances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clues" ADD CONSTRAINT "round_clues_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clues" ADD CONSTRAINT "round_clues_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clues" ADD CONSTRAINT "round_clues_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_clues" ADD CONSTRAINT "round_clues_clue_id_clues_id_fk" FOREIGN KEY ("clue_id") REFERENCES "public"."clues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_clues_clue_idx" ON "claim_clues" USING btree ("clue_id");--> statement-breakpoint
CREATE INDEX "claim_clues_duo_idx" ON "claim_clues" USING btree ("duo_id");--> statement-breakpoint
CREATE INDEX "claim_tagging_jobs_status_created_idx" ON "claim_tagging_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "claim_tagging_jobs_duo_idx" ON "claim_tagging_jobs" USING btree ("duo_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_tagging_jobs_token_uidx" ON "claim_tagging_jobs" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "clues_duo_family_name_uidx" ON "clues" USING btree ("duo_id","family","name");--> statement-breakpoint
CREATE INDEX "round_clue_utterances_utterance_idx" ON "round_clue_utterances" USING btree ("utterance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_clues_run_round_clue_uidx" ON "round_clues" USING btree ("run_id","round_id","clue_id");--> statement-breakpoint
CREATE INDEX "round_clues_round_idx" ON "round_clues" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "round_clues_clue_idx" ON "round_clues" USING btree ("clue_id");--> statement-breakpoint
CREATE INDEX "round_clues_duo_idx" ON "round_clues" USING btree ("duo_id");