CREATE TABLE "transcript_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"source" text NOT NULL,
	"replacement" text NOT NULL,
	"country_code" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_suggestion_dismissals" (
	"duo_id" uuid NOT NULL,
	"source" text NOT NULL,
	"replacement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_suggestion_dismissals_duo_id_source_replacement_pk" PRIMARY KEY("duo_id","source","replacement")
);
--> statement-breakpoint
CREATE TABLE "utterance_edits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"utterance_id" uuid NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"original_text" text NOT NULL,
	"replacement" text NOT NULL,
	"created_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_rules" ADD CONSTRAINT "transcript_rules_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_rules" ADD CONSTRAINT "transcript_rules_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_suggestion_dismissals" ADD CONSTRAINT "transcript_suggestion_dismissals_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterance_edits" ADD CONSTRAINT "utterance_edits_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterance_edits" ADD CONSTRAINT "utterance_edits_utterance_id_utterances_id_fk" FOREIGN KEY ("utterance_id") REFERENCES "public"."utterances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utterance_edits" ADD CONSTRAINT "utterance_edits_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_rules_duo_source_country_uidx" ON "transcript_rules" USING btree ("duo_id","source","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "utterance_edits_span_uidx" ON "utterance_edits" USING btree ("utterance_id","char_start","char_end");--> statement-breakpoint
CREATE INDEX "utterance_edits_duo_idx" ON "utterance_edits" USING btree ("duo_id","created_at");