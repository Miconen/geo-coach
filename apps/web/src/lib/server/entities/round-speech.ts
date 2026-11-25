import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { intervalsOverlap, roundWindowsById } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { recordings, rounds, utterances } from "../db/schema.js";
import {
  deriveWorkRangesBySession,
  getCurrentTranscriptVersionIds,
  loadTranscriptCorrector,
  roundInDuo,
  speechInDuo,
} from "../services/index.js";
import { UTTERANCE_COLUMNS, utteranceMapper, type WorkbenchData, type WorkbenchUtterance } from "../workbench/view-model.js";

export interface RoundSpeech {
  /** The Round's speech in the derivation's order: what a speech "all" derivation puts in round.utteranceIds. */
  utteranceIds: string[];
  utterancesById: Record<string, WorkbenchUtterance>;
}

/**
 * One Round's full speech, loaded on demand (#72) so the Round page can read the cited-speech derivation the Games
 * list and Game page share. Same rules as buildWorkbenchData: current Transcript versions only, Utterances
 * overlapping the Round's full window, mapped by the same utteranceMapper. `wb` supplies the Learnings that cite.
 */
export async function loadRoundSpeech(
  db: AppDb,
  duoId: string,
  roundId: string,
  wb: Pick<WorkbenchData, "learnings">,
): Promise<RoundSpeech> {
  const empty: RoundSpeech = { utteranceIds: [], utterancesById: {} };
  const [own] = await db.select({ gameId: rounds.gameId }).from(rounds).where(and(eq(rounds.id, roundId), roundInDuo(duoId)));
  if (!own) return empty;
  // A window depends on its siblings (the successor's start), so pass every Round of the Game.
  const siblings = await db
    .select({
      id: rounds.id,
      gameId: rounds.gameId,
      roundNumber: rounds.roundNumber,
      startTime: rounds.startTime,
      endTime: rounds.endTime,
      resultsEndTime: rounds.resultsEndTime,
    })
    .from(rounds)
    .where(and(eq(rounds.gameId, own.gameId), roundInDuo(duoId)));
  const window = roundWindowsById(siblings).get(roundId)?.full;
  if (!window) return empty;

  // A superset in SQL; intervalsOverlap below is the exact check.
  const candidates = await db
    .select(UTTERANCE_COLUMNS)
    .from(utterances)
    .where(
      and(
        lte(utterances.startedAt, window.endedAt),
        gte(utterances.endedAt, window.startedAt),
        speechInDuo(duoId),
      ),
    )
    .orderBy(asc(utterances.startedAt), asc(utterances.id));
  const recordingIds = [...new Set(candidates.map((u) => u.recordingId))];
  if (recordingIds.length === 0) return empty;
  const [currentVersions, recs] = await Promise.all([
    getCurrentTranscriptVersionIds(db, recordingIds),
    db.select({ id: recordings.id, sessionId: recordings.sessionId }).from(recordings).where(inArray(recordings.id, recordingIds)),
  ]);
  const current = new Set(currentVersions.values());
  const rows = candidates.filter((u) => current.has(u.transcriptVersionId) && intervalsOverlap(u, window));
  if (rows.length === 0) return empty;

  const recSessionById = new Map(recs.map((r) => [r.id, r.sessionId]));
  const sessionIds = [...new Set(rows.flatMap((u) => recSessionById.get(u.recordingId) ?? []))];
  const citedByUtterance = new Map<string, string[]>();
  for (const l of wb.learnings) {
    if (l.status !== "current") continue;
    for (const uId of l.utteranceIds) citedByUtterance.set(uId, [...(citedByUtterance.get(uId) ?? []), l.id]);
  }
  const [workRangesBySession, correctTranscript] = await Promise.all([
    deriveWorkRangesBySession(db, duoId, ["extract", "tips"] as const, sessionIds),
    loadTranscriptCorrector(db, duoId),
  ]);
  const toWorkbenchUtterance = utteranceMapper({ recSessionById, workRangesBySession, citedByUtterance, correctTranscript });
  const out: RoundSpeech = { utteranceIds: [], utterancesById: {} };
  for (const row of rows) {
    out.utteranceIds.push(row.id);
    out.utterancesById[row.id] = toWorkbenchUtterance(row, false);
  }
  return out;
}
