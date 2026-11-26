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

const noSpeech = (): RoundSpeech => ({ utteranceIds: [], utterancesById: {} });

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
  const [own] = await db.select({ gameId: rounds.gameId }).from(rounds).where(and(eq(rounds.id, roundId), roundInDuo(duoId)));
  if (!own) return noSpeech();
  return (await loadSpeech(db, duoId, own.gameId, new Set([roundId]), wb)).get(roundId) ?? noSpeech();
}

/**
 * The full speech of every Round in one Game, by Round id (#82): what the Game page's transcript panel shows for a
 * focused Round. One Game's speech, not the Duo's, so the page still reads the shared cited-speech derivation.
 * Rounds without speech are absent.
 */
export async function loadGameSpeech(
  db: AppDb,
  duoId: string,
  gameId: string,
  wb: Pick<WorkbenchData, "learnings">,
): Promise<Map<string, RoundSpeech>> {
  return loadSpeech(db, duoId, gameId, null, wb);
}

async function loadSpeech(
  db: AppDb,
  duoId: string,
  gameId: string,
  only: ReadonlySet<string> | null,
  wb: Pick<WorkbenchData, "learnings">,
): Promise<Map<string, RoundSpeech>> {
  const out = new Map<string, RoundSpeech>();
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
    .where(and(eq(rounds.gameId, gameId), roundInDuo(duoId)));
  const windows = [...roundWindowsById(siblings)].flatMap(([id, w]) =>
    w?.full && (!only || only.has(id)) ? [{ id, window: w.full }] : [],
  );
  if (windows.length === 0) return out;
  const from = new Date(Math.min(...windows.map((w) => w.window.startedAt.getTime())));
  const to = new Date(Math.max(...windows.map((w) => w.window.endedAt.getTime())));

  // A superset in SQL; intervalsOverlap below is the exact check.
  const candidates = await db
    .select(UTTERANCE_COLUMNS)
    .from(utterances)
    .where(and(lte(utterances.startedAt, to), gte(utterances.endedAt, from), speechInDuo(duoId)))
    .orderBy(asc(utterances.startedAt), asc(utterances.id));
  const recordingIds = [...new Set(candidates.map((u) => u.recordingId))];
  if (recordingIds.length === 0) return out;
  const [currentVersions, recs] = await Promise.all([
    getCurrentTranscriptVersionIds(db, recordingIds),
    db.select({ id: recordings.id, sessionId: recordings.sessionId }).from(recordings).where(inArray(recordings.id, recordingIds)),
  ]);
  const current = new Set(currentVersions.values());
  const live = candidates.filter((u) => current.has(u.transcriptVersionId));
  const byRound = windows.map((w) => ({ id: w.id, rows: live.filter((u) => intervalsOverlap(u, w.window)) }));
  const rows = [...new Map(byRound.flatMap((r) => r.rows.map((u) => [u.id, u] as const))).values()];
  if (rows.length === 0) return out;

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
  const mapped = new Map(rows.map((row) => [row.id, toWorkbenchUtterance(row, false)]));
  for (const r of byRound) {
    if (r.rows.length === 0) continue;
    const speech = noSpeech();
    for (const row of r.rows) {
      speech.utteranceIds.push(row.id);
      speech.utterancesById[row.id] = mapped.get(row.id)!;
    }
    out.set(r.id, speech);
  }
  return out;
}
