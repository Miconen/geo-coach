import { describe, expect, it } from "vitest";
import type { PanoView } from "@geo-coach/shared";
import { buildDebrief, type DebriefInput } from "../build.js";
import { countryPopup, countryView, mapRounds, missedCountries, placeCallouts, record, roundName, signed, stepRound } from "$lib/debrief/view.js";
import type { WorkbenchGame, WorkbenchLearning, WorkbenchRound, WorkbenchUtterance } from "../../workbench/view-model.js";

// Fixtures shaped on the 2026-11-23 18:31 dev Session (#79): Game 1 · Round 1 was Denmark, Mico guessed Lithuania
// first at 72.1 s and Cerkie's Timed-out guess in Germany was the team's best.
const MICO = "p-mico";
const CERKIE = "p-cerkie";
const t = (s: number) => new Date(Date.parse("2026-11-23T18:36:55.447Z") + s * 1000).toISOString();

function guess(o: Partial<WorkbenchRound["guesses"][number]> & { isDuo: boolean }): WorkbenchRound["guesses"][number] {
  return {
    geoguessrPlayerId: "gg",
    playerId: null,
    nick: null,
    countryCode: null,
    regionCode: null,
    regionName: null,
    lat: 0,
    lng: 0,
    score: 0,
    distanceMeters: null,
    guessedAt: null,
    guessedFirst: false,
    isBestForTeam: false,
    timedOut: false,
    ...o,
  };
}

function round(o: Partial<WorkbenchRound> & { id: string; gameId: string; roundNumber: number }): WorkbenchRound {
  return {
    countryCode: null,
    countryName: null,
    regionCode: null,
    regionName: null,
    lat: 0,
    lng: 0,
    panoId: null,
    damageMultiplier: 1,
    startTime: t(0),
    timerStartTime: null,
    endTime: t(87),
    resultsEndTime: t(95),
    phases: [],
    duoBestScore: 0,
    opponentBestScore: 0,
    hpDelta: 0,
    guesses: [],
    replayPlayerCount: 4,
    utteranceIds: [],
    learningIds: [],
    debriefLearningIds: [],
    ...o,
  };
}

const denmark = round({
  id: "r1",
  gameId: "g1",
  roundNumber: 1,
  countryCode: "DK",
  countryName: "Denmark",
  lat: 55.6,
  lng: 12.1,
  timerStartTime: t(72.149),
  endTime: t(87.149),
  duoBestScore: 4029,
  opponentBestScore: 2458,
  hpDelta: 1571,
  guesses: [
    guess({ isDuo: true, playerId: MICO, countryCode: "LT", score: 3059, distanceMeters: 909136, guessedAt: t(72.149) as never, guessedFirst: true, lat: 54.9, lng: 23.4 }),
    guess({ isDuo: true, playerId: CERKIE, countryCode: "DE", score: 4029, distanceMeters: 399554, guessedAt: t(88.199) as never, isBestForTeam: true, timedOut: true, lat: 53.6, lng: 11.1 }),
    guess({ isDuo: false, countryCode: "RO", score: 2192, distanceMeters: 1525748, guessedAt: t(88.199) as never, timedOut: true, lat: 46.1, lng: 22.9 }),
    guess({ isDuo: false, countryCode: "HU", score: 2458, distanceMeters: 1313723, guessedAt: t(86.399) as never, isBestForTeam: true, lat: 46.9, lng: 19.3 }),
  ],
  utteranceIds: ["u2", "u1"],
});
const czechia = round({
  id: "r2",
  gameId: "g1",
  roundNumber: 2,
  countryCode: "CZ",
  countryName: "Czechia",
  startTime: t(200),
  endTime: t(260),
  duoBestScore: 1000,
  opponentBestScore: 3000,
  hpDelta: -2000,
  guesses: [guess({ isDuo: true, playerId: MICO, countryCode: "DE", score: 1000, distanceMeters: 300000, guessedAt: t(250) as never })],
});
const round0 = round({ id: "r0", gameId: "g1", roundNumber: 0, hpDelta: -500 });
const later = round({ id: "r3", gameId: "g2", roundNumber: 1, countryCode: "DE", countryName: "Germany", duoBestScore: 5000, opponentBestScore: 10, hpDelta: 4990, guesses: [guess({ isDuo: true, playerId: CERKIE, countryCode: "DE", score: 5000 })] });

const game = (id: string, startedAt: string, roundIds: string[], won: boolean, ratingDelta: number): WorkbenchGame =>
  ({ id, startedAt, roundIds, won, ratingDelta, opponentTeamName: "red" }) as WorkbenchGame;

const utterance = (id: string, playerId: string, s: number, text: string) =>
  ({ id, playerId, text, startedAt: t(s), historical: false }) as WorkbenchUtterance;

const learning = (id: string, o: Partial<WorkbenchLearning>) =>
  ({ id, status: "current", roundIds: [], sessionIds: ["s1"], countries: [], kind: "tip", text: id, ...o }) as WorkbenchLearning;

const input: DebriefInput = {
  wb: {
    players: {
      [MICO]: { id: MICO, displayName: "Mico", avatarColor: "#2b6cb0" } as never,
      [CERKIE]: { id: CERKIE, displayName: "Cerkie", avatarColor: "#c0267a" } as never,
    },
    gamesById: { g1: game("g1", t(0), ["r0", "r1", "r2"], true, 18), g2: game("g2", t(600), ["r3"], false, -16) },
    roundsById: { r0: round0, r1: denmark, r2: czechia, r3: later },
    utterancesById: {
      u1: utterance("u1", CERKIE, 16, "vaguely danish so maybe just germany"),
      u2: utterance("u2", MICO, 92, "Denmark makes sense"),
    },
    learnings: [
      learning("l1", { roundIds: ["r1"], countries: ["DK", "de"] }),
      learning("l2", {}),
      learning("l3", { roundIds: ["r1"], status: "superseded" }),
    ],
  },
  games: [
    { id: "g2", number: 2 },
    { id: "g1", number: 1 },
  ],
  meta: new Map([["g1", { mode: "nm" as const, mapName: "Supersonic", panoViews: new Map<number, PanoView>([[1, { heading: 1, pitch: 2, zoom: 0 }]]) }]]),
  sessionId: "s1",
};

describe("buildDebrief", () => {
  const d = buildDebrief(input);
  const r1 = d.rounds.find((r) => r.id === "r1")!;

  it("lists Games in number order, each with its Rounds numbered above zero", () => {
    expect(d.games.map((g) => [g.number, g.roundIds])).toEqual([
      [1, ["r1", "r2"]],
      [2, ["r3"]],
    ]);
    expect(roundName(r1)).toBe("Game 1 · Round 1");
    expect(r1.roundCount).toBe(2);
  });

  it("carries each guess's time, first-guess and Timed-out marks, Duo first", () => {
    const [cerkie, mico, ...opp] = r1.guesses;
    expect(r1.guesses.map((g) => g.isDuo)).toEqual([true, true, false, false]);
    expect(cerkie).toMatchObject({ playerId: CERKIE, isBestForTeam: true, timedOut: true, countryCode: "DE" });
    expect(cerkie!.secondsToGuess).toBeCloseTo(88.2, 1);
    expect(mico).toMatchObject({ playerId: MICO, guessedFirst: true, countryCode: "LT" });
    expect(mico!.secondsToGuess).toBeCloseTo(72.1, 1);
    expect(cerkie!.slower).toBe(true);
    expect(opp.every((g) => g.playerId === null)).toBe(true);
  });

  it("works out HP before and after from the Game's earlier Rounds, Round 0 included", () => {
    expect(r1.hpBefore).toEqual({ duo: 5500, opponents: 6000 });
    expect(r1.hpAfter).toEqual({ duo: 5500, opponents: 4429 });
    expect(r1).toMatchObject({ hpDelta: 1571, won: true, mode: "nm", mapName: "Supersonic", panoView: { heading: 1 } });
  });

  it("orders the transcript and marks speech after guessing ended", () => {
    expect(r1.transcript.map((l) => [l.id, l.afterEnd])).toEqual([
      ["u1", false],
      ["u2", true],
    ]);
    expect(r1.endS).toBeCloseTo(87.149);
    expect(r1.countdownS).toBeCloseTo(72.149);
  });

  it("keeps only current Learnings: the Round's and the Session's uncited ones", () => {
    expect(r1.learningIds).toEqual(["l1"]);
    expect(d.sessionLearningIds).toEqual(["l2"]);
    expect(Object.keys(d.learnings).sort()).toEqual(["l1", "l2"]);
    expect(d.games[0]!.learningCount).toBe(1);
  });

  it("marks wrong-country and missed Rounds", () => {
    expect(r1).toMatchObject({ bestCountry: "DE", bestKm: 400, wrongCountry: true, missedAnswer: true });
    expect(d.rounds.find((r) => r.id === "r3")).toMatchObject({ wrongCountry: false, missedAnswer: false });
  });

  it("names no Opponent", () => {
    expect(JSON.stringify(d)).not.toContain("red");
  });
});

describe("debrief view helpers", () => {
  const d = buildDebrief(input);

  it("tallies the Session", () => {
    expect(record(d)).toEqual({ won: 1, lost: 1, ratingDelta: 2, rounds: 3, learnings: 2 });
    expect(signed(1571)).toBe("+1,571");
    expect(signed(-12)).toBe("−12");
  });

  it("splits a country's Rounds into answer and guess", () => {
    const de = countryView(d, "de")!;
    expect(de.name).toBe("Germany");
    expect(de.asAnswer.map((r) => r.id)).toEqual(["r3"]);
    expect(de.asGuess.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(de.learnings.map((l) => l.id)).toEqual(["l1"]);
    expect(countryView(d, "JP")).toBeNull();
  });

  it("groups the missed answer countries, most missed first", () => {
    expect(missedCountries(d.rounds).map((m) => [m.code, m.rounds.length])).toEqual([
      ["CZ", 1],
      ["DK", 1],
    ]);
  });

  it("gives the map Player colours, initials and the countries said while guessing, never Learning countries", () => {
    const [m] = mapRounds(d, [d.rounds[0]!]);
    expect(m!.title).toBe("Game 1 · Round 1");
    expect(m!.guesses[0]).toMatchObject({ isDuo: true, color: "#c0267a", initial: "C" });
    expect(m!.guesses[2]).toMatchObject({ isDuo: false, color: undefined });
    expect(m!.said).toEqual(["DK", "DE"]);
    expect(m).not.toHaveProperty("learningCountries");
  });

  it("explains a clicked country in a Round: who guessed there, and for an outlined one the Utterances naming it", () => {
    const r1 = d.rounds[0]!;
    const de = countryPopup(d, r1, "de");
    expect(de.guessedBy.map((g) => g.playerId)).toEqual([CERKIE]);
    // Guessed, so not outlined: no quotes, though Cerkie said germany.
    expect(de.said).toEqual([]);
    const line = { id: "x", playerId: MICO, text: "sweden?", atS: 30, afterEnd: false };
    const se = countryPopup(d, { ...r1, saidWhileGuessing: [{ code: "SE", lines: [line] }] }, "se");
    expect(se.guessedBy).toEqual([]);
    expect(se.said).toEqual([line]);
  });

  it("steps through Rounds, wrapping", () => {
    const seq = [{ id: "a" }, { id: "b" }];
    expect(stepRound(seq, null, 1)).toBe("a");
    expect(stepRound(seq, null, -1)).toBe("b");
    expect(stepRound(seq, "b", 1)).toBe("a");
    expect(stepRound([], null, 1)).toBeNull();
  });

  it("pushes overlapping callouts apart", () => {
    const out = placeCallouts(
      [
        { item: "b", x: 100, y: 110 },
        { item: "a", x: 100, y: 100 },
        { item: "far", x: 900, y: 105 },
      ],
      46,
    );
    expect(out.map((c) => [c.item, c.y])).toEqual([
      ["a", 100],
      ["far", 105],
      ["b", 146],
    ]);
  });
});

describe("buildDebrief: the Clue lens's data (#89)", () => {
  const quote = (id: string, playerId: string, s: number, text: string) => ({ id, playerId, text, startedAt: new Date(t(s)) });
  const d = buildDebrief({
    ...input,
    clueLens: {
      byRound: new Map([
        ["r1", [{ clueId: "k-white", runId: "run", note: null, utteranceIds: ["u1"], quotes: [quote("u1", CERKIE, 16, "white centre line")] }]],
        ["r-elsewhere", [{ clueId: "k-other", runId: "run", note: null, utteranceIds: [], quotes: [] }]],
      ]),
      clues: [
        { id: "k-white", family: "Road lines", name: "White centre line" },
        { id: "k-other", family: "Poles", name: "Wooden pole" },
      ],
      links: [
        { claimId: "c1", clueId: "k-white", country: "DK", prevalence: "typical" },
        { claimId: "c2", clueId: "k-other", country: "US", prevalence: "typical" },
      ],
      claims: [
        { id: "c1", text: "Denmark has white centre lines.", status: "verified" },
        { id: "c2", text: "US poles are wooden.", status: "speculated" },
      ],
    },
  });

  it("gives each Round its Clues with the quoted speech, timed from the Round's start", () => {
    const r1 = d.rounds.find((r) => r.id === "r1")!;
    expect(r1.clues.map((c) => [c.clueId, c.lines.map((l) => [l.text, Math.round(l.atS)])])).toEqual([["k-white", [["white centre line", 16]]]]);
    expect(d.rounds.find((r) => r.id === "r2")!.clues).toEqual([]);
  });

  it("ships only the Clues the shown Rounds said, their links with Claim status, and the linked Claims", () => {
    expect(Object.keys(d.clueLens.clues)).toEqual(["k-white"]);
    expect(d.clueLens.links).toEqual([{ claimId: "c1", clueId: "k-white", country: "DK", prevalence: "typical", status: "verified" }]);
    expect(d.clueLens.claimText).toEqual({ c1: "Denmark has white centre lines." });
    expect(buildDebrief(input).clueLens).toEqual({ clues: {}, links: [], claimText: {} });
  });
});
