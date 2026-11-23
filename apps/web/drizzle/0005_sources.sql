CREATE TABLE "claim_images" (
	"claim_id" uuid NOT NULL,
	"source_image_id" uuid NOT NULL,
	CONSTRAINT "claim_images_claim_id_source_image_id_pk" PRIMARY KEY("claim_id","source_image_id")
);
--> statement-breakpoint
CREATE TABLE "source_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_version_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_sections" (
	"source_version_id" uuid NOT NULL,
	"anchor" text NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text NOT NULL,
	"level" integer NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "source_sections_source_version_id_anchor_pk" PRIMARY KEY("source_version_id","anchor")
);
--> statement-breakpoint
CREATE TABLE "source_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"duo_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"markdown" text NOT NULL,
	"created_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"kind" text NOT NULL,
	"created_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" DROP CONSTRAINT "claim_evidence_kind_ref";--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "section_anchor" text;--> statement-breakpoint
ALTER TABLE "claim_images" ADD CONSTRAINT "claim_images_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_images" ADD CONSTRAINT "claim_images_source_image_id_source_images_id_fk" FOREIGN KEY ("source_image_id") REFERENCES "public"."source_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_images" ADD CONSTRAINT "source_images_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_images" ADD CONSTRAINT "source_images_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_duo_id_duos_id_fk" FOREIGN KEY ("duo_id") REFERENCES "public"."duos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_images_version_name_uidx" ON "source_images" USING btree ("source_version_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "source_versions_source_no_uidx" ON "source_versions" USING btree ("source_id","version_no");--> statement-breakpoint
CREATE INDEX "sources_duo_idx" ON "sources" USING btree ("duo_id");--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_claim_section_uidx" ON "claim_evidence" USING btree ("claim_id","source_version_id","section_anchor");--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_kind_ref" CHECK (("claim_evidence"."kind" = 'round' AND "claim_evidence"."round_id" IS NOT NULL) OR ("claim_evidence"."kind" = 'player' AND "claim_evidence"."player_id" IS NOT NULL) OR ("claim_evidence"."kind" = 'documentation' AND "claim_evidence"."source_version_id" IS NOT NULL AND "claim_evidence"."section_anchor" IS NOT NULL));