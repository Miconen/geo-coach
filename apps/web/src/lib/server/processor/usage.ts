// What a worker's Claude Code run used (#94): recorded on Claim tagging jobs, parsed in worker.ts.

export interface ClaudeTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * What one Claude Code run used, from its `--output-format json` result. `costUsd` is Claude Code's
 * `total_cost_usd`: what the run would cost at API prices. Production is billed by subscription, so it's an
 * API-equivalent cost, not a bill.
 */
export interface ClaudeRunUsage extends ClaudeTokenCounts {
  /** Every model the run used, the most output first: the job's model, then Claude Code's own small model. */
  models: string[];
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number | null;
  byModel: Array<{ model: string; costUsd: number | null } & ClaudeTokenCounts>;
}
