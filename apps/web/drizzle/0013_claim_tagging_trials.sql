CREATE TABLE "claim_clue_trials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"clue_id" uuid,
	"family" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"region_code" text,
	"prevalence" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_tagging_trial_claims" (
	"job_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"tagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_tagging_trial_claims_job_id_claim_id_pk" PRIMARY KEY("job_id","claim_id")
);
--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "requested_claim_ids" jsonb;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "created_clues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_tagging_jobs" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claim_clue_trials" ADD CONSTRAINT "claim_clue_trials_job_id_claim_tagging_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."claim_tagging_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_clue_trials" ADD CONSTRAINT "claim_clue_trials_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_clue_trials" ADD CONSTRAINT "claim_clue_trials_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_clue_trials" ADD CONSTRAINT "claim_clue_trials_clue_id_clues_id_fk" FOREIGN KEY ("clue_id") REFERENCES "public"."clues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_tagging_trial_claims" ADD CONSTRAINT "claim_tagging_trial_claims_job_id_claim_tagging_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."claim_tagging_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_tagging_trial_claims" ADD CONSTRAINT "claim_tagging_trial_claims_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_tagging_trial_claims" ADD CONSTRAINT "claim_tagging_trial_claims_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_clue_trials_job_claim_idx" ON "claim_clue_trials" USING btree ("job_id","claim_id");--> statement-breakpoint
CREATE INDEX "claim_clue_trials_claim_idx" ON "claim_clue_trials" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_tagging_trial_claims_claim_idx" ON "claim_tagging_trial_claims" USING btree ("claim_id");