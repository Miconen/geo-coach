import { describe, expect, it } from "vitest";
import { buildDebrief, saidAloud, saidWhileGuessing, type DebriefInput } from "../build.js";
import { mapRounds } from "$lib/debrief/view.js";
import type { DebriefLine } from "$lib/debrief/types.js";
import type { WorkbenchGame, WorkbenchRound, WorkbenchUtterance } from "../../workbench/view-model.js";

// Said aloud, not guessed (#80), on fixtures shaped like the 2026-11-23 18:31 dev Session: Game 1 · Round 1 was
// Denmark (Duo guessed Lithuania and Germany); Game 4 · Round 5 and 6 were Czechia, the first guessed right.
const MICO = "p-mico";
const CERKIE = "p-cerkie";
const START = Date.parse("2026-11-23T18:36:55.447Z");
const t = (s: number) => new Date(START + s * 1000).toISOString();

const guess = (playerId: string | null, countryCode: string) =>
  ({ isDuo: playerId !== null, playerId, countryCode, lat: 0, lng: 0, score: 1000, distanceMeters: 1, guessedAt: null, guessedFirst: false, isBestForTeam: false, timedOut: false }) as never;

function round(id: string, gameId: string, n: number, countryCode: string, start: number, guesses: unknown[], utteranceIds: string[]): WorkbenchRound {
  return {
    id,
    gameId,
    roundNumber: n,
    countryCode,
    countryName: null,
    regionCode: null,
    regionName: null,
    lat: 1,
    lng: 1,
    panoId: null,
    damageMultiplier: 1,
    startTime: t(start),
    timerStartTime: null,
    // Guessing ended 87.149 s in: 18:38:22.6.
    endTime: t(start + 87.149),
    resultsEndTime: t(start + 95),
    phases: [],
    duoBestScore: 1000,
    opponentBestScore: 2000,
    hpDelta: -1000,
    guesses: guesses as WorkbenchRound["guesses"],
    replayPlayerCount: 4,
    utteranceIds,
    learningIds: [],
    debriefLearningIds: [],
  };
}

const u = (id: string, playerId: string, s: number, text: string, historical = false) =>
  ({ id, playerId, text, startedAt: t(s), historical }) as WorkbenchUtterance;

const input: DebriefInput = {
  wb: {
    players: {
      [MICO]: { id: MICO, displayName: "Mico", avatarColor: "#2b6cb0" } as never,
      [CERKIE]: { id: CERKIE, displayName: "Cerkie", avatarColor: "#c0267a" } as never,
    },
    gamesById: {
      g1: { id: "g1", startedAt: t(0), roundIds: ["dk"], won: true, ratingDelta: 1 } as WorkbenchGame,
      g4: { id: "g4", startedAt: t(1000), roundIds: ["cz5", "cz6"], won: false, ratingDelta: -1 } as WorkbenchGame,
    },
    roundsById: {
      dk: round("dk", "g1", 1, "DK", 0, [guess(CERKIE, "DE"), guess(MICO, "LT"), guess(null, "DK")], ["dk-cerkie", "dk-mico", "dk-old"]),
      cz5: round("cz5", "g4", 5, "CZ", 1000, [guess(CERKIE, "CZ"), guess(MICO, "DE")], ["cz5-said"]),
      cz6: round("cz6", "g4", 6, "CZ", 1200, [guess(CERKIE, "DE"), guess(MICO, "AT")], ["cz6-said", "cz6-other"]),
    },
    utterancesById: {
      "dk-cerkie": u("dk-cerkie", CERKIE, 16, "…vaguely danish so maybe just germany"),
      // 18:38:28, after guessing ended at 18:38:22.6: a reaction to the reveal.
      "dk-mico": u("dk-mico", MICO, 92.6, "Denmark makes sense"),
      // An old Transcript version that still says Denmark: never counts.
      "dk-old": u("dk-old", MICO, 20, "Denmark", true),
      "cz5-said": u("cz5-said", CERKIE, 1030, "czechia"),
      "cz6-said": u("cz6-said", CERKIE, 1240, "czechia"),
      "cz6-other": u("cz6-other", MICO, 1250, "no, germany"),
    },
    learnings: [],
  },
  games: [
    { id: "g1", number: 1 },
    { id: "g4", number: 4 },
  ],
  meta: new Map(),
  sessionId: "s1",
};

describe("said aloud, not guessed", () => {
  const d = buildDebrief(input);
  const byId = (id: string) => d.rounds.find((r) => r.id === id)!;

  it("flags Game 1 · Round 1 by Cerkie's danish at 0:16, and only that line", () => {
    const r = byId("dk");
    expect(r.saidAloud.map((l) => [l.id, l.playerId, l.text])).toEqual([["dk-cerkie", CERKIE, "…vaguely danish so maybe just germany"]]);
    expect(r.saidAloud[0]!.atS).toBe(16);
  });

  it("ignores an Opponent hitting the answer: only the Duo's guesses decide", () => {
    expect(byId("dk").missedAnswer).toBe(true);
  });

  it("never counts speech after guessing ended by itself", () => {
    const after: DebriefLine = { id: "x", playerId: MICO, text: "Denmark makes sense", atS: 92.6, afterEnd: true };
    expect(saidAloud([after], "DK")).toEqual([]);
  });

  it("never flags a Round the Duo guessed right (Game 4 · Round 5)", () => {
    expect(byId("cz5").saidAloud).toEqual([]);
  });

  it("flags Game 4 · Round 6, where Cerkie said czechia and the Duo guessed elsewhere", () => {
    expect(byId("cz6").saidAloud.map((l) => l.id)).toEqual(["cz6-said"]);
  });

  it("gives the map every country said while guessing, so the Outcome lens can outline the ones not guessed", () => {
    const said = Object.fromEntries(mapRounds(d, d.rounds).map((m) => [m.id, m.said]));
    expect(said).toEqual({ dk: ["DK", "DE"], cz5: ["CZ"], cz6: ["CZ", "DE"] });
  });
});

describe("every country said while guessing (#86)", () => {
  const line = (id: string, atS: number, text: string, afterEnd = false): DebriefLine => ({ id, playerId: MICO, text, atS, afterEnd });

  it("finds several countries in one Round, each with the Utterances that named it, in order of first mention", () => {
    const transcript = [
      line("a", 5, "looks like thailand or maybe laos"),
      line("b", 12, "no, indonesia"),
      line("c", 20, "thailand plates though"),
    ];
    expect(saidWhileGuessing(transcript).map((c) => [c.code, c.lines.map((l) => l.id)])).toEqual([
      ["TH", ["a", "c"]],
      ["LA", ["a"]],
      ["ID", ["b"]],
    ]);
  });

  it("ignores speech after guessing ends", () => {
    const transcript = [line("a", 5, "thailand"), line("b", 90, "oh it was bangladesh", true), line("c", 91, "thailand again", true)];
    expect(saidWhileGuessing(transcript).map((c) => [c.code, c.lines.map((l) => l.id)])).toEqual([["TH", ["a"]]]);
  });

  it("is what the Round's said-aloud lines come from: the answer's entry", () => {
    const r = buildDebrief(input).rounds.find((x) => x.id === "cz6")!;
    expect(r.saidWhileGuessing.map((c) => c.code)).toEqual(["CZ", "DE"]);
    expect(r.saidAloud).toEqual(r.saidWhileGuessing[0]!.lines);
  });
});
