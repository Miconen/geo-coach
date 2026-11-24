CREATE INDEX "call_label_utterances_utterance_idx" ON "call_label_utterances" USING btree ("utterance_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_round_idx" ON "claim_evidence" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_run_idx" ON "claim_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "claims_run_idx" ON "claims" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "learning_rounds_round_idx" ON "learning_rounds" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "learning_utterances_utterance_idx" ON "learning_utterances" USING btree ("utterance_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_run_idx" ON "processing_jobs" USING btree ("run_id");