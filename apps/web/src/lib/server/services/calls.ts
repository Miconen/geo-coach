import { and, eq, inArray } from "drizzle-orm";
import { hedgeKind, intervalsOverlap, isCallableHedge, uuidv7, type DerivedGuess } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { callLabelUtterances, callLabels, processingRuns, rounds } from "../db/schema.js";

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

/**
 * The Call labels in effect for a Duo, one per Round at most (ADR 0001, 0002).
 * A label counts once its run finishes, until a later finished `calls` run in
 * the same Session covers the Round's guessing phase, whether or not that run
 * labelled the Round again.
 */
export async function deriveCurrentCallLabels(
  db: AppDb,
  duoId: string,
): Promise<Map<string, CurrentCallLabel>> {
  const [labels, callRuns] = await Promise.all([
    db.query.callLabels.findMany({ where: eq(callLabels.duoId, duoId) }),
    db.query.processingRuns.findMany({
      where: and(
        eq(processingRuns.duoId, duoId),
        eq(processingRuns.purpose, "calls"),
        eq(processingRuns.status, "finished"),
      ),
    }),
  ]);
  const current = new Map<string, CurrentCallLabel>();
  if (labels.length === 0) return current;

  const runById = new Map(callRuns.map((r) => [r.id, r]));
  const roundIds = [...new Set(labels.map((l) => l.roundId))];
  const labelIds = labels.map((l) => l.id);
  const [labelRounds, links] = await Promise.all([
    db.query.rounds.findMany({ where: inArray(rounds.id, roundIds) }),
    db.query.callLabelUtterances.findMany({
      where: inArray(callLabelUtterances.callLabelId, labelIds),
    }),
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

  for (const label of labels) {
    const run = runById.get(label.runId);
    const round = roundById.get(label.roundId);
    if (!run || !run.finishedAt || !round) continue;
    const guessing = roundGuessingInterval(round);
    const replaced = callRuns.some(
      (other) =>
        other.id !== run.id &&
        other.finishedAt !== null &&
        other.sessionId === run.sessionId &&
        isLater(other, run) &&
        intervalsOverlap(guessing, { startedAt: other.rangeStart, endedAt: other.rangeEnd }),
    );
    if (replaced) continue;
    current.set(label.roundId, {
      id: label.id,
      runId: label.runId,
      roundId: label.roundId,
      called: label.called,
      note: label.note,
      utteranceIds: utterancesByLabel.get(label.id) ?? [],
    });
  }
  return current;
}
