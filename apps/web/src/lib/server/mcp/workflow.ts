import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import {
  intervalsOverlap,
  learningItemInputSchema,
  regionName,
  type ProcessingRunPurpose,
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
  utterances,
} from "../db/schema.js";
import {
  DomainError,
  deriveLearningsWithStatus,
  deriveSessionWorkRanges,
  finishProcessingRun,
  getCurrentTranscriptVersionId,
  insertRunLearnings,
  startProcessingRun,
} from "../services/index.js";
import { duoEventBus } from "../events/bus.js";
import { getCurrentPromptVersion, loadPromptInstructions } from "./prompts.js";

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
  const recs = await db.query.recordings.findMany({
    where: and(eq(recordings.duoId, duoId), eq(recordings.sessionId, sessionId)),
  });
  const currentVersionIds: string[] = [];
  for (const r of recs) {
    const tvId = await getCurrentTranscriptVersionId(db, r.id);
    if (tvId) currentVersionIds.push(tvId);
  }
  if (currentVersionIds.length === 0) return [];

  return db.query.utterances.findMany({
    where: and(
      inArray(utterances.transcriptVersionId, currentVersionIds),
      lt(utterances.startedAt, endUtc),
      gt(utterances.endedAt, startUtc),
    ),
    orderBy: [asc(utterances.startedAt), asc(utterances.id)],
  });
}

export async function mcpGetInstructions(purpose: ProcessingRunPurpose) {
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

  const duoGames = await db.query.games.findMany({
    where: eq(games.duoId, duo.id),
    orderBy: [asc(games.startedAt)],
  });

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
        intervalsOverlap(
          { startedAt: g.startedAt, endedAt: g.endedAt },
          { startedAt: w.startUtc, endedAt: w.endUtc },
        ),
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
  const run = await db.query.processingRuns.findFirst({
    where: eq(processingRuns.id, runId),
  });
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);

  const padStart = new Date(run.rangeStart.getTime() - CONTEXT_PADDING_MS);
  const padEnd = new Date(run.rangeEnd.getTime() + CONTEXT_PADDING_MS);

  const [{ inRange, utteranceToRef }, paddedUtterances, allPlayers, duoGames, duoLearnings] =
    await Promise.all([
      getRunInRangeUtterances(db, run),
      loadCurrentSessionUtterances(db, run.duoId, run.sessionId, padStart, padEnd),
      db.query.players.findMany(),
      db.query.games.findMany({
        where: and(
          eq(games.duoId, run.duoId),
          lt(games.startedAt, padEnd),
          gt(games.endedAt, padStart),
        ),
        orderBy: [asc(games.startedAt)],
      }),
      deriveLearningsWithStatus(db, run.duoId),
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

  // Build chronological timeline mixing Round markers and Utterances
  type LineEvent = { ts: number; order: number; line: string };
  const timeline: LineEvent[] = [];

  for (const g of duoGames) {
    const ratingStr =
      g.duoRatingBefore !== null && g.duoRatingAfter !== null
        ? ` | Rating ${g.duoRatingBefore}→${g.duoRatingAfter}`
        : "";
    const outcome = g.won === true ? "WIN" : g.won === false ? "LOSS" : "FINISHED";
    timeline.push({
      ts: g.startedAt.getTime(),
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
      timeline.push({
        ts: r.startTime.getTime(),
        order: 1,
        line: `--- Round ${r.roundNumber} [roundId=${r.id}] | True: ${r.countryCode ?? "?"}${regionPart} | Guesses: ${guessParts || "none"} | Score: ${r.duoBestScore} vs ${r.opponentBestScore} (HP ${r.hpDelta >= 0 ? "+" : ""}${r.hpDelta}, x${r.damageMultiplier} -> Duo ${duoHp} / Opp ${oppHp}) ---`,
      });
    }
  }

  for (const u of paddedUtterances) {
    const ref = utteranceToRef.get(u.id);
    const speaker = playerNameById.get(u.playerId) ?? "Player";
    const lowConf =
      (u.avgLogprob !== null && u.avgLogprob < LOW_CONF_LOGPROB) ||
      (u.noSpeechProb !== null && u.noSpeechProb > LOW_CONF_NOSPEECH);
    const marker = lowConf ? " (?)" : "";
    const ts = formatHmsUtc(u.startedAt);
    const line = ref
      ? `[${ts}] ${ref} ${speaker}: ${u.text}${marker}`
      : `[${ts}] (context) ${speaker}: ${u.text}${marker}`;
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
      reactions: l.reactions.map((r) => `${r.reaction}(${playerNameById.get(r.playerId) ?? r.playerId})`),
    }));

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
  };
}

export async function mcpAddLearnings(
  db: AppDb,
  playerId: string,
  runId: string,
  rawItems: unknown[],
) {
  const run = await db.query.processingRuns.findFirst({
    where: eq(processingRuns.id, runId),
  });
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  if (run.status !== "open") {
    throw new DomainError("CONFLICT", `Processing run is already ${run.status}`, 409);
  }

  const { refToUtterance } = await getRunInRangeUtterances(db, run);
  const duoRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.duoId, run.duoId));
  const validDuoRoundIds = new Set(duoRounds.map((r) => r.id));

  const validToInsert: Parameters<typeof insertRunLearnings>[4] = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const parsed = learningItemInputSchema.safeParse(rawItems[i]);
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
  const run = await db.query.processingRuns.findFirst({
    where: eq(processingRuns.id, runId),
  });
  if (!run) {
    throw new DomainError("NOT_FOUND", "Processing run not found", 404);
  }
  await resolveDuoForPlayer(db, playerId, run.duoId);
  const res = await finishProcessingRun(db, runId);
  duoEventBus.emitChanged(run.duoId, "run", run.id);
  return res;
}
