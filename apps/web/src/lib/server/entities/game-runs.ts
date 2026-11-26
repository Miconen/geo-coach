import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { intervalsOverlap, isLearningRunPurpose } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { callLabels, claimEvidence, claims, processingRuns, rounds } from "../db/schema.js";
import { evidenceInDuo, roundInDuo, runInDuo } from "../services/index.js";
import type { RunTimelineCounts, RunTimelineRow } from "../workbench/run-timeline.js";
import type { WorkbenchData, WorkbenchGame } from "../workbench/view-model.js";
import { buildRunRows } from "./session-runs.js";

/** Why a run is listed on a Game page (#56 2a(ii) run eligibility). */
export type GameRunReason = "round-citation" | "call-label" | "evidence" | "session-overlap";

export interface GameRun {
  row: RunTimelineRow;
  sessionId: string;
  /** The owning Session's date (rows link to /sessions/[sessionId]?run=<id>#run-<id>). */
  sessionStartedAt: string | null;
  reasons: GameRunReason[];
  /** Admitted only by Evidence: shows "evidence only: N Claims". */
  evidenceOnly: boolean;
  /** Outputs on this Game's Rounds only (explicit or derived Round links of an eligible run). */
  game: {
    learnings: RunTimelineCounts | null;
    callLabels: RunTimelineCounts | null;
    claimsCreated: number;
    claimsWithNewEvidence: number;
  };
}

/**
 * The runs a Game page lists, newest first. A run qualifies by an explicit Round citation, a call label or an
 * Evidence citation on any stored Round of the Game (any Session; a Round a later re-upload dropped still counts),
 * or by range overlap when its Session overlaps the Game. Debrief fallback and derived Round links never qualify.
 * Run-wide counts are the run's own; Game-scoped counts cover only this Game's Rounds and never exceed them.
 */
export async function loadGameRuns(
  db: AppDb,
  duoId: string,
  game: WorkbenchGame,
  full: Pick<WorkbenchData, "learnings" | "sessions">,
): Promise<GameRun[]> {
  const storedRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.gameId, game.id), roundInDuo(duoId)));
  const roundIds = new Set([...storedRounds.map((r) => r.id), ...game.roundIds]);
  if (roundIds.size === 0) return [];
  const roundList = [...roundIds];

  const [labels, evidence] = await Promise.all([
    db
      .select({ runId: callLabels.runId, roundId: callLabels.roundId, id: callLabels.id })
      .from(callLabels)
      .where(and(eq(callLabels.duoId, duoId), inArray(callLabels.roundId, roundList))),
    db
      .select({ runId: claimEvidence.runId, claimId: claimEvidence.claimId, claimRunId: claims.runId })
      .from(claimEvidence)
      .innerJoin(claims, eq(claims.id, claimEvidence.claimId))
      .where(and(evidenceInDuo(duoId), inArray(claimEvidence.roundId, roundList))),
  ]);

  const reasons = new Map<string, Set<GameRunReason>>();
  const add = (runId: string | null, reason: GameRunReason) => {
    if (!runId) return;
    const set = reasons.get(runId) ?? new Set<GameRunReason>();
    set.add(reason);
    reasons.set(runId, set);
  };
  for (const l of full.learnings) {
    if (l.runId && l.explicitRoundIds.some((id) => roundIds.has(id))) add(l.runId, "round-citation");
  }
  for (const label of labels) add(label.runId, "call-label");
  for (const ev of evidence) add(ev.runId, "evidence");
  // Only runs already admitted above or whose range can overlap the Game in one of its Sessions (#72): never every
  // run of the Duo. The range test here is a superset; intervalsOverlap below is the exact check.
  const gameSessions = new Set(game.sessionIds);
  const gameSpan = { startedAt: new Date(game.startedAt), endedAt: new Date(game.endedAt) };
  const admitted = [...reasons.keys()];
  const overlapping =
    gameSessions.size > 0
      ? and(
          inArray(processingRuns.sessionId, [...gameSessions]),
          lte(processingRuns.rangeStart, gameSpan.endedAt),
          gte(processingRuns.rangeEnd, gameSpan.startedAt),
        )
      : undefined;
  const candidates = admitted.length > 0 ? or(inArray(processingRuns.id, admitted), overlapping) : overlapping;
  const runs = candidates ? await db.select().from(processingRuns).where(and(runInDuo(duoId), candidates)) : [];
  for (const run of runs) {
    if (gameSessions.has(run.sessionId) && intervalsOverlap({ startedAt: run.rangeStart, endedAt: run.rangeEnd }, gameSpan)) {
      add(run.id, "session-overlap");
    }
  }
  if (reasons.size === 0) return [];

  const eligible = runs.filter((r) => reasons.has(r.id));
  const rows = await buildRunRows(
    db,
    duoId,
    eligible.map((r) => ({ kind: "run", id: r.id })),
  );
  const rowByRun = new Map(rows.map((r) => [r.runId!, r]));

  const out: GameRun[] = [];
  for (const run of eligible) {
    const row = rowByRun.get(run.id);
    if (!row) continue;
    const why = [...reasons.get(run.id)!];
    // Game-scoped Learnings: explicit or derived Round outputs of this eligible run on this Game.
    let learnings: RunTimelineCounts | null = null;
    if (isLearningRunPurpose(run.purpose)) {
      learnings = { current: 0, surviving: 0 };
      for (const l of full.learnings) {
        if (l.runId !== run.id) continue;
        if (![...l.explicitRoundIds, ...l.derivedRoundIds].some((id) => roundIds.has(id))) continue;
        learnings.surviving += 1;
        if (!row.draft && l.status === "current") learnings.current += 1;
      }
    }
    let gameLabels: RunTimelineCounts | null = null;
    if (run.purpose === "calls") {
      const n = labels.filter((x) => x.runId === run.id).length;
      // Current is bounded by the run-wide current count (supersession is per Round label, Duo-wide).
      gameLabels = { surviving: n, current: Math.min(n, row.callLabels?.current ?? 0) };
    }
    // Game-scoped Claims are Evidence-based, distinct per Claim: created when the Claim's run gave the Evidence.
    const mine = evidence.filter((e) => e.runId === run.id);
    const created = new Set(mine.filter((e) => e.claimRunId === run.id).map((e) => e.claimId));
    const existing = new Set(mine.filter((e) => e.claimRunId !== run.id).map((e) => e.claimId));
    const session = full.sessions.find((s) => s.id === run.sessionId);
    out.push({
      row,
      sessionId: run.sessionId,
      sessionStartedAt: session?.startedAt ?? null,
      reasons: why,
      evidenceOnly: why.length === 1 && why[0] === "evidence",
      game: {
        learnings,
        callLabels: gameLabels,
        claimsCreated: Math.min(created.size, row.claimsCreated),
        claimsWithNewEvidence: Math.min(existing.size, row.claimsWithNewEvidence),
      },
    });
  }
  return out.sort((a, b) =>
    a.row.sortAt !== b.row.sortAt ? (a.row.sortAt < b.row.sortAt ? 1 : -1) : a.row.key < b.row.key ? 1 : -1,
  );
}
