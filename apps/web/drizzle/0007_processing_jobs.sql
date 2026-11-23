CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"requested_by_player_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_id" uuid,
	"token_hash" text,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_requested_by_player_id_players_id_fk" FOREIGN KEY ("requested_by_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_jobs_status_created_idx" ON "processing_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_session_idx" ON "processing_jobs" USING btree ("duo_id","session_id","purpose","status");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_token_uidx" ON "processing_jobs" USING btree ("token_hash");