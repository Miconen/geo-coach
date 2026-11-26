import { describe, expect, it } from "vitest";
import { buildGamesList } from "../games-list.js";
import type { WorkbenchData, WorkbenchGame, WorkbenchLearning, WorkbenchRound, WorkbenchSession } from "$lib/server/workbench/view-model.js";

const D = "00000000-0000-7000-8000-000000000001";
const at = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h, m)).toISOString();

function round(id: string, gameId: string, roundNumber: number, hpDelta: number, guessCountry = "DE"): WorkbenchRound {
  return {
    id,
    gameId,
    roundNumber,
    countryCode: "DK",
    countryName: "Denmark",
    lat: 56,
    lng: 10,
    hpDelta,
    guesses: [
      { playerId: "p1", isDuo: true, countryCode: guessCountry, lat: 51, lng: 10, score: 3000, distanceMeters: 500_000 },
      { playerId: null, isDuo: false, countryCode: "SE", lat: 59, lng: 18, score: 2000, distanceMeters: 700_000 },
    ],
  } as unknown as WorkbenchRound;
}

function game(id: string, startedAt: string, sessionIds: string[], won: boolean | null, ratingDelta: number | null, roundIds: string[]): WorkbenchGame {
  return {
    id,
    startedAt,
    won,
    ratingDelta,
    roundIds,
    sessionIds,
    ratingSessionId: sessionIds[0] ?? null,
    opponentTeamName: "red",
  } as unknown as WorkbenchGame;
}

const session = (id: string, startedAt: string, gameIds: string[], ratingDelta: number) =>
  ({ id, startedAt, gameIds, ratingDelta }) as unknown as WorkbenchSession;

function fixture(): Pick<WorkbenchData, "gamesById" | "roundsById" | "sessions" | "learnings" | "players"> {
  const games = [
    game("g1", at(23, 18, 31), ["s2"], true, 12, ["r1", "r2"]),
    game("g2", at(23, 19, 5), ["s2"], false, -8, ["r3"]),
    game("g3", at(20, 18), ["s1"], true, 10, ["r4"]),
    // No one recorded: two on the 21st, one on the 22nd.
    game("u1", at(21, 10), [], false, -5, ["r5"]),
    game("u2", at(21, 12), [], true, 7, []),
    game("u3", at(22, 9), [], null, null, []),
  ];
  const rounds = [
    round("r1", "g1", 1, 1500),
    round("r2", "g1", 2, -900),
    round("r0", "g1", 0, 0),
    round("r3", "g2", 1, -1200),
    round("r4", "g3", 1, 300),
    round("r5", "u1", 1, -100),
  ];
  return {
    gamesById: Object.fromEntries(games.map((g) => [g.id, g])),
    roundsById: Object.fromEntries(rounds.map((r) => [r.id, r])),
    sessions: [session("s2", at(23, 18, 30), ["g2", "g1"], 4), session("s1", at(20, 17), ["g3"], 10)],
    learnings: [
      { id: "l1", status: "current", roundIds: ["r1"] },
      { id: "l2", status: "current", roundIds: ["r2", "r1"] },
      { id: "l3", status: "superseded", roundIds: ["r1"] },
    ] as unknown as WorkbenchLearning[],
    players: { p1: { id: "p1", displayName: "mico", avatarColor: "#2b6cb0" } } as unknown as WorkbenchData["players"],
  };
}

describe("buildGamesList", () => {
  const list = buildGamesList(fixture(), D, "UTC");

  it("groups by Session, unrecorded Games by day, newest group first", () => {
    expect(list.groups.map((g) => g.key)).toEqual(["s2", "day:2026-11-22", "day:2026-11-21", "s1"]);
    expect(list.groups.map((g) => g.games.map((x) => x.id))).toEqual([["g1", "g2"], ["u3"], ["u1", "u2"], ["g3"]]);
    expect(list).toMatchObject({ gameCount: 6, sessionCount: 2, unrecordedDays: 2 });
  });

  it("links Session headers only, with the Session's W–L and its rating delta", () => {
    const [s2, day22, day21] = list.groups;
    expect(s2).toMatchObject({ sessionId: "s2", href: `/duos/${D}/sessions/s2`, won: 1, lost: 1, ratingDelta: 4 });
    expect(day22).toMatchObject({ sessionId: null, href: null, won: 0, lost: 0, ratingDelta: 0 });
    expect(day21).toMatchObject({ won: 1, lost: 1, ratingDelta: 2 });
  });

  it("numbers Games in play order inside their group, as the Session page does", () => {
    expect(list.groups[0]!.games.map((g) => g.number)).toEqual([1, 2]);
    expect(list.groups[2]!.games.map((g) => g.number)).toEqual([1, 2]);
  });

  it("rows carry Rounds (Round 0 left out), current Learnings, rating change and a plain Game link", () => {
    expect(list.groups[0]!.games[0]).toEqual({
      id: "g1",
      number: 1,
      won: true,
      ratingDelta: 12,
      rounds: 2,
      learnings: 2,
      href: `/duos/${D}/games/g1`,
    });
  });

  it("puts every listed Game's Rounds on the map, coloured by result, with no Opponent name", () => {
    expect(list.rounds.map((r) => [r.id, r.won, r.title])).toEqual([
      ["r4", true, "Game 1 · Round 1"],
      ["r5", false, "Game 1 · Round 1"],
      ["r1", true, "Game 1 · Round 1"],
      ["r2", false, "Game 1 · Round 2"],
      ["r3", false, "Game 2 · Round 1"],
    ]);
    const r1 = list.rounds.find((r) => r.id === "r1")!;
    expect(r1.detail).toBe("Denmark · won · +1,500");
    expect(r1.guesses[0]).toMatchObject({ isDuo: true, color: "#2b6cb0", initial: "M" });
    expect(list.roundHrefs.r2).toBe(`/duos/${D}/games/g1/rounds/2`);
    expect(JSON.stringify(list)).not.toContain("red");
  });
});
