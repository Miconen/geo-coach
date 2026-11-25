/**
 * Builds the Playwright database from scratch: drops and recreates E2E_DATABASE_URL's database, migrates it
 * and seeds two Duos through the real services. Writes the generated ids to e2e/.seed.json for the specs.
 * Run with `pnpm --filter @geo-coach/web e2e:seed`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, asc, eq } from "drizzle-orm";
import { uuidv7, type Geocoder } from "@geo-coach/shared";
import * as schema from "../src/lib/server/db/schema.js";
import type { AppDb } from "../src/lib/server/db/index.js";
import {
  addSourceImage,
  addSourceVersion,
  completeTranscriptVersion,
  finishProcessingRun,
  insertRunLearnings,
  startProcessingRun,
  startRecording,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../src/lib/server/services/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach_e2e";

const PLACES: Record<string, { countryCode: string; regionCode: string | null }> = {
  "40.42,-3.7": { countryCode: "ES", regionCode: "ES-MD" },
  "38.72,-9.14": { countryCode: "PT", regionCode: "PT-11" },
  "39.86,-4.02": { countryCode: "ES", regionCode: "ES-CM" },
  "40,-3.9": { countryCode: "ES", regionCode: "ES-CM" },
  "42.7,23.3": { countryCode: "BG", regionCode: null },
};
const geocoder: Geocoder = (lat, lng) => PLACES[`${lat},${lng}`] ?? null;

const day = "2026-11-20";
const at = (hms: string) => `${day}T${hms}.000Z`;

function duel(gameId: string, teamId: string, startHms: [string, string, string], extraRound0 = false) {
  const guess = (n: number, lat: number, lng: number, created: string, distance = 100_000) => ({
    roundNumber: n,
    lat,
    lng,
    distance,
    score: 4000,
    created: at(created),
  });
  const round = (n: number, start: string, timer: string, end: string) => ({
    roundNumber: n,
    panorama: { panoId: `p${gameId}${n}`, lat: 40, lng: -3.9, countryCode: "es", heading: 90, pitch: 0, zoom: 0 },
    startTime: at(start),
    timerStartTime: at(timer),
    endTime: at(end),
    damageMultiplier: 1,
  });
  const [s1, s2, s3] = startHms;
  const plus = (hms: string, sec: number) => {
    const d = new Date(at(hms));
    d.setUTCSeconds(d.getUTCSeconds() + sec);
    return d.toISOString().slice(11, 19);
  };
  const rounds = [
    round(1, s1, plus(s1, 20), plus(s1, 40)),
    round(2, s2, plus(s2, 20), plus(s2, 40)),
    round(3, s3, plus(s3, 20), plus(s3, 40)),
  ];
  if (extraRound0) rounds.unshift(round(0, plus(s1, -50), plus(s1, -40), plus(s1, -30)));
  return {
    gameId,
    status: "Finished",
    options: { isTeamDuels: true, isRated: true },
    teams: [
      {
        id: teamId,
        name: "E2E Duo",
        health: 6000,
        players: [
          {
            playerId: "gg_e2e_p1",
            nick: "MikoGeo",
            guesses: [
              ...(extraRound0 ? [guess(0, 40.42, -3.7, plus(s1, -35))] : []),
              guess(1, 40.42, -3.7, plus(s1, 30)),
              guess(2, 40.42, -3.7, plus(s2, 30)),
              guess(3, 40.42, -3.7, plus(s3, 30)),
            ],
          },
          {
            playerId: "gg_e2e_p2",
            nick: "SoraMaps",
            // Sora's closest-of-all guesses give Stats best-guess entries (#56 2b), Round 0 included.
            guesses: [
              ...(extraRound0 ? [guess(0, 39.86, -4.02, plus(s1, -34), 5_000)] : []),
              guess(1, 38.72, -9.14, plus(s1, 31)),
              guess(2, 39.86, -4.02, plus(s2, 31), 20_000),
              guess(3, 40.42, -3.7, plus(s3, 31)),
            ],
          },
        ],
      },
      {
        id: "gg_team_opp",
        name: "Opponents",
        health: 3000,
        players: [{ playerId: "gg_opp1", nick: "Opp1", guesses: [guess(1, 42.7, 23.3, plus(s1, 32))] }],
      },
    ],
    rounds,
    result: { winningTeamId: teamId },
  };
}

async function recreateDatabase(url: string) {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Refusing to recreate database "${dbName}"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    await sql.unsafe(`drop database if exists "${dbName}" with (force)`);
    await sql.unsafe(`create database "${dbName}"`);
  } finally {
    await sql.end();
  }
}

async function main() {
  await recreateDatabase(E2E_DATABASE_URL);
  const sql = postgres(E2E_DATABASE_URL, { max: 4 });
  const db = drizzle(sql, { schema }) as unknown as AppDb;
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });

  const duoId = uuidv7();
  const otherDuoId = uuidv7();
  const mikoId = uuidv7();
  const soraId = uuidv7();
  const outsiderId = uuidv7();
  await db.insert(schema.duos).values([
    { id: duoId, name: "E2E Duo", geoguessrTeamId: "gg_team_e2e" },
    { id: otherDuoId, name: "Other Duo", geoguessrTeamId: "gg_team_other" },
  ]);
  await db.insert(schema.players).values([
    { id: mikoId, discordId: "e2e_miko", displayName: "Miko", geoguessrUserId: "gg_e2e_p1", geoguessrName: "MikoGeo", color: "blue" },
    { id: soraId, discordId: "e2e_sora", displayName: "Sora", geoguessrUserId: "gg_e2e_p2", geoguessrName: "SoraMaps", color: "pink" },
    { id: outsiderId, discordId: "e2e_out", displayName: "Outsider", geoguessrUserId: "gg_e2e_p3" },
  ]);
  await db.insert(schema.duoMemberships).values([
    { duoId, playerId: mikoId },
    { duoId, playerId: soraId },
    { duoId: otherDuoId, playerId: outsiderId },
  ]);

  // One Session: Miko records 19:00-19:30 while two Games are played.
  const anchor = Date.parse(at("19:00:00"));
  const recordingId = uuidv7();
  const tvId = uuidv7();
  const started = await startRecording(db, mikoId, {
    recordingId,
    transcriptVersionId: tvId,
    duoId,
    startedAt: new Date(anchor).toISOString(),
    clockAnchorMs: anchor,
    companionVersion: "0.1.0",
    model: "large-v3",
    transcriberSettings: {},
    hotwordsUsed: [],
  });
  const speech = (text: string, startMs: number) => ({
    text,
    startSampleMs: startMs,
    endSampleMs: startMs + 2_000,
    words: [],
    avgLogprob: -0.2,
  });
  await uploadTranscriptChunk(db, mikoId, tvId, {
    recordingId,
    chunkNo: 0,
    utterances: [
      speech("You go Spain, I'll go Portugal", 70_000),
      speech("Okay, Portugal it is", 74_000),
      speech("Nice split, that saved us", 105_000),
      speech("I think this is Madrid", 130_000),
      speech("No way, it's Toledo", 135_000),
      speech("Madrid for sure", 190_000),
      speech("Between games: remember the bollards", 400_000),
      speech("Second game, this looks like Spain again", 610_000),
    ],
  });
  await completeTranscriptVersion(db, mikoId, tvId, { totalChunks: 1 });
  await stopRecording(db, mikoId, recordingId, {
    stoppedAt: new Date(anchor + 30 * 60_000).toISOString(),
    stopReason: "stop",
  });

  await upsertRawGame(
    db,
    { duoId, geoguessrGameId: "e2e_duel_1", fetchedAt: at("19:05:00"), rawDuel: duel("e2e_duel_1", "gg_team_e2e", ["19:01:00", "19:02:00", "19:03:00"]) },
    geocoder,
  );
  await upsertRawGame(
    db,
    { duoId, geoguessrGameId: "e2e_duel_2", fetchedAt: at("19:15:00"), rawDuel: duel("e2e_duel_2", "gg_team_e2e", ["19:10:00", "19:11:00", "19:12:00"], true) },
    geocoder,
  );

  const games = await db.query.games.findMany({ where: eq(schema.games.duoId, duoId), orderBy: [asc(schema.games.startedAt)] });
  const roundsByGame: Record<string, { id: string; roundNumber: number }[]> = {};
  for (const g of games) {
    roundsByGame[g.id] = (
      await db.query.rounds.findMany({ where: eq(schema.rounds.gameId, g.id), orderBy: [asc(schema.rounds.roundNumber)] })
    ).map((r) => ({ id: r.id, roundNumber: r.roundNumber }));
  }
  const utterances = await db.query.utterances.findMany({
    where: and(eq(schema.utterances.duoId, duoId), eq(schema.utterances.transcriptVersionId, tvId)),
    orderBy: [asc(schema.utterances.startedAt)],
  });
  const game1 = games[0]!;
  const round1 = roundsByGame[game1.id]![0]!;

  const run = await startProcessingRun(db, {
    duoId,
    sessionId: started.sessionId,
    startedByPlayerId: mikoId,
    purpose: "extract",
    agent: "claude",
    model: "e2e",
    promptVersion: "e2e",
    rangeStart: new Date(anchor),
    rangeEnd: new Date(anchor + 30 * 60_000),
  });
  const learningIds = await insertRunLearnings(db, run.id, duoId, "extract", [
    {
      kind: "strategy",
      text: "Split Spain and Portugal when unsure.",
      countries: ["ES", "PT"],
      regions: [],
      topics: ["hedging"],
      origin: "speech",
      utteranceIds: [utterances[0]!.id, utterances[1]!.id],
      roundIds: [round1.id],
      sourceSpanStart: utterances[0]!.startedAt,
      sourceSpanEnd: utterances[1]!.endedAt,
    },
    {
      kind: "clue",
      text: "Toledo region has dry hills.",
      countries: ["ES"],
      regions: [],
      topics: ["landscape"],
      origin: "speech",
      utteranceIds: [utterances[3]!.id, utterances[4]!.id],
      roundIds: [],
      sourceSpanStart: utterances[3]!.startedAt,
      sourceSpanEnd: utterances[4]!.endedAt,
    },
  ]);
  await finishProcessingRun(db, run.id);

  // A second Session two hours later, with its own finished run.
  const anchor2 = Date.parse(at("21:00:00"));
  const recording2Id = uuidv7();
  const tv2Id = uuidv7();
  const started2 = await startRecording(db, soraId, {
    recordingId: recording2Id,
    transcriptVersionId: tv2Id,
    duoId,
    startedAt: new Date(anchor2).toISOString(),
    clockAnchorMs: anchor2,
    companionVersion: "0.1.0",
    model: "large-v3",
    transcriberSettings: {},
    hotwordsUsed: [],
  });
  await uploadTranscriptChunk(db, soraId, tv2Id, {
    recordingId: recording2Id,
    chunkNo: 0,
    utterances: [speech("Evening session, warming up", 30_000), speech("Bollards again", 90_000)],
  });
  await completeTranscriptVersion(db, soraId, tv2Id, { totalChunks: 1 });
  await stopRecording(db, soraId, recording2Id, {
    stoppedAt: new Date(anchor2 + 10 * 60_000).toISOString(),
    stopReason: "stop",
  });
  const run2 = await startProcessingRun(db, {
    duoId,
    sessionId: started2.sessionId,
    startedByPlayerId: soraId,
    purpose: "tips",
    agent: "claude",
    model: "e2e-evening",
    promptVersion: "e2e",
    rangeStart: new Date(anchor2),
    rangeEnd: new Date(anchor2 + 10 * 60_000),
  });
  await finishProcessingRun(db, run2.id);

  // The other Duo's Session and run, for cross-Duo checks.
  const anchor3 = Date.parse(at("18:00:00"));
  const started3 = await startRecording(db, outsiderId, {
    recordingId: uuidv7(),
    transcriptVersionId: uuidv7(),
    duoId: otherDuoId,
    startedAt: new Date(anchor3).toISOString(),
    clockAnchorMs: anchor3,
    companionVersion: "0.1.0",
    model: "large-v3",
    transcriberSettings: {},
    hotwordsUsed: [],
  });
  const otherRun = await startProcessingRun(db, {
    duoId: otherDuoId,
    sessionId: started3.sessionId,
    startedByPlayerId: outsiderId,
    purpose: "extract",
    agent: "claude",
    model: "e2e-other",
    promptVersion: "e2e",
    rangeStart: new Date(anchor3),
    rangeEnd: new Date(anchor3 + 60_000),
  });

  // Knowledge (#56 3a): a Source with an image, and Claims with Round and Source Evidence. The Claims have no
  // run, so run counts elsewhere are unchanged.
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const source = await addSourceVersion(db, mikoId, {
    duoId,
    title: "Spain guide",
    url: null,
    kind: "web",
    markdown: [
      "# Bollards",
      "Spanish bollards have a red band.",
      "",
      String.raw`![A Spanish bollard](bollard.png "Spain")`,
      "",
      "```",
      "red band",
      "```",
      "",
      "# Poles",
      "Wooden poles.",
    ].join("\n"),
  });
  const image = await addSourceImage(db, mikoId, { sourceVersionId: source.sourceVersionId, name: "bollard.png", mimeType: "image/png", base64: PNG });
  const game2 = games[1]!;
  const claimIds = { bollards: uuidv7(), roundZero: uuidv7(), white: uuidv7() };
  await db.insert(schema.claims).values([
    { id: claimIds.bollards, duoId, text: "Spanish bollards have a red band.", countries: ["ES"], topics: ["bollards"] },
    { id: claimIds.roundZero, duoId, text: "Castilla-La Mancha has dry plains.", countries: ["ES"], topics: ["landscape"] },
    { id: claimIds.white, duoId, text: "Portuguese poles are white.", countries: ["PT"], topics: ["poles"] },
  ]);
  await db.insert(schema.claimEvidence).values([
    { id: uuidv7(), claimId: claimIds.bollards, duoId, kind: "round", direction: "for", roundId: roundsByGame[game1.id]!.find((r) => r.roundNumber === 2)!.id },
    { id: uuidv7(), claimId: claimIds.bollards, duoId, kind: "documentation", direction: "for", sourceVersionId: source.sourceVersionId, sectionAnchor: "bollards" },
    { id: uuidv7(), claimId: claimIds.roundZero, duoId, kind: "round", direction: "for", roundId: roundsByGame[game2.id]!.find((r) => r.roundNumber === 0)!.id },
  ]);
  await db.insert(schema.claimImages).values({ claimId: claimIds.bollards, sourceImageId: image.imageId });
  await db.update(schema.learnings).set({ claimId: claimIds.bollards }).where(eq(schema.learnings.id, learningIds[1]!));

  const seed = {
    duoId,
    otherDuoId,
    mikoId,
    soraId,
    outsiderId,
    sessionId: started.sessionId,
    recordingId,
    runId: run.id,
    session2Id: started2.sessionId,
    run2Id: run2.id,
    otherRunId: otherRun.id,
    learningIds,
    sourceId: source.sourceId,
    sourceImageId: image.imageId,
    claimIds,
    games: games.map((g) => ({ id: g.id, geoguessrGameId: g.geoguessrGameId, rounds: roundsByGame[g.id]! })),
  };
  await writeFile(path.resolve(__dirname, ".seed.json"), JSON.stringify(seed, null, 2));
  await sql.end();
  console.log("E2E database seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
