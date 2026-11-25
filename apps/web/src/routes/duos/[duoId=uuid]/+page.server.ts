import { redirect } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { learnings } from "$lib/server/db/schema.js";
import { findRunInDuo } from "$lib/server/services/index.js";
import { buildWorkbenchData } from "$lib/server/workbench/view-model.js";
import { parseCountryParam } from "$lib/country-param.js";
import { links } from "$lib/links.js";
import { isUuid } from "$lib/uuid.js";

const LATEST = 6;

/**
 * Home (#56 3a) routes X2 params: ?run= to its Session page, ?country= (shared ISO check) to Review's country,
 * ?learning= to Review's pin. Malformed params render Home (never 400); a missing or cross-Duo run or Learning
 * says it no longer exists. Bare Home lists the latest Games and Sessions, with no Learning or Claim text.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  const player = await assertDuoAccess(locals, params.duoId, url, db);
  const q = url.searchParams;
  const missing: Array<"run" | "learning"> = [];

  const runId = q.get("run");
  if (runId !== null && isUuid(runId)) {
    const run = await findRunInDuo(db, params.duoId, runId);
    if (run) redirect(302, links.session(params.duoId, run.sessionId, { run: run.id }));
    missing.push("run");
  }
  const learningId = q.get("learning");
  if (learningId !== null && isUuid(learningId)) {
    const found = await db.query.learnings.findFirst({
      where: and(eq(learnings.id, learningId), eq(learnings.duoId, params.duoId)),
      columns: { id: true },
    });
    if (found) redirect(302, links.review(params.duoId, { learning: found.id }));
    missing.push("learning");
  }
  const country = parseCountryParam(q.get("country"));
  if (country) redirect(302, links.review(params.duoId, { country }));

  const wb = await buildWorkbenchData(db, params.duoId, player.id, { speech: "cited" });
  const games = Object.values(wb.gamesById)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, LATEST)
    .map((g) => ({ id: g.id, startedAt: g.startedAt, opponentTeamName: g.opponentTeamName, won: g.won }));
  const sessions = wb.sessions.slice(0, LATEST).map((s) => ({ id: s.id, startedAt: s.startedAt }));
  return { home: { games, sessions }, missing };
};
