import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7, type WordTiming } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duoMemberships, duos, players, recordings, rounds, utterances } from "../../db/schema.js";
import { mcpReadRange, mcpStartRun } from "../../mcp/workflow.js";
import { buildWorkbenchData } from "../../workbench/view-model.js";
import {
  applySuggestionOnce,
  completeTranscriptVersion,
  deleteUtteranceEdit,
  dismissSuggestion,
  fixUtterance,
  listTranscriptRules,
  listTranscriptSuggestions,
  listUtteranceEdits,
  loadRuleHotwords,
  loadTranscriptCorrector,
  saveTranscriptRule,
  startRecording,
  startRetranscription,
  stopRecording,
  uploadTranscriptChunk,
  upsertRawGame,
} from "../index.js";

const anchor = Date.parse("2026-11-20T19:00:00.000Z");

function timedWords(text: string, startMs: number): WordTiming[] {
  return text.split(" ").map((word, i) => ({
    word: ` ${word}`,
    startMs: startMs + i * 300,
    endMs: startMs + i * 300 + 250,
    probability: 0.5,
  }));
}

function utterance(text: string, startSampleMs: number) {
  return {
    text,
    startSampleMs,
    endSampleMs: startSampleMs + 3000,
    words: timedWords(text, startSampleMs),
    avgLogprob: -0.2,
  };
}

describe("Transcript corrections", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let playerId: string;
  let sessionId: string;
  let recordingId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    playerId = uuidv7();
    recordingId = uuidv7();
    const transcriptVersionId = uuidv7();

    await handle.db.insert(duos).values({
      id: duoId,
      name: "Test Duo",
      geoguessrTeamId: "team_duo",
      hotwords: [],
    });
    await handle.db.insert(players).values({
      id: playerId,
      discordId: "discord_test",
      displayName: "Tester",
      geoguessrUserId: "gg_p1",
      geoguessrName: "Tester",
    });
    await handle.db.insert(duoMemberships).values({ duoId, playerId });

    const started = await startRecording(handle.db, playerId, {
      recordingId,
      transcriptVersionId,
      duoId,
      startedAt: new Date(anchor).toISOString(),
      clockAnchorMs: anchor,
      companionVersion: "0.1.0",
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    sessionId = started.sessionId;

    await uploadTranscriptChunk(handle.db, playerId, transcriptVersionId, {
      recordingId,
      chunkNo: 0,
      utterances: [
        utterance("this is nymphs today", 185_000),
        utterance("feels like Goyaz maybe", 190_000),
      ],
    });
    await completeTranscriptVersion(handle.db, playerId, transcriptVersionId, { totalChunks: 1 });
    await stopRecording(handle.db, playerId, recordingId, {
      stoppedAt: new Date(anchor + 300_000).toISOString(),
      stopReason: "stop",
    });
    await handle.db
      .update(recordings)
      .set({ isCalibrated: true })
      .where(eq(recordings.id, recordingId));

    await upsertRawGame(handle.db, {
      duoId,
      geoguessrGameId: "duel_1",
      fetchedAt: "2026-11-20T19:04:30.000Z",
      rawDuel: {
        gameId: "duel_1",
        status: "Finished",
        options: { isTeamDuels: true, isRated: true },
        teams: [
          {
            id: "team_duo",
            name: "Test Duo",
            health: 5000,
            players: [
              {
                playerId: "gg_p1",
                nick: "Tester",
                guesses: [
                  {
                    roundNumber: 1,
                    lat: -15.6,
                    lng: -56.1,
                    distance: 15_000,
                    score: 4930,
                    created: "2026-11-20T19:03:20.000Z",
                  },
                ],
              },
            ],
          },
          { id: "team_opp", name: "Opp", health: 4000, players: [] },
        ],
        rounds: [
          {
            roundNumber: 1,
            panorama: { panoId: "p1", lat: -15.6, lng: -56.1, countryCode: "br" },
            startTime: "2026-11-20T19:03:00.000Z",
            timerStartTime: "2026-11-20T19:03:20.000Z",
            endTime: "2026-11-20T19:03:35.000Z",
            damageMultiplier: 1,
          },
        ],
        result: { winningTeamId: "team_duo" },
      },
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  const rawRows = () =>
    handle.db.query.utterances.findMany({ where: eq(utterances.recordingId, recordingId) });

  it("gives coaching agents and the workbench corrected text and keeps the raw Transcript", async () => {
    const started = await mcpStartRun(handle.db, playerId, {
      sessionId,
      startUtc: "2026-11-20T19:01:30.000Z",
      endUtc: "2026-11-20T19:05:00.000Z",
      purpose: "extract",
      agent: "claude",
      model: "claude-sonnet",
    });
    const read = await mcpReadRange(handle.db, playerId, started.runId);
    expect(JSON.stringify(read)).toContain("this is NMPZ today");
    expect(JSON.stringify(read)).not.toContain("nymphs");

    const workbench = await buildWorkbenchData(handle.db, duoId, playerId);
    const shown = Object.values(workbench.utterancesById).find((u) => u.rawText.includes("nymphs"));
    expect(shown?.text).toBe("this is NMPZ today");

    expect((await rawRows()).some((u) => u.text === "this is nymphs today")).toBe(true);
  });

  it("lets a Duo disable a starter rule", async () => {
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "nymphs",
      replacement: "NMPZ",
      enabled: false,
    });
    const correct = await loadTranscriptCorrector(handle.db, duoId);
    expect(correct({ id: uuidv7(), text: "this is nymphs" }).text).toBe("this is nymphs");
    const rule = (await listTranscriptRules(handle.db, duoId)).find((r) => r.source === "nymphs");
    expect(rule).toMatchObject({ enabled: false, starter: true });
  });

  it("suggests a Region from the Round and stops once it is ruled on", async () => {
    const [suggestion] = await listTranscriptSuggestions(handle.db, duoId);
    expect(suggestion).toMatchObject({ source: "goyaz", replacement: "Goiás", count: 1 });

    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: suggestion!.source,
      replacement: suggestion!.replacement,
    });
    expect(await listTranscriptSuggestions(handle.db, duoId)).toEqual([]);
    const correct = await loadTranscriptCorrector(handle.db, duoId);
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    expect(correct(row).text).toBe("feels like Goiás maybe");
  });

  it("does not auto-apply suggestions, and a dismissal is remembered", async () => {
    const correct = await loadTranscriptCorrector(handle.db, duoId);
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    expect(correct(row).text).toBe("feels like Goyaz maybe");

    await dismissSuggestion(handle.db, { duoId, source: "Goyaz", replacement: "Goiás" });
    await dismissSuggestion(handle.db, { duoId, source: "Goyaz", replacement: "Goiás" });
    expect(await listTranscriptSuggestions(handle.db, duoId)).toEqual([]);
  });

  it("abstains on an uncalibrated Recording", async () => {
    await handle.db
      .update(recordings)
      .set({ isCalibrated: false })
      .where(eq(recordings.id, recordingId));
    expect(await listTranscriptSuggestions(handle.db, duoId)).toEqual([]);
  });

  it("applies a one-off fix idempotently, validates it, and can undo it", async () => {
    const [suggestion] = await listTranscriptSuggestions(handle.db, duoId);
    const input = { duoId, playerId, replacement: "Goiás", occurrences: suggestion!.occurrences };
    expect((await applySuggestionOnce(handle.db, input)).applied).toBe(1);
    expect((await applySuggestionOnce(handle.db, input)).applied).toBe(0);

    await expect(
      applySuggestionOnce(handle.db, {
        ...input,
        occurrences: [{ ...suggestion!.occurrences[0]!, originalText: "something else" }],
      }),
    ).rejects.toMatchObject({ status: 409 });

    const otherDuo = uuidv7();
    await handle.db
      .insert(duos)
      .values({ id: otherDuo, name: "Other", geoguessrTeamId: "team_other", hotwords: [] });
    await expect(
      applySuggestionOnce(handle.db, { ...input, duoId: otherDuo }),
    ).rejects.toMatchObject({ status: 409 });

    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    expect((await loadTranscriptCorrector(handle.db, duoId))(row).text).toBe("feels like Goiás maybe");

    const { edits } = await listUtteranceEdits(handle.db, duoId);
    await deleteUtteranceEdit(handle.db, duoId, edits[0]!.id);
    expect((await loadTranscriptCorrector(handle.db, duoId))(row).text).toBe("feels like Goyaz maybe");
  });

  it("keeps rules but not one-off fixes across a retranscription", async () => {
    const [suggestion] = await listTranscriptSuggestions(handle.db, duoId);
    await applySuggestionOnce(handle.db, {
      duoId,
      playerId,
      replacement: "Goiás",
      occurrences: suggestion!.occurrences,
    });

    const transcriptVersionId = uuidv7();
    await startRetranscription(handle.db, playerId, {
      transcriptVersionId,
      recordingId,
      model: "large-v3",
      transcriberSettings: {},
      hotwordsUsed: [],
    });
    await uploadTranscriptChunk(handle.db, playerId, transcriptVersionId, {
      recordingId,
      chunkNo: 0,
      utterances: [
        utterance("still nymphs here", 185_000),
        utterance("feels like Goyaz maybe", 190_000),
      ],
    });
    await completeTranscriptVersion(handle.db, playerId, transcriptVersionId, { totalChunks: 1 });

    const workbench = await buildWorkbenchData(handle.db, duoId, playerId);
    const texts = Object.values(workbench.utterancesById).map((u) => u.text);
    expect(texts).toContain("still NMPZ here");
    expect(texts).toContain("feels like Goyaz maybe");
    expect(texts).not.toContain("feels like Goiás maybe");
    expect((await listUtteranceEdits(handle.db, duoId)).total).toBe(0);

    await expect(
      applySuggestionOnce(handle.db, {
        duoId,
        playerId,
        replacement: "Goiás",
        occurrences: suggestion!.occurrences,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      fixUtterance(handle.db, {
        duoId,
        playerId,
        utteranceId: suggestion!.occurrences[0]!.utteranceId,
        find: "Goyaz",
        replacement: "Goiás",
        scope: "always",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a rule shadowed by a different one-off fix, but allows a matching one", async () => {
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    const input = { duoId, playerId, utteranceId: row.id, find: "Goyaz" };
    await fixUtterance(handle.db, { ...input, replacement: "Goiânia", scope: "once" });

    await expect(
      fixUtterance(handle.db, { ...input, replacement: "Goiás", scope: "always" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listTranscriptRules(handle.db, duoId)).some((r) => r.source === "goyaz")).toBe(
      false,
    );
    await expect(
      fixUtterance(handle.db, { ...input, replacement: "Goiânia", scope: "always" }),
    ).resolves.toEqual({ applied: 1 });
  });

  it("does not count a one-off fix at a position the rule cannot match", async () => {
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    await handle.db
      .update(utterances)
      .set({ text: "San, Jose? Probably San Jose." })
      .where(eq(utterances.id, row.id));
    const input = { duoId, playerId, utteranceId: row.id };
    await fixUtterance(handle.db, {
      ...input,
      find: "San, Jose",
      replacement: "San José",
      scope: "once",
    });
    await fixUtterance(handle.db, {
      ...input,
      find: "San Jose",
      replacement: "São José",
      scope: "once",
    });
    await expect(
      fixUtterance(handle.db, {
        ...input,
        find: "San Jose",
        replacement: "San José",
        scope: "always",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not let another rule on the same line count as success", async () => {
    await handle.db
      .update(recordings)
      .set({ isCalibrated: false })
      .where(eq(recordings.id, recordingId));
    const row = (await rawRows()).find((u) => u.text.includes("nymphs"))!;
    await expect(
      fixUtterance(handle.db, {
        duoId,
        playerId,
        utteranceId: row.id,
        find: "today",
        replacement: "NMPZ",
        scope: "country",
        countryCode: "BR",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an inline rule that would not change that line", async () => {
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    const input = {
      duoId,
      playerId,
      utteranceId: row.id,
      find: "Goyaz",
      replacement: "Goiás",
    };

    await expect(
      fixUtterance(handle.db, { ...input, scope: "country", countryCode: "JP" }),
    ).rejects.toMatchObject({ status: 409 });

    const [existingRound] = await handle.db.query.rounds.findMany();
    await handle.db.insert(rounds).values({
      id: uuidv7(),
      gameId: existingRound!.gameId,
      duoId,
      roundNumber: 2,
      countryCode: "JP",
      startTime: new Date("2026-11-20T19:02:00.000Z"),
      endTime: new Date("2026-11-20T19:03:05.000Z"),
      resultsEndTime: new Date(row.startedAt.getTime() - 1000),
      guesses: [],
    });
    await expect(
      fixUtterance(handle.db, { ...input, scope: "country", countryCode: "BR" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listTranscriptRules(handle.db, duoId)).some((r) => r.source === "goyaz")).toBe(
      false,
    );
    await expect(fixUtterance(handle.db, { ...input, scope: "always" })).resolves.toEqual({
      applied: 1,
    });
  });

  it("applies a country rule only inside a calibrated Round of that country", async () => {
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "goyaz",
      replacement: "Goiás",
      countryCode: "br",
    });
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "goyaz",
      replacement: "Elsewhere",
      countryCode: "JP",
    });
    expect(await listTranscriptRules(handle.db, duoId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "goyaz", replacement: "Goiás", countryCode: "BR" }),
        expect.objectContaining({ source: "goyaz", replacement: "Elsewhere", countryCode: "JP" }),
      ]),
    );

    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    expect((await loadTranscriptCorrector(handle.db, duoId))(row).text).toBe(
      "feels like Goiás maybe",
    );

    const outsideRound = { ...row, startedAt: new Date(anchor), endedAt: new Date(anchor + 1000) };
    expect((await loadTranscriptCorrector(handle.db, duoId))(outsideRound).text).toBe(
      "feels like Goyaz maybe",
    );

    await handle.db
      .update(recordings)
      .set({ isCalibrated: false })
      .where(eq(recordings.id, recordingId));
    expect((await loadTranscriptCorrector(handle.db, duoId))(row).text).toBe(
      "feels like Goyaz maybe",
    );
  });

  it("uses spoken word times for country rules, so trailing silence cannot disable them", async () => {
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "goyaz",
      replacement: "Goiás",
      countryCode: "BR",
    });
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    const padded = { ...row, endedAt: new Date(Date.parse("2026-11-20T19:04:30.000Z")) };
    expect((await loadTranscriptCorrector(handle.db, duoId))(padded).text).toBe(
      "feels like Goiás maybe",
    );
  });

  it("rejects out-of-range and conflicting one-off fixes without partial writes", async () => {
    const [suggestion] = await listTranscriptSuggestions(handle.db, duoId);
    const occurrence = suggestion!.occurrences[0]!;
    const base = { duoId, playerId, replacement: "Goiás" };

    await expect(
      applySuggestionOnce(handle.db, {
        ...base,
        occurrences: [{ ...occurrence, charEnd: 2_147_483_648 }],
      }),
    ).rejects.toMatchObject({ status: 409 });

    const nymphsRow = (await rawRows()).find((u) => u.text.includes("nymphs"))!;
    await expect(
      applySuggestionOnce(handle.db, {
        ...base,
        occurrences: [
          { utteranceId: nymphsRow.id, charStart: 0, charEnd: 4, originalText: "this" },
          { utteranceId: nymphsRow.id, charStart: 8, charEnd: 99, originalText: "nymphs today" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      applySuggestionOnce(handle.db, {
        ...base,
        occurrences: [
          { utteranceId: nymphsRow.id, charStart: 0, charEnd: 4, originalText: "this" },
          { utteranceId: nymphsRow.id, charStart: 2, charEnd: 7, originalText: "is is" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listUtteranceEdits(handle.db, duoId)).total).toBe(0);

    await applySuggestionOnce(handle.db, { ...base, occurrences: [occurrence] });
    await expect(
      applySuggestionOnce(handle.db, {
        ...base,
        replacement: "Something Else",
        occurrences: [occurrence],
      }),
    ).rejects.toMatchObject({ status: 409 });

    const nymphs = (await rawRows()).find((u) => u.text.includes("nymphs"))!;
    await expect(
      applySuggestionOnce(handle.db, {
        ...base,
        replacement: "Something Else",
        occurrences: [
          { utteranceId: nymphs.id, charStart: 8, charEnd: 14, originalText: "nymphs" },
          occurrence,
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listUtteranceEdits(handle.db, duoId)).total).toBe(1);
  });

  it("keeps every one-off fix reachable past the first page", async () => {
    const rows = await rawRows();
    await applySuggestionOnce(handle.db, {
      duoId,
      playerId,
      replacement: "x",
      occurrences: rows.map((u) => ({
        utteranceId: u.id,
        charStart: 0,
        charEnd: 4,
        originalText: u.text.slice(0, 4),
      })),
    });
    const firstPage = await listUtteranceEdits(handle.db, duoId, 1);
    expect(firstPage).toMatchObject({ total: 2 });
    expect(firstPage.edits).toHaveLength(1);
    expect((await listUtteranceEdits(handle.db, duoId, 2)).edits).toHaveLength(2);
  });

  it("fixes a phrase from the Session view, once or as a rule", async () => {
    const row = (await rawRows()).find((u) => u.text.includes("Goyaz"))!;
    const input = { duoId, playerId, utteranceId: row.id, find: "Goyaz", replacement: "Goiás" };

    await expect(
      fixUtterance(handle.db, { ...input, find: "not there", scope: "once" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(fixUtterance(handle.db, { ...input, scope: "country" })).rejects.toMatchObject({
      status: 400,
    });

    await expect(
      fixUtterance(handle.db, { ...input, find: "oyaz", scope: "always" }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await listTranscriptRules(handle.db, duoId)).some((r) => r.source === "oyaz")).toBe(
      false,
    );
    await expect(
      fixUtterance(handle.db, { ...input, replacement: "  Goyaz  ", scope: "always" }),
    ).rejects.toMatchObject({ status: 400 });
    const spaced = (await rawRows()).find((u) => u.text.includes("feels like"))!;
    await expect(
      fixUtterance(handle.db, {
        ...input,
        utteranceId: spaced.id,
        find: "feels like",
        replacement: "feels   like",
        scope: "always",
      }),
    ).rejects.toMatchObject({ status: 400 });

    await fixUtterance(handle.db, { ...input, scope: "once" });
    expect((await loadTranscriptCorrector(handle.db, duoId))(row).text).toBe(
      "feels like Goiás maybe",
    );
    expect(await listTranscriptSuggestions(handle.db, duoId)).toEqual([]);

    await fixUtterance(handle.db, { ...input, scope: "country", countryCode: "BR" });
    expect(await listTranscriptRules(handle.db, duoId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "goyaz", countryCode: "BR" })]),
    );

    await expect(
      fixUtterance(handle.db, { ...input, utteranceId: uuidv7(), scope: "once" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("primes hotwords from a Duo's own enabled rules only", async () => {
    await saveTranscriptRule(handle.db, { duoId, playerId, source: "goyaz", replacement: "Goiás" });
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "off rule",
      replacement: "Disabled",
      enabled: false,
    });
    await saveTranscriptRule(handle.db, {
      duoId,
      playerId,
      source: "nymphs",
      replacement: "NMPZ",
      enabled: true,
    });
    expect((await loadRuleHotwords(handle.db, [duoId])).get(duoId)).toEqual(["Goiás"]);
  });
});
