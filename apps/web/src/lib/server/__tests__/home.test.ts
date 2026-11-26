import { describe, expect, it } from "vitest";
import { matchCountries } from "$lib/country-search.js";
import { buildHome, RECENT_DAYS } from "../home.js";
import type {
  CountryDossier,
  WorkbenchData,
  WorkbenchGame,
  WorkbenchGuess,
  WorkbenchLearning,
  WorkbenchRound,
  WorkbenchSession,
} from "../workbench/view-model.js";

// Duo Home (#84): what the lookup-first page is built from, on a hand-made cited-speech workbench.

const DUO = "00000000-0000-7000-8000-000000000001";
const MICO = "p-mico";
const CERKIE = "p-cerkie";
const DAY = 86_400_000;
const NEWEST = Date.parse("2026-11-23T18:31:00Z");
const daysBefore = (n: number) => new Date(NEWEST - n * DAY).toISOString();

const guess = (playerId: string | null, countryCode: string, score: number, isDuo = playerId !== null): WorkbenchGuess =>
  ({ playerId, isDuo, countryCode, score, lat: 1, lng: 1, distanceMeters: 1000, regionName: null }) as unknown as WorkbenchGuess;

let seq = 0;
function round(gameId: string, n: number, countryCode: string, guesses: WorkbenchGuess[], startTime: string): WorkbenchRound {
  const duoBest = Math.max(0, ...guesses.filter((g) => g.isDuo).map((g) => g.score));
  const oppBest = Math.max(0, ...guesses.filter((g) => !g.isDuo).map((g) => g.score));
  return {
    id: `r${++seq}`,
    gameId,
    roundNumber: n,
    countryCode,
    countryName: countryCode,
    lat: 10,
    lng: 10,
    startTime,
    duoBestScore: duoBest,
    opponentBestScore: oppBest,
    hpDelta: duoBest >= oppBest ? 0 : oppBest - duoBest,
    guesses,
  } as unknown as WorkbenchRound;
}

interface Built {
  games: WorkbenchGame[];
  rounds: WorkbenchRound[];
}
function game(id: string, startedAt: string, sessionIds: string[], rounds: Array<[string, WorkbenchGuess[]]>, extra: Partial<WorkbenchGame> = {}, into: Built) {
  const rs = rounds.map(([code, gs], i) => round(id, i + 1, code, gs, new Date(Date.parse(startedAt) + i * 60_000).toISOString()));
  into.rounds.push(...rs);
  into.games.push({ id, startedAt, sessionIds, roundIds: rs.map((r) => r.id), won: null, duoRatingAfter: null, ratingDelta: null, ...extra } as WorkbenchGame);
}

function learning(over: Partial<WorkbenchLearning>): WorkbenchLearning {
  return {
    id: `l${++seq}`,
    kind: "clue",
    text: "A Learning",
    countries: [],
    roundIds: [],
    sessionIds: [],
    status: "current",
    dismissed: false,
    done: false,
    createdAt: daysBefore(0),
    ...over,
  } as WorkbenchLearning;
}

function workbench(b: Built, opts: { sessions?: Partial<WorkbenchSession>[]; learnings?: WorkbenchLearning[]; dossiers?: Partial<CountryDossier>[] } = {}): WorkbenchData {
  return {
    players: {
      [MICO]: { id: MICO, displayName: "Mico", avatarColor: "#2b6cb0" },
      [CERKIE]: { id: CERKIE, displayName: "Cerkie", avatarColor: "#c0267a" },
    },
    gamesById: Object.fromEntries(b.games.map((g) => [g.id, g])),
    roundsById: Object.fromEntries(b.rounds.map((r) => [r.id, r])),
    sessions: (opts.sessions ?? []) as WorkbenchSession[],
    learnings: opts.learnings ?? [],
    countryDossiers: (opts.dossiers ?? []) as CountryDossier[],
  } as unknown as WorkbenchData;
}

describe("buildHome: Wrong lately", () => {
  it("counts Rounds of the last 30 days of play where neither Duo guess hit the answer, per answer country, most missed first", () => {
    const b: Built = { games: [], rounds: [] };
    // Old: outside the window counted back from the newest Game, so CZ's old miss doesn't count.
    game("g-old", daysBefore(RECENT_DAYS + 1), [], [["CZ", [guess(MICO, "DE", 3000), guess(CERKIE, "PL", 2000)]]], {}, b);
    game(
      "g1",
      daysBefore(10),
      [],
      [
        ["CZ", [guess(MICO, "DE", 3000), guess(CERKIE, "SK", 4000)]], // missed: best guess went to SK
        ["CZ", [guess(MICO, "CZ", 4500), guess(CERKIE, "DE", 2000)]], // one Duo guess hit: not a miss
        ["DK", [guess(MICO, "DE", 4000), guess(CERKIE, "LT", 3000), guess(null, "DK", 5000)]], // an Opponent's hit doesn't save it
      ],
      {},
      b,
    );
    game("g2", daysBefore(0), [], [["CZ", [guess(MICO, "DE", 4200), guess(CERKIE, "SK", 100)]]], {}, b);
    const home = buildHome(workbench(b, { learnings: [learning({ countries: ["CZ"] }), learning({ countries: ["CZ"], dismissed: true })] }), DUO);

    expect(home.mistakes.map((m) => [m.code, m.count])).toEqual([
      ["CZ", 2],
      ["DK", 1],
    ]);
    const cz = home.mistakes[0]!;
    // The Duo's best guess each time: Cerkie's Slovakia, then Mico's Germany.
    expect(cz.guessedInstead).toEqual([
      { code: "SK", count: 1 },
      { code: "DE", count: 1 },
    ]);
    expect(cz.roundIds).toHaveLength(2);
    expect(cz.learnings).toBe(1); // dismissed Learnings don't count
    expect(cz.lastAt).toBe(b.rounds.find((r) => r.gameId === "g2")!.startTime);
  });

  it("is empty with no Games", () => {
    const home = buildHome(workbench({ games: [], rounds: [] }), DUO);
    expect(home.mistakes).toEqual([]);
    expect(home.latest).toBeNull();
    expect(home.rating).toEqual([]);
  });
});

describe("buildHome: Study items", () => {
  it("lists only current Study items that aren't done or dismissed, newest first, linking to Review", () => {
    const keep1 = learning({ kind: "study", text: "Learn bollards", createdAt: daysBefore(2) });
    const keep2 = learning({ kind: "study", text: "Learn poles", createdAt: daysBefore(1) });
    const home = buildHome(
      workbench(
        { games: [], rounds: [] },
        {
          learnings: [
            keep1,
            keep2,
            learning({ kind: "study", done: true }),
            learning({ kind: "study", dismissed: true }),
            learning({ kind: "study", status: "superseded" }),
            learning({ kind: "study", status: "draft" }),
            learning({ kind: "clue" }),
          ],
        },
      ),
      DUO,
    );
    expect(home.study.map((s) => s.text)).toEqual(["Learn poles", "Learn bollards"]);
    expect(home.study[0]!.href).toBe(`/duos/${DUO}/review?learning=${keep2.id}`);
  });
});

describe("buildHome: rating, latest Session and map Rounds", () => {
  it("gives the rating after each rated Game, oldest first", () => {
    const b: Built = { games: [], rounds: [] };
    game("a", daysBefore(3), [], [], { duoRatingAfter: 1200 }, b);
    game("b", daysBefore(2), [], [], { duoRatingAfter: null }, b);
    game("c", daysBefore(1), [], [], { duoRatingAfter: 1215 }, b);
    expect(buildHome(workbench(b), DUO).rating).toEqual([
      { at: daysBefore(3), rating: 1200 },
      { at: daysBefore(1), rating: 1215 },
    ]);
  });

  it("summarises the latest Session and numbers Games within their Session or day", () => {
    const b: Built = { games: [], rounds: [] };
    game("s1g1", daysBefore(0.2), ["s1"], [["DK", [guess(MICO, "DE", 3000), guess(CERKIE, "LT", 2000)]]], { won: true }, b);
    game("s1g2", daysBefore(0.1), ["s1"], [["DK", [guess(MICO, "SE", 3000)]], ["CZ", [guess(MICO, "CZ", 4000)]]], { won: false }, b);
    game("solo", daysBefore(5), [], [["FR", [guess(MICO, "FR", 5000)]]], {}, b);
    const wb = workbench(b, {
      sessions: [
        { id: "s0", startedAt: daysBefore(9), gameIds: [], ratingDelta: 0 },
        { id: "s1", startedAt: daysBefore(0.3), gameIds: ["s1g1", "s1g2"], ratingDelta: -7 },
      ],
      learnings: [learning({ sessionIds: ["s1"] }), learning({ sessionIds: ["s0"] })],
    });
    const home = buildHome(wb, DUO);
    expect(home.latest).toMatchObject({
      id: "s1",
      href: `/duos/${DUO}/sessions/s1`,
      won: 1,
      lost: 1,
      ratingDelta: -7,
      rounds: 3,
      learnings: 1,
      missed: [{ code: "DK", count: 2 }],
    });

    // "Game N" as on the Session page and the Games list (game-number.ts): in its Session, or its day when unrecorded.
    const title = (gameId: string) => home.rounds.find((x) => x.gameId === gameId)!.title;
    expect(title("s1g1")).toMatch(/· Game 1 · Round 1$/);
    expect(title("solo")).toMatch(/· Game 1 · Round 1$/);
    const r = home.rounds.find((x) => x.gameId === "s1g2" && x.countryCode === "CZ")!;
    expect(r.title).toMatch(/· Game 2 · Round 2$/);
    expect(r.guesses[0]).toMatchObject({ isDuo: true, color: "#2b6cb0", initial: "M" });
  });

  it("builds a dossier per country played, with its current Learnings and the Rounds missed there", () => {
    const b: Built = { games: [], rounds: [] };
    game("g", daysBefore(1), [], [["BR", [guess(MICO, "BR", 4000)]], ["BR", [guess(MICO, "AR", 2000)]]], {}, b);
    const [hit, miss] = b.rounds;
    const home = buildHome(
      workbench(b, {
        learnings: [learning({ countries: ["BR"], kind: "clue", text: "Brazil has a yellow plate" }), learning({ countries: ["BR"], status: "superseded" })],
        dossiers: [
          { code: "BR", name: "Brazil", roundsPlayed: 2, missCount: 1, avgScore: 3000, netHpDelta: -100, claimCount: 3, roundIds: [hit!.id, miss!.id] },
          { code: "NO", name: "Norway", roundsPlayed: 0, missCount: 0, avgScore: null, netHpDelta: 0, claimCount: 1, roundIds: [] },
        ],
      }),
      DUO,
    );
    expect(home.dossiers.map((d) => d.code)).toEqual(["BR"]); // only countries played
    expect(home.dossiers[0]).toMatchObject({
      learnings: [{ kind: "clue", text: "Brazil has a yellow plate" }],
      roundIds: [hit!.id, miss!.id],
      missedRoundIds: [miss!.id],
      claimCount: 3,
      reviewHref: `/duos/${DUO}/review?country=BR`,
    });
  });
});

describe("matchCountries", () => {
  const ds = [
    { code: "CZ", name: "Czechia" },
    { code: "CL", name: "Chile" },
    { code: "CA", name: "Canada" },
    { code: "DK", name: "Denmark" },
  ];
  it("matches name prefixes and ISO codes, case-folded", () => {
    expect(matchCountries(ds, "c").map((d) => d.code)).toEqual(["CZ", "CL", "CA"]);
    expect(matchCountries(ds, "  CHI ").map((d) => d.code)).toEqual(["CL"]);
    expect(matchCountries(ds, "dk").map((d) => d.code)).toEqual(["DK"]);
    expect(matchCountries(ds, "mark")).toEqual([]);
    expect(matchCountries(ds, "")).toEqual([]);
  });
});
