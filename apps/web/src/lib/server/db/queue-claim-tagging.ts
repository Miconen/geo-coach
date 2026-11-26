import { eq, or } from "drizzle-orm";
import { getDb } from "./index.js";
import { duoMemberships, duos } from "./schema.js";
import { enqueueClaimTagging } from "../mcp/processing-jobs.js";

// Queues Claim tagging (#89) for the processing worker from the command line, like the Clues page's control:
//   pnpm --filter @geo-coach/web clues:tag -- --duo "<name or id>" --limit 100   (the test run)
//   pnpm --filter @geo-coach/web clues:tag -- --duo "<name or id>" --all         (the full backfill)
// The worker then tags 100 Claims per job, newest first; stopping it and queueing again continues where it stopped.

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main() {
  const selector = arg("duo");
  const all = process.argv.includes("--all");
  const limit = all ? null : Number(arg("limit"));
  if (!selector || (!all && !(Number.isInteger(limit) && limit! > 0))) {
    console.error('Usage: clues:tag -- --duo "<name or id>" (--limit N | --all)');
    process.exit(2);
  }
  const db = getDb();
  const isId = /^[0-9a-f-]{36}$/i.test(selector);
  const [duo] = await db
    .select()
    .from(duos)
    .where(isId ? or(eq(duos.id, selector), eq(duos.name, selector)) : eq(duos.name, selector));
  if (!duo) throw new Error(`No Duo "${selector}"`);
  const member = await db.query.duoMemberships.findFirst({ where: eq(duoMemberships.duoId, duo.id) });
  if (!member) throw new Error(`Duo ${duo.name} has no Players`);
  const res = await enqueueClaimTagging(db, member.playerId, { duoId: duo.id, limit });
  console.log(`Queued ${res.claims} Claims of ${duo.name} in ${res.jobs} job(s). The processing worker picks them up.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Queueing Claim tagging failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
