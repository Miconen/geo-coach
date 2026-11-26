ALTER TABLE "claim_clues" DROP CONSTRAINT "claim_clues_claim_id_clue_id_country_pk";--> statement-breakpoint
ALTER TABLE "claim_clues" ADD COLUMN "region_code" text;--> statement-breakpoint
ALTER TABLE "claim_clues" ADD CONSTRAINT "claim_clues_claim_clue_place_uq" UNIQUE NULLS NOT DISTINCT("claim_id","clue_id","country","region_code");