CREATE TABLE "call_label_utterances" (
	"call_label_id" uuid NOT NULL,
	"utterance_id" uuid NOT NULL,
	CONSTRAINT "call_label_utterances_call_label_id_utterance_id_pk" PRIMARY KEY("call_label_id","utterance_id")
);
--> statement-breakpoint
CREATE TABLE "call_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"called" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_label_utterances" ADD CONSTRAINT "call_label_utterances_call_label_id_call_labels_id_fk" FOREIGN KEY ("call_label_id") REFERENCES "public"."call_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_label_utterances" ADD CONSTRAINT "call_label_utterances_utterance_id_utterances_id_fk" FOREIGN KEY ("utterance_id") REFERENCES "public"."utterances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_labels" ADD CONSTRAINT "call_labels_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_labels" ADD CONSTRAINT "call_labels_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_labels" ADD CONSTRAINT "call_labels_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_labels_run_round_uidx" ON "call_labels" USING btree ("run_id","round_id");--> statement-breakpoint
CREATE INDEX "call_labels_duo_idx" ON "call_labels" USING btree ("duo_id");--> statement-breakpoint
CREATE INDEX "call_labels_round_idx" ON "call_labels" USING btree ("round_id");