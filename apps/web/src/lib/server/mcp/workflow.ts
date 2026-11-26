import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import {
  callLabelInputSchema,
  claimDeleteInputSchema,
  claimEditItemInputSchema,
  claimItemInputSchema,
  gameBounds,
  gameOverlaps,
  hedgeKind,
  intervalsOverlap,
  isLearningRunPurpose,
  isMissingTime,
  roundWindowsById,
  learningItemInputSchema,
  roundCluesItemInputSchema,
  regionName,
  roundHedge,
  type DerivedGuess,
  type InstructionPurpose,
  type ProcessingRunPurpose,
  type SearchClaimsInput,
  type SourceKind,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  duoMemberships,
  duos,
  games,
  learnings,
  players,
  processingRuns,
  recordings,
  rounds,
  sessions,
  sourceVersions,
  sources,
  utterances,
} from "../db/schema.js";
import {
  DomainError,
  findScopedRun,
  loadRoundsInSpan,
  recordingInDuo,
  roundInDuo,
  speechInDuo,
  addSourceImage,
  addSourceVersion,
  deriveClaims,
  deriveCurrentCallLabels,
  deriveLearningsWithStatus,
  duoClaimIds,
  filterClaims,
  insertClaim,
  insertEvidence,
  listSources,
  summarizeEvidence,
  type DerivedClaim,
  type NewEvidence,
  claimEvidenceFacts,
  deleteClaimsById,
  updateClaim,
  deriveSessionWorkRanges,
  finishProcessingRun,
  getCurrentTranscriptVersionIds,
  insertRunCallLabels,
  insertRunRoundClues,
  clueResolver,
  deriveCurrentRoundClues,
  listDuoClues,
  seedDuoClues,
  insertRunLearnings,
  isCallableRound,
  queueTaggingOfChangedClaims,
  loadTranscriptCorrector,
  resolveDocumentationCitation,
  roundGuessingInterval,
  startProcessingRun,
} from "../services/index.js";
import { duoEventBus } from "../events/bus.js";
import { getCurrentPromptVersion, loadClueVocabulary, loadPromptInstructions } from "./prompts.js";

const CONTEXT_PADDING_MS = 2 * 60 * 1000;
const MAX_RANGE_TOKENS = 25_000;
const LOW_CONF_LOGPROB = Number(process.env.LOW_CONFIDENCE_LOGPROB ?? -0.7);
const LOW_CONF_NOSPEECH = Number(process.env.LOW_CONFIDENCE_NOSPEECH ?? 0.6);

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function formatHmsUtc(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export async function resolveDuoForPlayer(
  db: AppDb,
  playerId: string,
  duoSelector?: string,
): Promise<{ id: string; name: string }> {
  const memberships = await db.query.duoMemberships.findMany({
    where: eq(duoMemberships.playerId, playerId),
  });
  if (memberships.length === 0) {
    throw new DomainError("FORBIDDEN", "Player does not belong to any Duo", 403);
  }
  const duoIds = memberships.map((m) => m.duoId);
  const playerDuos = await db.query.duos.findMany({
    where: inArray(duos.id, duoIds),
  });

  if (duoSelector) {
    const match = playerDuos.find(
      (d) =>
        d.id === duoSelector ||
        d.name.toLowerCase() === duoSelector.trim().toLowerCase(),
    );
    if (!match) {
      throw new DomainError("NOT_FOUND", `Duo "${duoSelector}" not found for this Player`, 404);
    }
    return { id: match.id, name: match.name };
  }

  if (playerDuos.length === 1) {
    return { id: playerDuos[0]!.id, name: playerDuos[0]!.name };
  }

  throw new DomainError(
    "AMBIGUOUS_DUO",
    `Player belongs to multiple Duos (${playerDuos.map((d) => `${d.name} [${d.id}]`).join(", ")}); pass the "duo" argument.`,
    400,
  );
}

async function loadCurrentSessionUtterances(
  db: AppDb,
  duoId: string,
  sessionId: string,
  startUtc: Date,
  endUtc: Date,
) {
  const recs = await db
    .select()
    .from(recordings)
    .where(and(recordingInDuo(duoId), eq(recordings.sessionId, sessionId)));
  const currentVersionIds = [
    ...(
      await getCurrentTranscriptVersionIds(
        db,
        recs.map((r) => r.id),
      )
    ).values(),
  ];
  if (currentVersionIds.length === 0) return [];

  return db.query.utterances.findMany({
    where: and(
      inArray(utterances.transcriptVersionId, currentVersionIds),
      speechInDuo(duoId),
      lt(utterances.startedAt, endUtc),
      gt(utterances.endedAt, startUtc),
    ),
    orderBy: [asc(utterances.startedAt), asc(utterances.id)],
  });
}

export async function mcpGetInstructions(purpose: InstructionPurpose) {
  return loadPromptInstructions(purpose);
}

/**
 * Lists unprocessed or stale ranges for a Duo & purpose, cut at between-Game gaps
 * and capped at ~25k tokens each.
 */
export async function mcpListWork(
  db: AppDb,
  playerId: string,
  input: { purpose: ProcessingRunPurpose; duo?: string },
) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  const allSessions = await db.query.sessions.findMany({
    where: eq(sessions.duoId, duo.id),
    orderBy: [asc(sessions.createdAt)],
  });

  // Work splitting uses relationship bounds (#56 1a-derivation): a recovered Game keeps its cut points.
  const duoRoundRows = await db.select().from(rounds).where(roundInDuo(duo.id));
  const roundsOfGame = new Map<string, (typeof duoRoundRows)[number][]>();
  for (const r of duoRoundRows) roundsOfGame.set(r.gameId, [...(roundsOfGame.get(r.gameId) ?? []), r]);
  const duoGames = [...roundsOfGame.values()]
    .flatMap((rs) => {
      const rel = gameBounds(rs).relationship;
      return rel && !isMissingTime(rel.startedAt) ? [{ startedAt: rel.startedAt, endedAt: rel.endedAt }] : [];
    })
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const ranges: Array<{
    sessionId: string;
    purpose: ProcessingRunPurpose;
    startUtc: string;
    endUtc: string;
    reason: "unprocessed" | "stale";
    estimatedTokens: number;
  }> = [];

  for (const ses of allSessions) {
    const rawWork = await deriveSessionWorkRanges(db, duo.id, ses.id, input.purpose);
    for (const w of rawWork) {
      const us = await loadCurrentSessionUtterances(db, duo.id, ses.id, w.startUtc, w.endUtc);
      const totalTokens = us.reduce((sum, u) => sum + estimateTokens(u.text) + 12, 0);

      if (totalTokens <= MAX_RANGE_TOKENS) {
        ranges.push({
          sessionId: ses.id,
          purpose: input.purpose,
          startUtc: w.startUtc.toISOString(),
          endUtc: w.endUtc.toISOString(),
          reason: w.reason,
          estimatedTokens: totalTokens,
        });
        continue;
      }

      // Split at between-Game gaps so each chunk stays <= ~25k tokens
      const overlappingGames = duoGames.filter((g) =>
        gameOverlaps(g, { startedAt: w.startUtc, endedAt: w.endUtc }),
      );
      const cutPoints: number[] = [];
      for (let i = 0; i < overlappingGames.length - 1; i++) {
        const gapMid = Math.floor(
          (overlappingGames[i]!.endedAt.getTime() + overlappingGames[i + 1]!.startedAt.getTime()) /
            2,
        );
        if (gapMid > w.startUtc.getTime() && gapMid < w.endUtc.getTime()) {
          cutPoints.push(gapMid);
        }
      }

      let chunkStart = w.startUtc.getTime();
      let accTokens = 0;
      let lastCut = chunkStart;
      for (const u of us) {
        const t = estimateTokens(u.text) + 12;
        const uMs = u.startedAt.getTime();
        const availableCut = cutPoints.find((c) => c > lastCut && c <= uMs);
        if (availableCut) lastCut = availableCut;

        if (accTokens + t > MAX_RANGE_TOKENS && uMs > chunkStart) {
          const splitAt = lastCut > chunkStart ? lastCut : uMs;
          ranges.push({
            sessionId: ses.id,
            purpose: input.purpose,
            startUtc: new Date(chunkStart).toISOString(),
            endUtc: new Date(splitAt).toISOString(),
            reason: w.reason,
            estimatedTokens: accTokens,
          });
          chunkStart = splitAt;
          accTokens = t;
        } else {
          accTokens += t;
        }
      }
      if (chunkStart < w.endUtc.getTime()) {
        ranges.push({
          sessionId: ses.id,
          purpose: input.purpose,
          startUtc: new Date(chunkStart).toISOString(),
          endUtc: w.endUtc.toISOString(),
          reason: w.reason,
          estimatedTokens: accTokens,
        });
      }
    }
  }

  return { duo, ranges };
}

export async function mcpStartRun(
  db: AppDb,
  playerId: string,
  input: {
    sessionId: string;
    startUtc: string;
    endUtc: string;
    purpose: ProcessingRunPurpose;
    agent: string;
    model: string;
    duo?: string;
  },
) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  const promptVersion = getCurrentPromptVersion(input.purpose);

  const run = await startProcessingRun(db, {
    duoId: duo.id,
    sessionId: input.sessionId,
    startedByPlayerId: playerId,
    purpose: input.purpose,
    agent: input.agent,
    model: input.model,
    promptVersion,
    rangeStart: new Date(input.startUtc),
    rangeEnd: new Date(input.endUtc),
  });

  return {
    runId: run.id,
    duoId: duo.id,
    sessionId: run.sessionId,
    purpose: run.purpose,
    promptVersion: run.promptVersion,
    startUtc: run.rangeStart.toISOString(),
    endUtc: run.rangeEnd.toISOString(),
  };
}

/**
 * Computes deterministic `u1..uN` ref map for a run's in-range Utterances.
 */
async function getRunInRangeUtterances(
  db: AppDb,
  run: typeof processingRuns.$inferSelect,
) {
  const inRange = await loadCurrentSessionUtterances(
    db,
    run.duoId,
    run.sessionId,
    run.rangeStart,
    run.rangeEnd,
  );
  const refToUtterance = new Map<string, (typeof inRange)[number]>();
  const utteranceToRef = new Map<string, string>();
  inRange.forEach((u, idx) => {
    const ref = `u${idx + 1}`;
    refToUtterance.set(ref, u);
    utteranceToRef.set(u.id, ref);
  });
  return { inRange, refToUtterance, utteranceToRef };
}

export async function mcpReadRange(db: AppDb, playerId: string, runId: string) {
  const run = await findScopedRun(db, runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  if (run.purpose === "calls") {
    return readCallsRange(db, run);
  }
  if (run.purpose === "clues") {
    return readCluesRange(db, run);
  }

  const padStart = new Date(run.rangeStart.getTime() - CONTEXT_PADDING_MS);
  const padEnd = new Date(run.rangeEnd.getTime() + CONTEXT_PADDING_MS);

  const [{ inRange, utteranceToRef }, paddedUtterances, allPlayers, duoGames, duoLearnings, duoClaims] =
    await Promise.all([
      getRunInRangeUtterances(db, run),
      loadCurrentSessionUtterances(db, run.duoId, run.sessionId, padStart, padEnd),
      db.query.players.findMany(),
      // A Game is admitted through its valid Rounds' Full windows, never a startedAt/endedAt prefilter (an epoch
      // start would wrongly admit or miss it); Session attribution and rating are unchanged.
      loadRoundsInSpan(db, run.duoId, { startedAt: padStart, endedAt: padEnd }, "full").then(async (rs) => {
        const ids = [...new Set(rs.map((x) => x.round.gameId))];
        return ids.length > 0
          ? db.query.games.findMany({ where: inArray(games.id, ids), orderBy: [asc(games.startedAt)] })
          : [];
      }),
      deriveLearningsWithStatus(db, run.duoId),
      deriveClaims(db, run.duoId),
    ]);

  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.displayName]));
  const gameIds = duoGames.map((g) => g.id);
  const gameRounds =
    gameIds.length > 0
      ? await db.query.rounds.findMany({
          where: inArray(rounds.gameId, gameIds),
          orderBy: [asc(rounds.startTime)],
        })
      : [];

  const roundsByGameIdForMarkers = new Map<string, typeof gameRounds>();
  for (const r of gameRounds) roundsByGameIdForMarkers.set(r.gameId, [...(roundsByGameIdForMarkers.get(r.gameId) ?? []), r]);

  // Build chronological timeline mixing Round markers and Utterances
  type LineEvent = { ts: number; order: number; line: string };
  const timeline: LineEvent[] = [];

  for (const g of duoGames) {
    const ratingStr =
      g.duoRatingBefore !== null && g.duoRatingAfter !== null
        ? ` | Rating ${g.duoRatingBefore}→${g.duoRatingAfter}`
        : "";
    const outcome = g.won === true ? "WIN" : g.won === false ? "LOSS" : "FINISHED";
    const gameStart = gameBounds(roundsByGameIdForMarkers.get(g.id) ?? []).relationship?.startedAt ?? g.startedAt;
    timeline.push({
      ts: gameStart.getTime(),
      order: 0,
      line: `=== GAME ${g.geoguessrGameId} (${outcome}${ratingStr}, HP ${g.duoFinalHealth ?? "?"} vs ${g.opponentFinalHealth ?? "?"}) ===`,
    });
  }

  // Compute running team health per Round within each Game for Round markers
  const roundsByGameId = new Map<string, typeof gameRounds>();
  for (const r of gameRounds) {
    const list = roundsByGameId.get(r.gameId) ?? [];
    list.push(r);
    roundsByGameId.set(r.gameId, list);
  }

  for (const g of duoGames) {
    const gRounds = [...(roundsByGameId.get(g.id) ?? [])].sort(
      (a, b) => a.roundNumber - b.roundNumber,
    );
    let duoHp = 6000;
    let oppHp = 6000;
    for (const r of gRounds) {
      if (r.hpDelta < 0) duoHp = Math.max(0, duoHp + r.hpDelta);
      else if (r.hpDelta > 0) oppHp = Math.max(0, oppHp - r.hpDelta);
      const guessParts = r.guesses
        .filter((gr) => gr.isDuo)
        .map((gr) => {
          const who = gr.playerId
            ? (playerNameById.get(gr.playerId) ?? gr.nick ?? "Duo")
            : (gr.nick ?? "Duo");
          const km =
            gr.distanceMeters !== null ? `${Math.round(gr.distanceMeters / 1000)}km` : "?km";
          const where = gr.countryCode ?? (gr.lat !== null ? "water" : "?");
          const guessRegion = regionName(gr.regionCode);
          return `${who}:${where}${guessRegion ? ` ${guessRegion}` : ""}(${km},${gr.score}pt)`;
        })
        .join(", ");
      const region = regionName(r.regionCode);
      const regionPart = region ? ` / ${region}` : "";
      // HP accumulates over every Round from the Game's start; a Round with no start time has no marker.
      if (isMissingTime(r.startTime)) continue;
      timeline.push({
        ts: r.startTime.getTime(),
        order: 1,
        line: `--- Round ${r.roundNumber} [roundId=${r.id}] | True: ${r.countryCode ?? "?"}${regionPart} | Guesses: ${guessParts || "none"} | Score: ${r.duoBestScore} vs ${r.opponentBestScore} (HP ${r.hpDelta >= 0 ? "+" : ""}${r.hpDelta}, x${r.damageMultiplier} -> Duo ${duoHp} / Opp ${oppHp}) ---`,
      });
    }
  }

  const correctTranscript = await loadTranscriptCorrector(db, run.duoId);
  for (const u of paddedUtterances) {
    const text = correctTranscript(u).text;
    const ref = utteranceToRef.get(u.id);
    const speaker = playerNameById.get(u.playerId) ?? "Player";
    const lowConf =
      (u.avgLogprob !== null && u.avgLogprob < LOW_CONF_LOGPROB) ||
      (u.noSpeechProb !== null && u.noSpeechProb > LOW_CONF_NOSPEECH);
    const marker = lowConf ? " (?)" : "";
    const ts = formatHmsUtc(u.startedAt);
    const line = ref
      ? `[${ts}] ${ref} ${speaker}: ${text}${marker}`
      : `[${ts}] (context) ${speaker}: ${text}${marker}`;
    timeline.push({ ts: u.startedAt.getTime(), order: 2, line });
  }

  timeline.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.order - b.order));

  // Current Learnings already overlapping this range (with reactions)
  const existingInRange = duoLearnings
    .filter(
      (l) =>
        l.status === "current" &&
        l.sourceSpanStart &&
        l.sourceSpanEnd &&
        intervalsOverlap(
          { startedAt: l.sourceSpanStart, endedAt: l.sourceSpanEnd },
          { startedAt: run.rangeStart, endedAt: run.rangeEnd },
        ),
    )
    .map((l) => ({
      id: l.id,
      purpose: l.purpose,
      kind: l.kind,
      origin: l.origin,
      text: l.text,
      countries: l.countries,
      topics: l.topics,
      claimId: l.claimId,
      reactions: l.reactions.map((r) => `${r.reaction}(${playerNameById.get(r.playerId) ?? r.playerId})`),
    }));

  // The Duo's Claims about every country the range's Rounds were in or guessed in
  const rangeCountries = new Set<string>();
  const fullWindows = roundWindowsById(gameRounds);
  for (const r of gameRounds) {
    const full = fullWindows.get(r.id)?.full;
    if (!full || !intervalsOverlap(full, { startedAt: run.rangeStart, endedAt: run.rangeEnd })) {
      continue;
    }
    if (r.countryCode) rangeCountries.add(r.countryCode.toUpperCase());
    for (const g of r.guesses) {
      if (g.isDuo && g.countryCode) rangeCountries.add(g.countryCode.toUpperCase());
    }
  }
  const rangeClaims = filterClaims(duoClaims, { countries: [...rangeCountries] }).map(describeClaim);

  // Active topic tags across the Duo
  const topicSet = new Set<string>();
  for (const l of duoLearnings) {
    if (l.status === "current") {
      for (const t of l.topics) topicSet.add(t);
    }
  }

  return {
    runId: run.id,
    purpose: run.purpose,
    rangeStart: run.rangeStart.toISOString(),
    rangeEnd: run.rangeEnd.toISOString(),
    citableUtteranceCount: inRange.length,
    transcript: timeline.map((t) => t.line).join("\n"),
    existingLearnings: existingInRange,
    existingTopics: [...topicSet].sort(),
    claimCountries: [...rangeCountries].sort(),
    claims: rangeClaims,
  };
}

/** A Claim as agents see it: derived status and an Evidence tally, never just the text. */
function describeClaim(c: DerivedClaim) {
  return {
    id: c.id,
    status: c.status,
    text: c.text,
    countries: c.countries,
    regions: c.regions,
    topics: c.topics,
    evidence: summarizeEvidence(c.evidence),
    learningCount: c.learningIds.length,
  };
}

const MAX_SEARCH_RESULTS = 100;

/** `search_claims`: the Duo's Claims matching text, countries, topics and status. */
export async function mcpSearchClaims(
  db: AppDb,
  playerId: string,
  input: SearchClaimsInput & { duo?: string },
) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  const matches = filterClaims(await deriveClaims(db, duo.id), input);
  return {
    duo,
    total: matches.length,
    claims: matches.slice(0, MAX_SEARCH_RESULTS).map(describeClaim),
  };
}

/**
 * `add_claims`: creates Claims and/or adds Evidence to existing ones. Inside a
 * run (`runId`) new Claims are attributed to it and may cite Rounds in its
 * range; without one (ingestion) only Documentation Evidence applies. Invalid
 * items are reported and the rest saved.
 */
export async function mcpAddClaims(
  db: AppDb,
  playerId: string,
  input: { runId?: string; duo?: string; items: unknown[] },
) {
  let run: RunRow | null = null;
  let duoId: string;
  if (input.runId) {
    run =
      await findScopedRun(db, input.runId);
    if (!run) throw new DomainError("NOT_FOUND", "Processing run not found", 404);
    await resolveDuoForPlayer(db, playerId, run.duoId);
    if (run.status !== "open") {
      throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
    }
    if (!isLearningRunPurpose(run.purpose)) {
      throw new DomainError("WRONG_PURPOSE", `A ${run.purpose} Processing run doesn't make Claims`, 400);
    }
    duoId = run.duoId;
  } else {
    duoId = (await resolveDuoForPlayer(db, playerId, input.duo)).id;
  }

  const rangeRoundIds = new Set(run ? (await loadRunRounds(db, run)).map((r) => r.id) : []);
  const parsedItems = input.items.map((raw) => claimItemInputSchema.safeParse(raw));
  const knownClaimIds = await duoClaimIds(
    db,
    duoId,
    parsedItems.flatMap((p) => (p.success && p.data.claimId ? [p.data.claimId] : [])),
  );

  const saved: Array<{ index: number; claimId: string; created: boolean; evidenceAdded: number }> = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < parsedItems.length; i++) {
    const parsed = parsedItems[i]!;
    if (!parsed.success) {
      errors.push({
        index: i,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; "),
      });
      continue;
    }
    const item = parsed.data;
    if (item.claimId && !knownClaimIds.has(item.claimId)) {
      errors.push({ index: i, message: `Unknown or other Duo's claimId: ${item.claimId}` });
      continue;
    }

    const evidence: NewEvidence[] = [];
    const problems: string[] = [];
    for (const e of item.evidence) {
      if (e.kind === "round") {
        if (!run) {
          problems.push(`Round Evidence needs a runId: Round ${e.roundId} must be inside the run's range`);
        } else if (!rangeRoundIds.has(e.roundId)) {
          problems.push(`Round ${e.roundId} is not inside this run's range`);
        } else {
          evidence.push({ kind: "round", direction: "for", roundId: e.roundId, note: e.note });
        }
      } else {
        const resolved = await resolveDocumentationCitation(db, duoId, e);
        if ("error" in resolved) {
          problems.push(resolved.error);
        } else {
          evidence.push({
            kind: "documentation",
            direction: e.direction,
            sourceVersionId: e.sourceVersionId,
            sectionAnchor: e.section,
            imageIds: resolved.imageIds,
            note: e.note,
          });
        }
      }
    }
    if (problems.length > 0) {
      errors.push({ index: i, message: problems.join("; ") });
      continue;
    }

    const claimId =
      item.claimId ??
      (await insertClaim(db, {
        duoId,
        runId: run?.id ?? null,
        createdByPlayerId: playerId,
        text: item.text!,
        countries: item.countries,
        regions: item.regions,
        topics: item.topics,
      }));
    const added = await insertEvidence(db, claimId, duoId, run?.id ?? null, evidence);
    saved.push({ index: i, claimId, created: !item.claimId, evidenceAdded: added.length });
  }

  if (saved.length > 0) duoEventBus.emitChanged(duoId, "claim");
  await queueTaggingOfChangedClaims(db, playerId, duoId, saved.filter((x) => x.created).length);
  return { savedCount: saved.length, saved, errors };
}

/**
 * `edit_claims`: changes the wording, countries, regions or topics of existing
 * Claims. Evidence is untouched. Changing `text` on a Claim a Player or a Round
 * has confirmed needs `force`, since that Evidence vouched for the old wording.
 * Invalid items are reported and the rest saved.
 */
export async function mcpEditClaims(
  db: AppDb,
  playerId: string,
  input: { duo?: string; items: unknown[] },
) {
  const duoId = (await resolveDuoForPlayer(db, playerId, input.duo)).id;
  const parsedItems = input.items.map((raw) => claimEditItemInputSchema.safeParse(raw));
  const ids = parsedItems.flatMap((p) => (p.success ? [p.data.claimId] : []));
  const existing = new Map(
    (await deriveClaims(db, duoId)).filter((c) => ids.includes(c.id)).map((c) => [c.id, c]),
  );
  const facts = await claimEvidenceFacts(db, duoId, [...existing.keys()]);

  const saved: Array<{ index: number; claimId: string; changed: string[] }> = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < parsedItems.length; i++) {
    const parsed = parsedItems[i]!;
    if (!parsed.success) {
      errors.push({
        index: i,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; "),
      });
      continue;
    }
    const item = parsed.data;
    const claim = existing.get(item.claimId);
    if (!claim) {
      errors.push({ index: i, message: `Unknown or other Duo's claimId: ${item.claimId}` });
      continue;
    }
    const f = facts.get(item.claimId)!;
    if (item.text !== undefined && item.text !== claim.text && (f.hasPlayerEvidence || f.hasRoundEvidence) && !item.force) {
      errors.push({
        index: i,
        message: `Claim ${item.claimId} has Player or Round Evidence that vouched for its current wording; pass force: true to reword it anyway`,
      });
      continue;
    }
    const countries = item.countries ?? claim.countries;
    const regions = item.regions ?? claim.regions;
    const badRegion = regions.find((r) => !countries.includes(r.country));
    if (badRegion) {
      errors.push({
        index: i,
        message: `Region "${badRegion.name}" references country ${badRegion.country} which is not in countries[]`,
      });
      continue;
    }
    await updateClaim(db, duoId, item.claimId, {
      text: item.text,
      countries: item.countries,
      regions: item.regions,
      topics: item.topics,
    });
    saved.push({
      index: i,
      claimId: item.claimId,
      changed: (["text", "countries", "regions", "topics"] as const).filter((k) => item[k] !== undefined),
    });
  }

  if (saved.length > 0) duoEventBus.emitChanged(duoId, "claim");
  await queueTaggingOfChangedClaims(db, playerId, duoId, saved.length);
  return { savedCount: saved.length, saved, errors };
}

/**
 * `delete_claims`: removes Claims with their Evidence and image links. A Claim a
 * Player or a Round has confirmed is kept unless `force` is set, because an agent
 * can't recreate that Evidence. Learnings that cited a deleted Claim lose only the link.
 */
export async function mcpDeleteClaims(
  db: AppDb,
  playerId: string,
  input: { duo?: string; claimIds: string[]; force?: boolean },
) {
  const parsed = claimDeleteInputSchema.parse({ claimIds: input.claimIds, force: input.force });
  const duoId = (await resolveDuoForPlayer(db, playerId, input.duo)).id;
  const claims = new Map((await deriveClaims(db, duoId)).filter((c) => parsed.claimIds.includes(c.id)).map((c) => [c.id, c]));
  const facts = await claimEvidenceFacts(db, duoId, [...claims.keys()]);

  const deleted: Array<{ claimId: string; text: string; evidenceRemoved: number; learningsUnlinked: number }> = [];
  const kept: Array<{ claimId: string; reason: string }> = [];
  const toDelete: string[] = [];

  for (const id of parsed.claimIds) {
    const claim = claims.get(id);
    if (!claim) {
      kept.push({ claimId: id, reason: "Unknown or other Duo's claimId" });
      continue;
    }
    const f = facts.get(id)!;
    if ((f.hasPlayerEvidence || f.hasRoundEvidence) && !parsed.force) {
      kept.push({
        claimId: id,
        reason: "Has Player or Round Evidence that can't be recreated; pass force: true to delete it anyway",
      });
      continue;
    }
    toDelete.push(id);
    deleted.push({
      claimId: id,
      text: claim.text,
      evidenceRemoved: f.evidenceCount,
      learningsUnlinked: claim.learningIds.length,
    });
  }

  await deleteClaimsById(db, duoId, toDelete);
  if (toDelete.length > 0) duoEventBus.emitChanged(duoId, "claim");
  return { deletedCount: deleted.length, deleted, kept };
}

export async function mcpAddLearnings(
  db: AppDb,
  playerId: string,
  runId: string,
  rawItems: unknown[],
) {
  const run = await findScopedRun(db, runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  if (run.status !== "open") {
    throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
  }
  if (run.purpose === "calls") {
    throw new DomainError(
      "WRONG_PURPOSE",
      "A calls Processing run produces Call labels, not Learnings; use add_call_labels",
      400,
    );
  }
  if (run.purpose === "clues") {
    throw new DomainError(
      "WRONG_PURPOSE",
      "A clues Processing run links Rounds to Clues, not Learnings; use add_round_clues",
      400,
    );
  }

  const { refToUtterance } = await getRunInRangeUtterances(db, run);
  const duoRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(roundInDuo(run.duoId));
  const validDuoRoundIds = new Set(duoRounds.map((r) => r.id));
  const parsedItems = rawItems.map((raw) => learningItemInputSchema.safeParse(raw));
  const linkableClaimIds = await duoClaimIds(
    db,
    run.duoId,
    parsedItems.flatMap((p) => (p.success && p.data.claimId ? [p.data.claimId] : [])),
  );

  const validToInsert: Parameters<typeof insertRunLearnings>[4] = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < parsedItems.length; i++) {
    const parsed = parsedItems[i]!;
    if (!parsed.success) {
      errors.push({
        index: i,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; "),
      });
      continue;
    }

    const item = parsed.data;
    const invalidRounds = item.roundIds.filter((rId) => !validDuoRoundIds.has(rId));
    if (invalidRounds.length > 0) {
      errors.push({
        index: i,
        message: `Unknown or cross-Duo roundIds: ${invalidRounds.join(", ")}`,
      });
      continue;
    }
    if (item.claimId && !linkableClaimIds.has(item.claimId)) {
      errors.push({ index: i, message: `Unknown or other Duo's claimId: ${item.claimId}` });
      continue;
    }
    const resolvedUtterances = [];
    const missingRefs: string[] = [];
    for (const ref of item.utteranceRefs) {
      const u = refToUtterance.get(ref);
      if (!u) {
        missingRefs.push(ref);
      } else {
        resolvedUtterances.push(u);
      }
    }

    if (missingRefs.length > 0) {
      errors.push({
        index: i,
        message: `Unknown or out-of-range utteranceRefs: ${missingRefs.join(", ")}`,
      });
      continue;
    }

    let spanStart = resolvedUtterances[0]!.startedAt;
    let spanEnd = resolvedUtterances[0]!.endedAt;
    for (const u of resolvedUtterances) {
      if (u.startedAt < spanStart) spanStart = u.startedAt;
      if (u.endedAt > spanEnd) spanEnd = u.endedAt;
    }

    validToInsert.push({
      kind: item.kind,
      text: item.text,
      detail: item.detail ?? null,
      countries: item.countries,
      regions: item.regions,
      topics: item.topics,
      origin: run.purpose === "tips" ? "agent" : item.origin,
      agentNote: item.agentNote ?? null,
      utteranceIds: resolvedUtterances.map((u) => u.id),
      roundIds: item.roundIds,
      claimId: item.claimId ?? null,
      sourceSpanStart: spanStart,
      sourceSpanEnd: spanEnd,
    });
  }

  const savedIds =
    validToInsert.length > 0
      ? await insertRunLearnings(db, run.id, run.duoId, run.purpose, validToInsert)
      : [];

  return {
    savedCount: savedIds.length,
    savedIds,
    errors,
  };
}

export async function mcpFinishRun(db: AppDb, playerId: string, runId: string) {
  const run = await findScopedRun(db, runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  const res = await finishProcessingRun(db, runId);
  duoEventBus.emitChanged(run.duoId, "run", run.id);
  return res;
}

type RunRow = typeof processingRuns.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

/** The Duo's Rounds any part of which (guessing or results) overlaps a run's range. */
async function loadRunRounds(db: AppDb, run: RunRow): Promise<RoundRow[]> {
  const span = { startedAt: run.rangeStart, endedAt: run.rangeEnd };
  return (await loadRoundsInSpan(db, run.duoId, span, "full")).map((x) => x.round);
}

/** The Duo's Rounds whose guessing phase overlaps a run's range. */
async function loadRunRangeRounds(db: AppDb, run: RunRow): Promise<RoundRow[]> {
  const span = { startedAt: run.rangeStart, endedAt: run.rangeEnd };
  return (await loadRoundsInSpan(db, run.duoId, span, "guessing")).map((x) => x.round);
}

/**
 * `read_range` for a `calls` run: the range's Split and Spread Rounds, each with
 * both teams' guessed countries and Regions and the citable Utterances spoken
 * during that Round's guessing phase.
 */
async function readCallsRange(db: AppDb, run: RunRow) {
  const [{ inRange, utteranceToRef }, rangeRounds, allPlayers, currentLabels, correctTranscript] =
    await Promise.all([
      getRunInRangeUtterances(db, run),
      loadRunRangeRounds(db, run),
      db.query.players.findMany(),
      deriveCurrentCallLabels(db, run.duoId),
      loadTranscriptCorrector(db, run.duoId),
    ]);
  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.displayName]));
  const gameIds = [...new Set(rangeRounds.map((r) => r.gameId))];
  const rangeGames =
    gameIds.length > 0 ? await db.query.games.findMany({ where: inArray(games.id, gameIds) }) : [];
  const ggGameIdById = new Map(rangeGames.map((g) => [g.id, g.geoguessrGameId]));

  const describeGuess = (g: DerivedGuess) => ({
    player: g.isDuo
      ? g.playerId
        ? (playerNameById.get(g.playerId) ?? g.nick ?? "Duo")
        : (g.nick ?? "Duo")
      : null,
    country: g.countryCode,
    region: regionName(g.regionCode) ?? g.regionCode,
    km: g.distanceMeters !== null ? Math.round(g.distanceMeters / 1000) : null,
    score: g.score,
  });

  const callableRounds = rangeRounds
    .filter((r) => isCallableRound(r))
    .map((r) => {
      const duoGuesses = r.guesses.filter((g) => g.isDuo);
      const oppGuesses = r.guesses.filter((g) => !g.isDuo);
      const duoHedge = roundHedge(r, duoGuesses);
      const guessing = roundGuessingInterval(r);
      const linked = inRange
        .filter((u) => intervalsOverlap({ startedAt: u.startedAt, endedAt: u.endedAt }, guessing))
        .map((u) => ({
          ref: utteranceToRef.get(u.id)!,
          at: formatHmsUtc(u.startedAt),
          speaker: playerNameById.get(u.playerId) ?? "Player",
          text: correctTranscript(u).text,
        }));
      const label = currentLabels.get(r.id);
      return {
        roundId: r.id,
        game: ggGameIdById.get(r.gameId) ?? r.gameId,
        roundNumber: r.roundNumber,
        kind: duoHedge.kind,
        guessDistanceKm:
          duoHedge.distanceMeters !== null ? Math.round(duoHedge.distanceMeters / 1000) : null,
        trueCountry: r.countryCode,
        trueRegion: regionName(r.regionCode) ?? r.regionCode,
        duoBestScore: r.duoBestScore,
        opponentBestScore: r.opponentBestScore,
        duoGuesses: duoGuesses.map(describeGuess),
        opponentKind: hedgeKind(oppGuesses),
        opponentGuesses: oppGuesses.map(describeGuess),
        utterances: linked,
        currentLabel: label ? { called: label.called, note: label.note } : null,
      };
    });

  const lines: string[] = [];
  for (const r of callableRounds) {
    const fmt = (gs: ReturnType<typeof describeGuess>[]) =>
      gs
        .map((g) => `${g.player ? `${g.player}:` : ""}${g.country ?? "?"}${g.region ? ` ${g.region}` : ""}`)
        .join(", ") || "none";
    lines.push(
      `--- ${r.kind!.toUpperCase()} | Game ${r.game} Round ${r.roundNumber} [roundId=${r.roundId}] | True: ${r.trueCountry ?? "?"}${r.trueRegion ? ` / ${r.trueRegion}` : ""} | Duo: ${fmt(r.duoGuesses)} (${r.guessDistanceKm ?? "?"}km apart) | Opponents (${r.opponentKind ?? "unclassified"}): ${fmt(r.opponentGuesses)} | Score ${r.duoBestScore} vs ${r.opponentBestScore}${r.currentLabel ? ` | Current label: ${r.currentLabel.called ? "called" : "not called"}` : ""} ---`,
    );
    if (r.utterances.length === 0) lines.push("(no speech while guessing)");
    for (const u of r.utterances) lines.push(`[${u.at}] ${u.ref} ${u.speaker}: ${u.text}`);
  }

  return {
    runId: run.id,
    purpose: "calls" as const,
    rangeStart: run.rangeStart.toISOString(),
    rangeEnd: run.rangeEnd.toISOString(),
    citableUtteranceCount: inRange.length,
    rounds: callableRounds,
    transcript: lines.join("\n") || "(no Split or Spread Rounds in this range)",
  };
}

/**
 * Adds a batch of Call labels to an open `calls` run. Each label must name a
 * Split or Spread Round in the run's range and cite only Utterances from that
 * Round's guessing phase; invalid items are reported and the rest saved.
 */
export async function mcpAddCallLabels(
  db: AppDb,
  playerId: string,
  runId: string,
  rawItems: unknown[],
) {
  const run = await findScopedRun(db, runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  if (run.status !== "open") {
    throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
  }
  if (run.purpose !== "calls") {
    throw new DomainError(
      "WRONG_PURPOSE",
      `A ${run.purpose} Processing run produces Learnings; use add_learnings`,
      400,
    );
  }

  const [{ refToUtterance }, rangeRounds] = await Promise.all([
    getRunInRangeUtterances(db, run),
    loadRunRangeRounds(db, run),
  ]);
  const roundById = new Map(rangeRounds.map((r) => [r.id, r]));

  const valid: Parameters<typeof insertRunCallLabels>[3] = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const parsed = callLabelInputSchema.safeParse(rawItems[i]);
    if (!parsed.success) {
      errors.push({
        index: i,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; "),
      });
      continue;
    }
    const item = parsed.data;
    const round = roundById.get(item.roundId);
    if (!round) {
      errors.push({ index: i, message: `Round ${item.roundId} is not in this run's range` });
      continue;
    }
    if (!isCallableRound(round)) {
      errors.push({
        index: i,
        message: `Round ${round.roundNumber} [${round.id}] is not a Split or Spread`,
      });
      continue;
    }
    const guessing = roundGuessingInterval(round);
    const badRefs = item.utteranceRefs.filter((ref) => {
      const u = refToUtterance.get(ref);
      return !u || !intervalsOverlap({ startedAt: u.startedAt, endedAt: u.endedAt }, guessing);
    });
    if (badRefs.length > 0) {
      errors.push({
        index: i,
        message: `utteranceRefs outside Round ${round.roundNumber}'s guessing phase: ${badRefs.join(", ")}`,
      });
      continue;
    }
    valid.push({
      roundId: round.id,
      called: item.called,
      note: item.note ?? null,
      utteranceIds: item.utteranceRefs.map((ref) => refToUtterance.get(ref)!.id),
    });
  }

  const savedIds = valid.length > 0 ? await insertRunCallLabels(db, run.id, run.duoId, valid) : [];
  return { savedCount: savedIds.length, savedIds, errors };
}

/**
 * `read_range` for a `clues` run (#89): the range's Rounds, each with only the citable Utterances spoken while
 * guessing (#80: nothing after guessing ends), and the Round's current Clues. The answer and the guesses are left
 * out, so the tagger reads what was said, not what the Round turned out to be.
 */
async function readCluesRange(db: AppDb, run: RunRow) {
  const [{ inRange, utteranceToRef }, rangeRounds, allPlayers, correctTranscript] = await Promise.all([
    getRunInRangeUtterances(db, run),
    loadRunRangeRounds(db, run),
    db.query.players.findMany(),
    loadTranscriptCorrector(db, run.duoId),
  ]);
  const [current, duoClues] = await Promise.all([
    deriveCurrentRoundClues(db, run.duoId, rangeRounds.map((r) => r.id)),
    listDuoClues(db, run.duoId),
  ]);
  const clueById = new Map(duoClues.map((c) => [c.id, c]));
  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.displayName]));
  const gameIds = [...new Set(rangeRounds.map((r) => r.gameId))];
  const rangeGames =
    gameIds.length > 0 ? await db.query.games.findMany({ where: inArray(games.id, gameIds) }) : [];
  const ggGameIdById = new Map(rangeGames.map((g) => [g.id, g.geoguessrGameId]));

  const roundsOut = rangeRounds.map((r) => {
    const guessing = roundGuessingInterval(r);
    const said = inRange
      .filter((u) => u.startedAt < guessing.endedAt && intervalsOverlap({ startedAt: u.startedAt, endedAt: u.endedAt }, guessing))
      .map((u) => ({
        ref: utteranceToRef.get(u.id)!,
        at: formatHmsUtc(u.startedAt),
        speaker: playerNameById.get(u.playerId) ?? "Player",
        text: correctTranscript(u).text,
      }));
    return {
      roundId: r.id,
      game: ggGameIdById.get(r.gameId) ?? r.gameId,
      roundNumber: r.roundNumber,
      utterances: said,
      currentClues: (current.get(r.id) ?? []).flatMap((c) => {
        const clue = clueById.get(c.clueId);
        return clue ? [`${clue.family}: ${clue.name}`] : [];
      }),
    };
  });

  const lines: string[] = [];
  for (const r of roundsOut) {
    lines.push(
      `--- Game ${r.game} Round ${r.roundNumber} [roundId=${r.roundId}]${r.currentClues.length ? ` | Current Clues: ${r.currentClues.join("; ")}` : ""} ---`,
    );
    if (r.utterances.length === 0) lines.push("(no speech while guessing)");
    for (const u of r.utterances) lines.push(`[${u.at}] ${u.ref} ${u.speaker}: ${u.text}`);
  }

  return {
    runId: run.id,
    purpose: "clues" as const,
    rangeStart: run.rangeStart.toISOString(),
    rangeEnd: run.rangeEnd.toISOString(),
    citableUtteranceCount: inRange.length,
    rounds: roundsOut,
    transcript: lines.join("\n") || "(no Rounds in this range)",
  };
}

/**
 * `add_round_clues`: saves a `clues` run's Clues for some Rounds. Each item is every Clue said in one Round of the
 * run's range (it replaces what this run said about that Round earlier), citing only Utterances spoken while that
 * Round's guessing was on. Clues are reused by id or by family and name, and created only inside a vocabulary
 * family; the Clues created are reported. Invalid items are reported and the rest saved.
 */
export async function mcpAddRoundClues(db: AppDb, playerId: string, runId: string, rawItems: unknown[]) {
  const run = await findScopedRun(db, runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  if (run.status !== "open") {
    throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
  }
  if (run.purpose !== "clues") {
    throw new DomainError("WRONG_PURPOSE", `A ${run.purpose} Processing run doesn't link Rounds to Clues`, 400);
  }

  const vocabulary = await loadClueVocabulary();
  await seedDuoClues(db, run.duoId, vocabulary);
  const [{ refToUtterance }, rangeRounds, resolver] = await Promise.all([
    getRunInRangeUtterances(db, run),
    loadRunRangeRounds(db, run),
    clueResolver(db, run.duoId, vocabulary),
  ]);
  const roundById = new Map(rangeRounds.map((r) => [r.id, r]));

  const valid: Parameters<typeof insertRunRoundClues>[3][number][] = [];
  const errors: Array<{ index: number; message: string }> = [];
  for (let i = 0; i < rawItems.length; i++) {
    const parsed = roundCluesItemInputSchema.safeParse(rawItems[i]);
    if (!parsed.success) {
      errors.push({
        index: i,
        message: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; "),
      });
      continue;
    }
    const item = parsed.data;
    const round = roundById.get(item.roundId);
    if (!round) {
      errors.push({ index: i, message: `Round ${item.roundId} is not in this run's range` });
      continue;
    }
    // Speech after guessing ends reacts to the reveal (#80): it never names a Round's Clue.
    const guessing = roundGuessingInterval(round);
    const problems: string[] = [];
    const roundClueItems: Array<{ clueId: string; note: string | null; utteranceIds: string[] }> = [];
    for (const c of item.clues) {
      const badRefs = c.utteranceRefs.filter((ref) => {
        const u = refToUtterance.get(ref);
        return !u || u.startedAt >= guessing.endedAt || !intervalsOverlap({ startedAt: u.startedAt, endedAt: u.endedAt }, guessing);
      });
      if (badRefs.length > 0) {
        problems.push(`utteranceRefs not spoken while Round ${round.roundNumber} was guessed: ${badRefs.join(", ")}`);
        continue;
      }
      const clue = await resolver.resolve(c);
      if ("error" in clue) {
        problems.push(clue.error);
        continue;
      }
      roundClueItems.push({ clueId: clue.id, note: c.note ?? null, utteranceIds: c.utteranceRefs.map((ref) => refToUtterance.get(ref)!.id) });
    }
    if (problems.length > 0) {
      errors.push({ index: i, message: problems.join("; ") });
      continue;
    }
    valid.push({ roundId: round.id, clues: roundClueItems });
  }

  const savedCount = valid.length > 0 ? await insertRunRoundClues(db, run.id, run.duoId, valid) : 0;
  return {
    savedRounds: valid.length,
    savedCount,
    createdClues: resolver.created.map((c) => ({ clueId: c.id, family: c.family, name: c.name })),
    errors,
  };
}

/**
 * `add_source`: stores a document an agent converted to markdown as a new
 * Source, or as the next version of `sourceId`. Not a Processing run.
 */
export async function mcpAddSource(
  db: AppDb,
  playerId: string,
  input: {
    duo?: string;
    sourceId?: string;
    title: string;
    url?: string;
    kind: SourceKind;
    markdown: string;
  },
) {
  let duoId: string;
  if (input.sourceId) {
    const source = await db.query.sources.findFirst({ where: eq(sources.id, input.sourceId) });
    if (!source) throw new DomainError("NOT_FOUND", "Source not found", 404);
    duoId = (await resolveDuoForPlayer(db, playerId, source.duoId)).id;
  } else {
    duoId = (await resolveDuoForPlayer(db, playerId, input.duo)).id;
  }
  const res = await addSourceVersion(db, playerId, { ...input, duoId });
  duoEventBus.emitChanged(duoId, "source", res.sourceId);
  return res;
}

/** `add_source_image`: one image of a Source version, base64, size-capped. */
export async function mcpAddSourceImage(
  db: AppDb,
  playerId: string,
  input: { sourceVersionId: string; name: string; mimeType: string; base64: string },
) {
  const version = await db.query.sourceVersions.findFirst({
    where: eq(sourceVersions.id, input.sourceVersionId),
  });
  if (!version) throw new DomainError("NOT_FOUND", "Source version not found", 404);
  await resolveDuoForPlayer(db, playerId, version.duoId);
  const res = await addSourceImage(db, playerId, input);
  duoEventBus.emitChanged(version.duoId, "source", version.sourceId);
  return res;
}

/**
 * `list_sources`: the Duo's Sources with their versions, so an agent can pass
 * the right `sourceId` when re-ingesting. `query` matches title or URL.
 */
export async function mcpListSources(
  db: AppDb,
  playerId: string,
  input: { duo?: string; query?: string },
) {
  const duo = await resolveDuoForPlayer(db, playerId, input.duo);
  const q = input.query?.trim().toLowerCase() ?? "";
  const all = await listSources(db, duo.id);
  const matches = q
    ? all.filter((s) => `${s.title} ${s.url ?? ""}`.toLowerCase().includes(q))
    : all;
  return {
    duo,
    total: matches.length,
    sources: matches.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      kind: s.kind,
      versions: s.versions.map((v) => ({
        sourceVersionId: v.id,
        versionNo: v.versionNo,
        createdAt: v.createdAt.toISOString(),
        sectionCount: v.sectionCount,
        imageCount: v.imageCount,
      })),
    })),
  };
}
