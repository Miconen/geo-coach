CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"round_id" uuid,
	"player_id" uuid,
	"run_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_round_only_for" CHECK ("claim_evidence"."kind" <> 'round' OR "claim_evidence"."direction" = 'for'),
	CONSTRAINT "claim_evidence_kind_ref" CHECK (("claim_evidence"."kind" = 'round' AND "claim_evidence"."round_id" IS NOT NULL) OR ("claim_evidence"."kind" = 'player' AND "claim_evidence"."player_id" IS NOT NULL) OR "claim_evidence"."kind" = 'documentation')
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"run_id" uuid,
	"created_by_player_id" uuid,
	"text" text NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learnings" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_duo_idx" ON "claim_evidence" USING btree ("duo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_claim_round_uidx" ON "claim_evidence" USING btree ("claim_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_claim_player_uidx" ON "claim_evidence" USING btree ("claim_id","player_id");--> statement-breakpoint
CREATE INDEX "claims_duo_idx" ON "claims" USING btree ("duo_id","created_at");--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learnings_claim_idx" ON "learnings" USING btree ("claim_id");