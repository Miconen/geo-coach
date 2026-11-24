import { and, gte, inArray, lte } from "drizzle-orm";
import { intervalsOverlap, roundWindowsById, type RoundWindows, type TimeInterval } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { rounds } from "../db/schema.js";
import { roundInDuo } from "./scope.js";

type RoundRow = typeof rounds.$inferSelect;

export interface WindowedRound {
  round: RoundRow;
  window: RoundWindows;
}

/**
 * The Duo's Rounds whose Guessing or Full window overlaps `span` (#56 1a-derivation). SQL clauses are
 * inclusive prefilters (a zero-length Round at the span's start is kept); every matched Game's sibling Rounds
 * are loaded so a window ending at a missing-start successor is clamped; then the exact intervalsOverlap runs.
 * Rounds with a missing start have no window and are never returned.
 */
export async function loadRoundsInSpan(
  db: AppDb,
  duoId: string,
  span: TimeInterval,
  kind: "full" | "guessing",
): Promise<WindowedRound[]> {
  const candidates = await db
    .select({ id: rounds.id, gameId: rounds.gameId })
    .from(rounds)
    .where(
      and(
        roundInDuo(duoId),
        lte(rounds.startTime, span.endedAt),
        kind === "full" ? gte(rounds.resultsEndTime, span.startedAt) : gte(rounds.endTime, span.startedAt),
      ),
    );
  if (candidates.length === 0) return [];
  const gameIds = [...new Set(candidates.map((c) => c.gameId))];
  const siblings = await db
    .select()
    .from(rounds)
    .where(and(roundInDuo(duoId), inArray(rounds.gameId, gameIds)));
  const windows = roundWindowsById(siblings);
  const wanted = new Set(candidates.map((c) => c.id));
  return siblings
    .flatMap((round) => {
      const window = windows.get(round.id);
      if (!wanted.has(round.id) || !window) return [];
      return intervalsOverlap(window[kind], span) ? [{ round, window }] : [];
    })
    .sort((a, b) => a.round.startTime.getTime() - b.round.startTime.getTime() || a.round.roundNumber - b.round.roundNumber);
}

/** Every Round of the Duo with its windows (Rounds with a missing start have none and are left out). */
export async function loadAllWindowedRounds(db: AppDb, duoId: string): Promise<WindowedRound[]> {
  const all = await db.select().from(rounds).where(roundInDuo(duoId));
  const windows = roundWindowsById(all);
  return all.flatMap((round) => {
    const window = windows.get(round.id);
    return window ? [{ round, window }] : [];
  });
}
