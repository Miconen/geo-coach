import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import {
  applyCorrections,
  compileCorrectionRules,
  findRegionSuggestions,
  normalizeRuleSource,
  selectRulesForCountries,
  STARTER_TRANSCRIPT_RULES,
  uuidv7,
  type CompiledCorrectionRules,
  type CorrectedText,
  type CorrectionEdit,
  type CorrectionRule,
  type DerivedGuess,
  type WordTiming,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  recordings,
  rounds,
  transcriptRules,
  transcriptSuggestionDismissals,
  transcriptVersions,
  utteranceEdits,
  utterances,
} from "../db/schema.js";
import { commonEnglishWords } from "./common-english-words.js";
import { DomainError } from "./recordings.js";
import { recordingInDuo, speechInDuo, versionInDuo } from "./scope.js";
import { loadAllWindowedRounds, loadRoundsInSpan, type WindowedRound } from "./rounds.js";

/** Rounds for the corrector's index: the Full window's effective end stands in for the stored results end. */
function indexRows(windowed: WindowedRound[]) {
  return windowed.map(({ round, window }) => ({
    startTime: window.full.startedAt,
    resultsEndTime: window.full.endedAt,
    countryCode: round.countryCode,
    guesses: round.guesses,
  }));
}

const SUGGESTION_RECORDING_LIMIT = 50;
const SUGGESTION_UTTERANCE_LIMIT = 5000;
const ROUND_BOUNDARY_MARGIN_MS = 2000;
const MAX_OCCURRENCES_PER_SUGGESTION = 50;
const MAX_RULE_HOTWORDS = 20;
const DEFAULT_EDIT_PAGE = 100;

export interface TranscriptRuleView {
  source: string;
  replacement: string;
  countryCode: string | null;
  enabled: boolean;
  starter: boolean;
}

export interface SuggestionOccurrence {
  utteranceId: string;
  charStart: number;
  charEnd: number;
  originalText: string;
}

export interface TranscriptSuggestionView {
  source: string;
  replacement: string;
  countryCode: string;
  score: number;
  count: number;
  example: string;
  occurrences: SuggestionOccurrence[];
}

export interface UtteranceEditView {
  id: string;
  utteranceId: string;
  originalText: string;
  replacement: string;
  context: string;
}

interface RoundWindow {
  start: number;
  end: number;
  countryCodes: string[];
}

interface RoundIndex {
  windows: RoundWindow[];
  maxEndThrough: number[];
}

function buildRoundIndex(
  rows: ReadonlyArray<{
    startTime: Date;
    resultsEndTime: Date;
    countryCode: string | null;
    guesses: DerivedGuess[];
  }>,
): RoundIndex {
  const windows = rows
    .map((r) => ({
      start: r.startTime.getTime(),
      end: r.resultsEndTime.getTime(),
      countryCodes: [
        ...new Set(
          [r.countryCode, ...r.guesses.filter((g) => g.isDuo).map((g) => g.countryCode)]
            .filter((c): c is string => Boolean(c))
            .map((c) => c.toUpperCase()),
        ),
      ],
    }))
    .sort((a, b) => a.start - b.start);
  const maxEndThrough: number[] = [];
  for (const [i, w] of windows.entries()) {
    maxEndThrough.push(Math.max(w.end, i > 0 ? maxEndThrough[i - 1]! : w.end));
  }
  return { windows, maxEndThrough };
}

/** The one Round a time span sits inside, allowing for clock error, or null when unclear. */
function soleRound(index: RoundIndex, firstMs: number, lastMs: number): RoundWindow | null {
  const { windows, maxEndThrough } = index;
  let low = 0;
  let high = windows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (windows[mid]!.start < lastMs + ROUND_BOUNDARY_MARGIN_MS) low = mid + 1;
    else high = mid;
  }
  let found: RoundWindow | null = null;
  for (let i = low - 1; i >= 0; i--) {
    if (maxEndThrough[i]! <= firstMs - ROUND_BOUNDARY_MARGIN_MS) break;
    const w = windows[i]!;
    if (w.end + ROUND_BOUNDARY_MARGIN_MS <= firstMs) continue;
    if (found) return null;
    found = w;
  }
  if (!found || firstMs < found.start || lastMs > found.end) return null;
  return found;
}

/** Each Recording's current Transcript version: the newest complete one, else the newest. */
async function currentVersionIds(db: AppDb, duoId: string, recordingIds?: string[]) {
  if (recordingIds?.length === 0) return new Set<string>();
  const rows = await db
    .select({
      id: transcriptVersions.id,
      recordingId: transcriptVersions.recordingId,
      isComplete: transcriptVersions.isComplete,
    })
    .from(transcriptVersions)
    .where(
      recordingIds
        ? and(versionInDuo(duoId), inArray(transcriptVersions.recordingId, recordingIds))
        : versionInDuo(duoId),
    )
    .orderBy(desc(transcriptVersions.createdAt), desc(transcriptVersions.id));
  const newest = new Map<string, string>();
  const newestComplete = new Map<string, string>();
  for (const row of rows) {
    if (!newest.has(row.recordingId)) newest.set(row.recordingId, row.id);
    if (row.isComplete && !newestComplete.has(row.recordingId)) {
      newestComplete.set(row.recordingId, row.id);
    }
  }
  return new Set(
    [...newest.entries()].map(([recordingId, id]) => newestComplete.get(recordingId) ?? id),
  );
}

export async function listTranscriptRules(
  db: AppDb,
  duoId: string,
): Promise<TranscriptRuleView[]> {
  const rows = await db.query.transcriptRules.findMany({
    where: eq(transcriptRules.duoId, duoId),
    orderBy: [desc(transcriptRules.updatedAt), desc(transcriptRules.id)],
  });
  const globalBySource = new Map(rows.filter((r) => !r.countryCode).map((r) => [r.source, r]));
  const views: TranscriptRuleView[] = [];
  const starterSources = new Set<string>();
  for (const rule of STARTER_TRANSCRIPT_RULES) {
    const source = normalizeRuleSource(rule.source);
    starterSources.add(source);
    const row = globalBySource.get(source);
    views.push({
      source,
      replacement: row?.replacement ?? rule.replacement,
      countryCode: null,
      enabled: row?.enabled ?? true,
      starter: true,
    });
  }
  for (const row of rows) {
    if (!row.countryCode && starterSources.has(row.source)) continue;
    views.push({
      source: row.source,
      replacement: row.replacement,
      countryCode: row.countryCode || null,
      enabled: row.enabled,
      starter: false,
    });
  }
  return views;
}

/** What each Duo's own enabled rules correct to, newest first, for priming Whisper. */
export async function loadRuleHotwords(db: AppDb, duoIds: string[]) {
  const byDuo = new Map<string, string[]>();
  if (duoIds.length === 0) return byDuo;
  const starters = new Set(STARTER_TRANSCRIPT_RULES.map((r) => normalizeRuleSource(r.source)));
  const rows = await db
    .select({
      duoId: transcriptRules.duoId,
      source: transcriptRules.source,
      countryCode: transcriptRules.countryCode,
      replacement: transcriptRules.replacement,
    })
    .from(transcriptRules)
    .where(and(inArray(transcriptRules.duoId, duoIds), eq(transcriptRules.enabled, true)))
    .orderBy(desc(transcriptRules.updatedAt), desc(transcriptRules.id));
  for (const row of rows) {
    if (!row.countryCode && starters.has(row.source)) continue;
    const list = byDuo.get(row.duoId) ?? [];
    if (list.length < MAX_RULE_HOTWORDS && !list.includes(row.replacement)) {
      list.push(row.replacement);
    }
    byDuo.set(row.duoId, list);
  }
  return byDuo;
}

interface CorrectableUtterance {
  id: string;
  text: string;
  recordingId?: string;
  startedAt?: Date;
  endedAt?: Date;
  startSampleMs?: number;
  words?: WordTiming[];
}

/** When the words were actually spoken, which can be tighter than the Utterance's bounds. */
function speechSpanMs(u: CorrectableUtterance): { firstMs: number; lastMs: number } | null {
  if (!u.startedAt) return null;
  const words = u.words ?? [];
  if (words.length > 0 && u.startSampleMs !== undefined) {
    const startedMs = u.startedAt.getTime();
    return {
      firstMs: startedMs + (words[0]!.startMs - u.startSampleMs),
      lastMs: startedMs + (words[words.length - 1]!.endMs - u.startSampleMs),
    };
  }
  return u.endedAt ? { firstMs: u.startedAt.getTime(), lastMs: u.endedAt.getTime() } : null;
}

/**
 * Returns a function giving an Utterance's effective text. Raw text is never modified.
 * Country rules only apply to speech from a calibrated Recording inside a single Round. All the
 * Duo's Rounds are considered, so every reader reaches the same answer near a Round boundary.
 */
export async function loadTranscriptCorrector(
  db: AppDb,
  duoId: string,
): Promise<(u: CorrectableUtterance) => CorrectedText> {
  const [rules, editRows] = await Promise.all([
    listTranscriptRules(db, duoId),
    db
      .select({
        utteranceId: utteranceEdits.utteranceId,
        transcriptVersionId: utterances.transcriptVersionId,
        charStart: utteranceEdits.charStart,
        charEnd: utteranceEdits.charEnd,
        originalText: utteranceEdits.originalText,
        replacement: utteranceEdits.replacement,
      })
      .from(utteranceEdits)
      .innerJoin(utterances, eq(utterances.id, utteranceEdits.utteranceId))
      .where(and(eq(utteranceEdits.duoId, duoId), speechInDuo(duoId)))
      .orderBy(desc(utteranceEdits.createdAt), desc(utteranceEdits.id)),
  ]);

  const current = editRows.length > 0 ? await currentVersionIds(db, duoId) : new Set<string>();
  const editsByUtterance = new Map<string, CorrectionEdit[]>();
  for (const e of editRows) {
    if (!current.has(e.transcriptVersionId)) continue;
    const list = editsByUtterance.get(e.utteranceId) ?? [];
    list.push(e);
    editsByUtterance.set(e.utteranceId, list);
  }

  const activeRules: CorrectionRule[] = rules.filter((r) => r.enabled);
  const compiledByCountries = new Map<string, CompiledCorrectionRules>();
  const compiledFor = (countryCodes: string[]) => {
    const key = [...countryCodes].sort().join(",");
    let compiled = compiledByCountries.get(key);
    if (!compiled) {
      compiled = compileCorrectionRules(selectRulesForCountries(activeRules, countryCodes));
      compiledByCountries.set(key, compiled);
    }
    return compiled;
  };

  let roundIndex: RoundIndex | null = null;
  let calibrated = new Set<string>();
  if (activeRules.some((r) => r.countryCode)) {
    const [roundRows, recordingRows] = await Promise.all([
      loadAllWindowedRounds(db, duoId).then(indexRows),
      db
        .select({ id: recordings.id })
        .from(recordings)
        .where(and(recordingInDuo(duoId), eq(recordings.isCalibrated, true))),
    ]);
    roundIndex = buildRoundIndex(roundRows);
    calibrated = new Set(recordingRows.map((r) => r.id));
  }

  return (u) => {
    let countryCodes: string[] = [];
    if (roundIndex && u.recordingId && calibrated.has(u.recordingId)) {
      const span = speechSpanMs(u);
      if (span) countryCodes = soleRound(roundIndex, span.firstMs, span.lastMs)?.countryCodes ?? [];
    }
    return applyCorrections(u.text, compiledFor(countryCodes), editsByUtterance.get(u.id) ?? []);
  };
}

function cleanCountry(countryCode: string | null | undefined): string {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (code && !/^[A-Z]{2}$/.test(code)) {
    throw new DomainError("invalid_rule", "A country must be a two-letter code.");
  }
  return code;
}

function cleanRule(sourceInput: string, replacementInput: string) {
  const source = normalizeRuleSource(sourceInput);
  const replacement = replacementInput.replace(/\s+/g, " ").trim();
  if (!source || !replacement) {
    throw new DomainError("invalid_rule", "A rule needs both a misheard phrase and a replacement.");
  }
  if (replacement === source) {
    throw new DomainError("invalid_rule", "The replacement is the same as the misheard phrase.");
  }
  return { source, replacement };
}

export async function saveTranscriptRule(
  db: AppDb,
  input: {
    duoId: string;
    playerId: string;
    source: string;
    replacement: string;
    countryCode?: string | null;
    enabled?: boolean;
  },
) {
  const { source, replacement } = cleanRule(input.source, input.replacement);
  const countryCode = cleanCountry(input.countryCode);
  const enabled = input.enabled ?? true;
  await db
    .insert(transcriptRules)
    .values({
      id: uuidv7(),
      duoId: input.duoId,
      source,
      replacement,
      countryCode,
      enabled,
      createdByPlayerId: input.playerId,
    })
    .onConflictDoUpdate({
      target: [transcriptRules.duoId, transcriptRules.source, transcriptRules.countryCode],
      set: { replacement, enabled, updatedAt: new Date() },
    });
  return { source, replacement, countryCode: countryCode || null, enabled };
}

/** Removes a custom rule. A starter rule returns to its default instead. */
export async function deleteTranscriptRule(
  db: AppDb,
  duoId: string,
  sourceInput: string,
  countryCodeInput?: string | null,
) {
  await db
    .delete(transcriptRules)
    .where(
      and(
        eq(transcriptRules.duoId, duoId),
        eq(transcriptRules.source, normalizeRuleSource(sourceInput)),
        eq(transcriptRules.countryCode, cleanCountry(countryCodeInput)),
      ),
    );
}

/**
 * Saves one-off fixes all or nothing. Repeating the same fix is safe; a fix that disagrees with
 * or overlaps an existing one is rejected rather than silently dropped.
 */
export async function applySuggestionOnce(
  db: AppDb,
  input: {
    duoId: string;
    playerId: string;
    replacement: string;
    occurrences: SuggestionOccurrence[];
  },
) {
  const replacement = input.replacement.replace(/\s+/g, " ").trim();
  if (!replacement) throw new DomainError("invalid_edit", "A replacement is required.");
  const seenSpans = new Set<string>();
  const occurrences = input.occurrences.filter((o) => {
    const key = `${o.utteranceId}:${o.charStart}:${o.charEnd}:${o.originalText}`;
    if (seenSpans.has(key)) return false;
    seenSpans.add(key);
    return true;
  });
  const ids = [...new Set(occurrences.map((o) => o.utteranceId))];
  if (ids.length === 0) return { applied: 0 };
  const overlapsInBatch = occurrences.some((a, i) =>
    occurrences
      .slice(i + 1)
      .some(
        (b) =>
          a.utteranceId === b.utteranceId && a.charStart < b.charEnd && b.charStart < a.charEnd,
      ),
  );
  if (overlapsInBatch) {
    throw new DomainError("edit_conflict", "These fixes overlap each other.", 409);
  }

  return db.transaction(async (tx) => {
    // Locks in a fixed order, so concurrent fixes on one Utterance run one at a time.
    const rows = await tx
      .select({
        id: utterances.id,
        text: utterances.text,
        recordingId: utterances.recordingId,
        transcriptVersionId: utterances.transcriptVersionId,
      })
      .from(utterances)
      .where(and(inArray(utterances.id, ids), speechInDuo(input.duoId)))
      .orderBy(utterances.id)
      .for("update");
    const current = await currentVersionIds(
      tx as unknown as AppDb,
      input.duoId,
      [...new Set(rows.map((r) => r.recordingId))],
    );
    const textById = new Map(
      rows.filter((r) => current.has(r.transcriptVersionId)).map((r) => [r.id, r.text]),
    );
    const valid = occurrences.filter((o) => {
      const text = textById.get(o.utteranceId);
      return (
        text !== undefined &&
        o.charStart >= 0 &&
        o.charStart < o.charEnd &&
        o.charEnd <= text.length &&
        text.slice(o.charStart, o.charEnd) === o.originalText
      );
    });
    if (valid.length < occurrences.length) {
      throw new DomainError(
        "stale_edit",
        "That text has changed. Rescan and try again.",
        409,
      );
    }

    const existing = await tx.query.utteranceEdits.findMany({
      where: and(
        eq(utteranceEdits.duoId, input.duoId),
        inArray(
          utteranceEdits.utteranceId,
          valid.map((o) => o.utteranceId),
        ),
      ),
    });
    const conflict = (o: SuggestionOccurrence) =>
      existing.some(
        (e) =>
          e.utteranceId === o.utteranceId &&
          e.charStart < o.charEnd &&
          o.charStart < e.charEnd &&
          !(e.charStart === o.charStart && e.charEnd === o.charEnd && e.replacement === replacement),
      );
    if (valid.some(conflict)) {
      throw new DomainError(
        "edit_conflict",
        "That text already has a different fix. Undo it first.",
        409,
      );
    }

    const inserted = await tx
      .insert(utteranceEdits)
      .values(
        valid.map((o) => ({
          id: uuidv7(),
          duoId: input.duoId,
          utteranceId: o.utteranceId,
          charStart: o.charStart,
          charEnd: o.charEnd,
          originalText: o.originalText,
          replacement,
          createdByPlayerId: input.playerId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: utteranceEdits.id, utteranceId: utteranceEdits.utteranceId });

    if (inserted.length < valid.length) {
      const after = await tx.query.utteranceEdits.findMany({
        where: inArray(
          utteranceEdits.utteranceId,
          valid.map((o) => o.utteranceId),
        ),
      });
      const raced = valid.some(
        (o) =>
          !after.some(
            (e) =>
              e.utteranceId === o.utteranceId &&
              e.charStart === o.charStart &&
              e.charEnd === o.charEnd &&
              e.replacement === replacement,
          ),
      );
      if (raced) {
        throw new DomainError(
          "edit_conflict",
          "That text already has a different fix. Undo it first.",
          409,
        );
      }
    }
    return { applied: inserted.length };
  });
}

/** The countries of the one Round this speech belongs to, or none when that is unclear. */
async function utteranceRoundCountries(
  db: AppDb,
  duoId: string,
  u: CorrectableUtterance & { recordingId: string },
): Promise<string[]> {
  const span = speechSpanMs(u);
  if (!span) return [];
  const [recording] = await db
    .select({ isCalibrated: recordings.isCalibrated })
    .from(recordings)
    .where(and(eq(recordings.id, u.recordingId), recordingInDuo(duoId)))
    .limit(1);
  if (!recording?.isCalibrated) return [];
  const roundRows = indexRows(
    await loadRoundsInSpan(
      db,
      duoId,
      {
        startedAt: new Date(span.firstMs - ROUND_BOUNDARY_MARGIN_MS),
        endedAt: new Date(span.lastMs + ROUND_BOUNDARY_MARGIN_MS),
      },
      "full",
    ),
  );
  return soleRound(buildRoundIndex(roundRows), span.firstMs, span.lastMs)?.countryCodes ?? [];
}

/** Fixes a phrase in one Utterance, or saves it as a rule. Text is matched against the raw words. */
export async function fixUtterance(
  db: AppDb,
  input: {
    duoId: string;
    playerId: string;
    utteranceId: string;
    find: string;
    replacement: string;
    scope: "once" | "always" | "country";
    countryCode?: string | null;
  },
) {
  const [row] = await db
    .select()
    .from(utterances)
    .where(and(eq(utterances.id, input.utteranceId), speechInDuo(input.duoId)))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Utterance not found", 404);
  const current = await currentVersionIds(db, input.duoId, [row.recordingId]);
  if (!current.has(row.transcriptVersionId)) {
    throw new DomainError("stale_edit", "That text has changed. Rescan and try again.", 409);
  }
  const find = input.find.trim();
  const charStart = row.text.indexOf(find);
  if (!find || charStart < 0) {
    throw new DomainError("invalid_edit", "That text is not in what Whisper heard.");
  }

  if (input.scope !== "once") {
    if (input.scope === "country" && !cleanCountry(input.countryCode)) {
      throw new DomainError("invalid_rule", "Choose a country for this rule.");
    }
    const rule = cleanRule(find, input.replacement);
    const ruleSpans = applyCorrections(row.text, [rule]).spans;
    if (ruleSpans.length === 0) {
      throw new DomainError(
        "invalid_rule",
        "A rule needs whole words from what Whisper heard, and a different replacement.",
      );
    }
    const countryCode = input.scope === "country" ? cleanCountry(input.countryCode) : "";
    const [countries, existing, edits] = await Promise.all([
      utteranceRoundCountries(db, input.duoId, row),
      listTranscriptRules(db, input.duoId),
      db.query.utteranceEdits.findMany({
        where: eq(utteranceEdits.utteranceId, row.id),
        orderBy: [desc(utteranceEdits.createdAt), desc(utteranceEdits.id)],
      }),
    ]);
    const others = existing.filter(
      (r) => r.enabled && !(r.source === rule.source && (r.countryCode ?? "") === countryCode),
    );
    const effective = applyCorrections(
      row.text,
      selectRulesForCountries([...others, { ...rule, countryCode: countryCode || null }], countries),
      edits,
    );
    const takesEffect = effective.spans.some(
      (s) =>
        s.replacement === rule.replacement &&
        ruleSpans.some((r) => r.rawStart === s.rawStart && r.rawEnd === s.rawEnd),
    );
    if (!takesEffect) {
      throw new DomainError(
        "rule_not_applicable",
        "That rule would not change this line: its Round is unclear, or another rule or one-off fix applies.",
        409,
      );
    }
    await saveTranscriptRule(db, {
      duoId: input.duoId,
      playerId: input.playerId,
      source: find,
      replacement: input.replacement,
      countryCode: input.scope === "country" ? input.countryCode : null,
    });
    return { applied: 1 };
  }

  if (row.text.indexOf(find, charStart + 1) >= 0) {
    throw new DomainError(
      "ambiguous_edit",
      "That text appears more than once here. Include a neighboring word.",
      409,
    );
  }
  return applySuggestionOnce(db, {
    duoId: input.duoId,
    playerId: input.playerId,
    replacement: input.replacement,
    occurrences: [
      {
        utteranceId: row.id,
        charStart,
        charEnd: charStart + find.length,
        originalText: find,
      },
    ],
  });
}

export async function deleteUtteranceEdit(db: AppDb, duoId: string, editId: string) {
  await db
    .delete(utteranceEdits)
    .where(and(eq(utteranceEdits.id, editId), eq(utteranceEdits.duoId, duoId)));
}

export async function dismissSuggestion(
  db: AppDb,
  input: { duoId: string; source: string; replacement: string },
) {
  await db
    .insert(transcriptSuggestionDismissals)
    .values({
      duoId: input.duoId,
      source: normalizeRuleSource(input.source),
      replacement: input.replacement.trim(),
    })
    .onConflictDoNothing();
}

/** One-off fixes on current Transcripts, newest first. `total` supports loading more. */
export async function listUtteranceEdits(
  db: AppDb,
  duoId: string,
  limit: number = DEFAULT_EDIT_PAGE,
): Promise<{ edits: UtteranceEditView[]; total: number }> {
  const [rows, current] = await Promise.all([
    db
      .select({
        id: utteranceEdits.id,
        utteranceId: utteranceEdits.utteranceId,
        originalText: utteranceEdits.originalText,
        replacement: utteranceEdits.replacement,
        context: utterances.text,
        transcriptVersionId: utterances.transcriptVersionId,
      })
      .from(utteranceEdits)
      .innerJoin(utterances, eq(utterances.id, utteranceEdits.utteranceId))
      .where(and(eq(utteranceEdits.duoId, duoId), speechInDuo(duoId)))
      .orderBy(desc(utteranceEdits.createdAt), desc(utteranceEdits.id)),
    currentVersionIds(db, duoId),
  ]);
  const live = rows.filter((r) => current.has(r.transcriptVersionId));
  return {
    edits: live.slice(0, limit).map(({ transcriptVersionId: _version, ...edit }) => edit),
    total: live.length,
  };
}

/**
 * Computes Region suggestions from recent current Transcripts. A word span is only used when its
 * Recording is calibrated and it sits inside exactly one Round, even allowing for clock error.
 */
export async function listTranscriptSuggestions(
  db: AppDb,
  duoId: string,
): Promise<TranscriptSuggestionView[]> {
  const recs = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(and(recordingInDuo(duoId), eq(recordings.isCalibrated, true)))
    .orderBy(desc(recordings.startedAt))
    .limit(SUGGESTION_RECORDING_LIMIT);
  if (recs.length === 0) return [];

  const versions = await currentVersionIds(
    db,
    duoId,
    recs.map((r) => r.id),
  );
  if (versions.size === 0) return [];

  const rows = await db
    .select({
      id: utterances.id,
      recordingId: utterances.recordingId,
      text: utterances.text,
      words: utterances.words,
      startSampleMs: utterances.startSampleMs,
      startedAt: utterances.startedAt,
      endedAt: utterances.endedAt,
    })
    .from(utterances)
    .where(and(inArray(utterances.transcriptVersionId, [...versions]), speechInDuo(duoId)))
    .orderBy(desc(utterances.startedAt))
    .limit(SUGGESTION_UTTERANCE_LIMIT);

  // Bound Rounds by when this speech actually happened, after clock offsets.
  const spans = rows.map(speechSpanMs).filter((s) => s !== null);
  if (spans.length === 0) return [];
  let earliest = Infinity;
  let latest = -Infinity;
  for (const s of spans) {
    earliest = Math.min(earliest, s.firstMs);
    latest = Math.max(latest, s.lastMs);
  }

  const [roundRows, dismissed, correct] = await Promise.all([
    loadRoundsInSpan(
      db,
      duoId,
      {
        startedAt: new Date(earliest - ROUND_BOUNDARY_MARGIN_MS),
        endedAt: new Date(latest + ROUND_BOUNDARY_MARGIN_MS),
      },
      "full",
    ).then(indexRows),
    db.query.transcriptSuggestionDismissals.findMany({
      where: eq(transcriptSuggestionDismissals.duoId, duoId),
    }),
    loadTranscriptCorrector(db, duoId),
  ]);
  if (roundRows.length === 0) return [];

  const dismissedKeys = new Set(dismissed.map((d) => `${d.source}\u0000${d.replacement}`));
  const roundIndex = buildRoundIndex(roundRows);
  const commonWords = commonEnglishWords();

  const groups = new Map<string, TranscriptSuggestionView>();
  for (const u of rows) {
    if (u.words.length === 0) continue;
    const span = speechSpanMs(u);
    const round = span ? soleRound(roundIndex, span.firstMs, span.lastMs) : null;
    if (!round) continue;

    const corrected = correct(u);
    const found = findRegionSuggestions({
      text: u.text,
      words: u.words,
      countryCodes: round.countryCodes,
      blockedRanges: corrected.spans
        .filter((s) => s.origin === "manual")
        .map((s) => ({ start: s.rawStart, end: s.rawEnd })),
      ruledRanges: corrected.matched,
      commonWords,
    });
    for (const s of found) {
      const source = normalizeRuleSource(s.originalText);
      const dismissKey = `${source}\u0000${s.replacement}`;
      if (dismissedKeys.has(dismissKey)) continue;
      const countryCode = s.regionCode.split("-")[0]!;
      const key = `${dismissKey}\u0000${countryCode}`;
      const group = groups.get(key) ?? {
        source,
        replacement: s.replacement,
        countryCode,
        score: s.score,
        count: 0,
        example: u.text,
        occurrences: [],
      };
      group.count += 1;
      group.score = Math.max(group.score, s.score);
      if (group.occurrences.length < MAX_OCCURRENCES_PER_SUGGESTION) {
        group.occurrences.push({
          utteranceId: u.id,
          charStart: s.charStart,
          charEnd: s.charEnd,
          originalText: s.originalText,
        });
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.score - a.score);
}
