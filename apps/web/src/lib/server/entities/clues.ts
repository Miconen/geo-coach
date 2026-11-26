import type { AppDb } from "../db/index.js";
import { getCurrentPromptVersion } from "../mcp/prompts.js";
import { isProcessorOnline, listClaimTaggingJobs, type ClaimTaggingJobRow } from "../mcp/processing-jobs.js";
import { claimTaggingProgress, listDuoClues, type DuoClue } from "../services/index.js";

/** The Clues page (#89): the Duo's Clues to rename and merge, and how far Claim tagging has got. */
export interface CluesPayload {
  clues: DuoClue[];
  promptVersion: string;
  progress: { total: number; tagged: number; queued: number };
  jobs: ClaimTaggingJobRow[];
  workerOnline: boolean;
}

export async function loadCluesPayload(db: AppDb, duoId: string): Promise<CluesPayload> {
  const promptVersion = getCurrentPromptVersion("clue-tag");
  const [clues, progress, jobs] = await Promise.all([
    listDuoClues(db, duoId),
    claimTaggingProgress(db, duoId, promptVersion),
    listClaimTaggingJobs(db, duoId),
  ]);
  return { clues, promptVersion, progress, jobs, workerOnline: isProcessorOnline() };
}
