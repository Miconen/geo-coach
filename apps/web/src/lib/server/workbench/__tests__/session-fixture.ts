/**
 * Shared Session fixture for run-history and derivation tests (#56 0b; 1a-derivation extends it): one Duo, two
 * Players, a Session with one Recording (19:00-19:30 UTC) whose speech spans two Games, plus helpers to insert
 * runs, jobs and Learnings at exact times.
 */
import { asc, eq } from "drizzle-orm";
import { uuidv7, type Geocoder, type ProcessingRunPurpose } from "@geo-coach/shared";
import type { TestDbHandle } from "../../db/test-db.js";
import {
  duos,
  duoMemberships,
  players,
  processingJobs,
  processingRuns,
  rounds,
  utterances,
} from "../../db/schema.js";
import {
  completeTranscriptVersion,
  insertRunLearnings,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../../services/index.js";

export const at = (hms: string, day = "2026-11-20") => new Date(`${day}T${hms}.000Z`);

const PLACES: Record<string, { countryCode: string; regionCode: string | null }> = {
  "40.42,-3.7": { countryCode: "ES", regionCode: "ES-MD" },
  "38.72,-9.14": { countryCode: "PT", regionCode: "PT-11" },
  "39.86,-4.02": { countryCode: "ES", regionCode: "ES-CM" },
  "40,-3.9": { countryCode: "ES", regionCode: "ES-CM" },
};
export const fixtureGeocoder: Geocoder = (lat, lng) => PLACES[`${lat},${lng}`] ?? null;

/** A three-Round team duel whose first Round is a Split (Madrid vs Lisbon). */
export function rawDuel(gameId: string, teamId: string, starts: [string, string, string], day = "2026-11-20") {
  const iso = (hms: string) => `${day}T${hms}.000Z`;
  const plus = (hms: string, sec: number) => new Date(at(hms, day).getTime() + sec * 1000).toISOString();
  const round = (n: number, start: string) => ({
    roundNumber: n,
    panorama: { panoId: `p${gameId}${n}`, lat: 40, lng: -3.9, countryCode: "es" },
    startTime: iso(start),
    timerStartTime: plus(start, 20),
    endTime: plus(start, 40),
    damageMultiplier: 1,
  });
  const guess = (n: number, lat: number, lng: number, start: string, s: number) => ({
    roundNumber: n,
    lat,
    lng,
    distance: 100_000,
    score: 4000,
    created: plus(start, s),
  });
  return {
    gameId,
    status: "Finished",
    options: { isTeamDuels: true, isRated: true },
    teams: [
      {
        id: teamId,
        name: "Fixture Duo",
        health: 6000,
        players: [
          { playerId: "gg_f1", nick: "F1", guesses: starts.map((s, i) => guess(i + 1, 40.42, -3.7, s, 30)) },
          {
            playerId: "gg_f2",
            nick: "F2",
            guesses: [guess(1, 38.72, -9.14, starts[0], 31), guess(2, 39.86, -4.02, starts[1], 31), guess(3, 40.42, -3.7, starts[2], 31)],
          },
        ],
      },
      { id: `${teamId}_opp`, name: "Opp", health: 3000, players: [] },
    ],
    rounds: starts.map((s, i) => round(i + 1, s)),
    result: { winningTeamId: teamId },
  };
}

export interface SessionFixture {
  duoId: string;
  mikoId: string;
  soraId: string;
  sessionId: string;
  recordingId: string;
  transcriptVersionId: string;
  /** Utterances in time order: u[0..5] during Game 1 (19:01-19:04), u[6] between Games, u[7] in Game 2. */
  u: { id: string; startedAt: Date; endedAt: Date }[];
  gameIds: string[];
  /** Rounds of Game 1, then Game 2, in number order. */
  roundIds: string[];
}

export async function seedSessionFixture(
  handle: TestDbHandle,
  opts: { tag?: string; day?: string; teamId?: string } = {},
): Promise<SessionFixture> {
  const tag = opts.tag ?? "f";
  const day = opts.day ?? "2026-11-20";
  const teamId = opts.teamId ?? `team_${tag}`;
  const db = handle.db;
  const duoId = uuidv7();
  const mikoId = uuidv7();
  const soraId = uuidv7();
  await db.insert(duos).values({ id: duoId, name: `Duo ${tag}`, geoguessrTeamId: teamId });
  await db.insert(players).values([
    { id: mikoId, discordId: `d_${tag}_miko`, displayName: "Miko", geoguessrUserId: `gg_f1_${tag}` },
    { id: soraId, discordId: `d_${tag}_sora`, displayName: "Sora", geoguessrUserId: `gg_f2_${tag}` },
  ]);
  await db.insert(duoMemberships).values([
    { duoId, playerId: mikoId },
    { duoId, playerId: soraId },
  ]);
  const recording = await addRecording(handle, { duoId, playerId: mikoId, start: at("19:00:00", day), minutes: 30 });
  for (const [gameId, starts] of [
    [`${tag}_duel_1`, ["19:01:00", "19:02:00", "19:03:00"]],
    [`${tag}_duel_2`, ["19:10:00", "19:11:00", "19:12:00"]],
  ] as const) {
    await upsertRawGame(
      db,
      { duoId, geoguessrGameId: gameId, fetchedAt: `${day}T19:20:00.000Z`, rawDuel: rawDuel(gameId, teamId, [...starts], day) },
      fixtureGeocoder,
    );
  }
  const games = await db.query.games.findMany({ where: (g, { eq: e }) => e(g.duoId, duoId), orderBy: (g) => [asc(g.startedAt)] });
  const roundIds: string[] = [];
  for (const g of games) {
    const rs = await db.query.rounds.findMany({ where: eq(rounds.gameId, g.id), orderBy: [asc(rounds.roundNumber)] });
    roundIds.push(...rs.map((r) => r.id));
  }
  return {
    duoId,
    mikoId,
    soraId,
    sessionId: recording.sessionId,
    recordingId: recording.recordingId,
    transcriptVersionId: recording.transcriptVersionId,
    u: recording.u,
    gameIds: games.map((g) => g.id),
    roundIds,
  };
}

/** Records speech from `start`; the default lines put u[0..5] in Game 1, u[6] between Games, u[7] in Game 2. */
export async function addRecording(
  handle: TestDbHandle,
  input: { duoId: string; playerId: string; start: Date; minutes: number; lines?: Array<[string, number]> },
) {
  const db = handle.db;
  const recordingId = uuidv7();
  const transcriptVersionId = uuidv7();
  const started = await startRecording(db, input.playerId, {
    recordingId,
    transcriptVersionId,
    duoId: input.duoId,
    startedAt: input.start.toISOString(),
    clockAnchorMs: input.start.getTime(),
    companionVersion: "0.1.0",
    model: "large-v3",
    transcriberSettings: {},
    hotwordsUsed: [],
  });
  const lines =
    input.lines ??
    ([
      ["You go Spain, I'll go Portugal", 70_000],
      ["Okay, Portugal it is", 74_000],
      ["Nice split, that saved us", 105_000],
      ["I think this is Madrid", 130_000],
      ["No way, it's Toledo", 135_000],
      ["Madrid for sure", 190_000],
      ["Between games: remember the bollards", 400_000],
      ["Second game, Spain again", 610_000],
    ] as Array<[string, number]>);
  await uploadTranscriptChunk(db, input.playerId, transcriptVersionId, {
    recordingId,
    chunkNo: 0,
    utterances: lines.map(([text, ms]) => ({ text, startSampleMs: ms, endSampleMs: ms + 2_000, words: [], avgLogprob: -0.2 })),
  });
  await completeTranscriptVersion(db, input.playerId, transcriptVersionId, { totalChunks: 1 });
  await stopRecording(db, input.playerId, recordingId, {
    stoppedAt: new Date(input.start.getTime() + input.minutes * 60_000).toISOString(),
    stopReason: "stop",
  });
  const u = await db
    .select({ id: utterances.id, startedAt: utterances.startedAt, endedAt: utterances.endedAt })
    .from(utterances)
    .where(eq(utterances.transcriptVersionId, transcriptVersionId))
    .orderBy(asc(utterances.startedAt));
  return { recordingId, transcriptVersionId, sessionId: started.sessionId, u };
}

/** Inserts a run with exact times (finishedAt null keeps it open unless status says otherwise). */
export async function insertRun(
  handle: TestDbHandle,
  f: { duoId: string; mikoId: string; sessionId: string },
  input: {
    purpose?: ProcessingRunPurpose;
    range: [Date, Date];
    startedAt: Date;
    finishedAt?: Date | null;
    status?: "open" | "finished" | "abandoned";
  },
): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(processingRuns).values({
    id,
    duoId: f.duoId,
    sessionId: f.sessionId,
    startedByPlayerId: f.mikoId,
    purpose: input.purpose ?? "extract",
    agent: "claude",
    model: "test-model",
    promptVersion: "v1",
    rangeStart: input.range[0],
    rangeEnd: input.range[1],
    status: input.status ?? (input.finishedAt ? "finished" : "open"),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt ?? null,
  });
  return id;
}

export async function insertJob(
  handle: TestDbHandle,
  f: { duoId: string; mikoId: string; sessionId: string },
  input: {
    purpose?: "extract" | "tips";
    range: [Date, Date];
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    runId?: string | null;
    error?: string | null;
    createdAt: Date;
    finishedAt?: Date | null;
  },
): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(processingJobs).values({
    id,
    duoId: f.duoId,
    sessionId: f.sessionId,
    requestedByPlayerId: f.mikoId,
    purpose: input.purpose ?? "extract",
    rangeStart: input.range[0],
    rangeEnd: input.range[1],
    status: input.status,
    runId: input.runId ?? null,
    error: input.error ?? null,
    createdAt: input.createdAt,
    finishedAt: input.finishedAt ?? null,
  });
  return id;
}

/** One speech Learning per Utterance group, with the group's span. */
export async function addLearnings(
  handle: TestDbHandle,
  f: { duoId: string },
  runId: string,
  groups: Array<{ text: string; u: Array<{ id: string; startedAt: Date; endedAt: Date }>; roundIds?: string[] }>,
  purpose: "extract" | "tips" = "extract",
) {
  return insertRunLearnings(
    handle.db,
    runId,
    f.duoId,
    purpose,
    groups.map((g) => ({
      kind: "clue" as const,
      text: g.text,
      countries: ["ES"],
      regions: [],
      topics: [],
      origin: "speech" as const,
      utteranceIds: g.u.map((x) => x.id),
      roundIds: g.roundIds ?? [],
      sourceSpanStart: g.u[0]!.startedAt,
      sourceSpanEnd: g.u[g.u.length - 1]!.endedAt,
    })),
  );
}
