import { and, eq, inArray } from "drizzle-orm";
import { hedgeKind, intervalsOverlap, isCallableHedge, uuidv7, type DerivedGuess } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { callLabelUtterances, callLabels, processingRuns, rounds, utterances } from "../db/schema.js";
import { roundInDuo, runInDuo, speechInDuo } from "./scope.js";

type RoundRow = typeof rounds.$inferSelect;

/** A Round's guessing phase (play and countdown), where a Call can be spoken. */
export function roundGuessingInterval(round: Pick<RoundRow, "startTime" | "endTime">) {
  return { startedAt: round.startTime, endedAt: round.endTime };
}

/** The Duo's hedge kind for a stored Round, from its derived guesses. */
export function duoHedgeKind(round: Pick<RoundRow, "guesses">) {
  return hedgeKind(round.guesses.filter((g: DerivedGuess) => g.isDuo));
}

/** Whether a stored Round is a Split or Spread for the Duo, so a Call can be labelled. */
export function isCallableRound(round: Pick<RoundRow, "guesses">): boolean {
  return isCallableHedge(duoHedgeKind(round));
}

/**
 * Saves a `calls` run's labels. Labelling a Round again in the same run
 * replaces that run's earlier label for it.
 */
export async function insertRunCallLabels(
  db: AppDb,
  runId: string,
  duoId: string,
  items: Array<{ roundId: string; called: boolean; note: string | null; utteranceIds: string[] }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    await db
      .delete(callLabels)
      .where(and(eq(callLabels.runId, runId), eq(callLabels.roundId, item.roundId)));
    const id = uuidv7();
    await db.insert(callLabels).values({
      id,
      duoId,
      runId,
      roundId: item.roundId,
      called: item.called,
      note: item.note,
    });
    if (item.utteranceIds.length > 0) {
      await db
        .insert(callLabelUtterances)
        .values(item.utteranceIds.map((utteranceId) => ({ callLabelId: id, utteranceId })))
        .onConflictDoNothing();
    }
    ids.push(id);
  }
  return ids;
}

export interface CurrentCallLabel {
  id: string;
  runId: string;
  roundId: string;
  called: boolean;
  note: string | null;
  utteranceIds: string[];
}

export interface CallLabelHistoryEntry extends CurrentCallLabel {
  sessionId: string;
  runFinishedAt: Date | null;
  /** current: in effect for its Session; superseded: a later finished calls run in the same Session covers
   * the Round's guessing phase; draft: its run is open or abandoned. */
  status: "current" | "superseded" | "draft";
  supersededByRunId: string | null;
}

/**
 * Per-Session Call label history (plan #56, 0b): every label of this Duo with its status inside its own
 * Session. A label counts once its run finishes, until a later finished `calls` run in the same Session
 * covers the Round's guessing phase, whether or not that run labelled the Round again (ADR 0001, 0002).
 * Another Session's labels never supersede it.
 */
export async function deriveCallLabelHistory(db: AppDb, duoId: string): Promise<CallLabelHistoryEntry[]> {
  const [labels, callRunsAll] = await Promise.all([
    db.query.callLabels.findMany({ where: eq(callLabels.duoId, duoId) }),
    db.query.processingRuns.findMany({
      where: and(runInDuo(duoId), eq(processingRuns.purpose, "calls")),
    }),
  ]);
  if (labels.length === 0) return [];

  const runById = new Map(callRunsAll.map((r) => [r.id, r]));
  const callRuns = callRunsAll.filter((r) => r.status === "finished" && r.finishedAt !== null);
  const roundIds = [...new Set(labels.map((l) => l.roundId))];
  const labelIds = labels.map((l) => l.id);
  const [labelRounds, links] = await Promise.all([
    db.query.rounds.findMany({ where: and(inArray(rounds.id, roundIds), roundInDuo(duoId)) }),
    db
      .select({ callLabelId: callLabelUtterances.callLabelId, utteranceId: callLabelUtterances.utteranceId })
      .from(callLabelUtterances)
      .innerJoin(utterances, eq(utterances.id, callLabelUtterances.utteranceId))
      .where(and(inArray(callLabelUtterances.callLabelId, labelIds), speechInDuo(duoId))),
  ]);
  const roundById = new Map(labelRounds.map((r) => [r.id, r]));
  const utterancesByLabel = new Map<string, string[]>();
  for (const link of links) {
    const list = utterancesByLabel.get(link.callLabelId) ?? [];
    list.push(link.utteranceId);
    utterancesByLabel.set(link.callLabelId, list);
  }

  const isLater = (a: typeof callRuns[number], b: typeof callRuns[number]) => {
    const aMs = a.finishedAt!.getTime();
    const bMs = b.finishedAt!.getTime();
    return aMs > bMs || (aMs === bMs && a.id > b.id);
  };

  const out: CallLabelHistoryEntry[] = [];
  for (const label of labels) {
    const run = runById.get(label.runId);
    const round = roundById.get(label.roundId);
    // A label whose run fails the run-to-Session check, or whose Round fails the Round/Game check, is dropped.
    if (!run || !round) continue;
    let status: CallLabelHistoryEntry["status"] = "current";
    let supersededByRunId: string | null = null;
    if (run.status !== "finished" || !run.finishedAt) {
      status = "draft";
    } else {
      const guessing = roundGuessingInterval(round);
      const replacer = callRuns
        .filter(
          (other) =>
            other.id !== run.id &&
            other.sessionId === run.sessionId &&
            isLater(other, run) &&
            intervalsOverlap(guessing, { startedAt: other.rangeStart, endedAt: other.rangeEnd }),
        )
        .sort((a, b) => (isLater(a, b) ? 1 : -1))[0];
      if (replacer) {
        status = "superseded";
        supersededByRunId = replacer.id;
      }
    }
    out.push({
      id: label.id,
      runId: label.runId,
      roundId: label.roundId,
      called: label.called,
      note: label.note,
      utteranceIds: utterancesByLabel.get(label.id) ?? [],
      sessionId: run.sessionId,
      runFinishedAt: run.finishedAt,
      status,
      supersededByRunId,
    });
  }
  return out;
}

/**
 * The Call labels in effect for a Duo, one per Round at most: the Stats/MCP projection of the per-Session
 * history. Where two Sessions both have a current label for one Round, the winner is the label whose run
 * finished latest, then the higher run id. The projection never feeds back into the history.
 */
export async function deriveCurrentCallLabels(
  db: AppDb,
  duoId: string,
): Promise<Map<string, CurrentCallLabel>> {
  const history = await deriveCallLabelHistory(db, duoId);
  const current = new Map<string, CallLabelHistoryEntry>();
  for (const label of history) {
    if (label.status !== "current") continue;
    const held = current.get(label.roundId);
    if (!held) {
      current.set(label.roundId, label);
      continue;
    }
    const a = label.runFinishedAt!.getTime();
    const b = held.runFinishedAt!.getTime();
    if (a > b || (a === b && label.runId > held.runId)) current.set(label.roundId, label);
  }
  const result = new Map<string, CurrentCallLabel>();
  for (const [roundId, l] of current) {
    result.set(roundId, {
      id: l.id,
      runId: l.runId,
      roundId: l.roundId,
      called: l.called,
      note: l.note,
      utteranceIds: l.utteranceIds,
    });
  }
  return result;
}
