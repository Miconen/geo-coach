import { describe, expect, it } from "vitest";
import {
  EMPTY_STATS_FILTER,
  applyFilter,
  type StatsFilter,
  type StatsGame,
  type StatsPayload,
  type StatsRound,
} from "../index.js";

// Days in the filter are the viewer's local days; pin a zone east of UTC so the
// late Game (23:30 UTC) falls on the next local day.
process.env.TZ = "Europe/Helsinki";

const day = (iso: string) => Date.parse(iso);

function game(id: string, overrides: Partial<StatsGame>): StatsGame {
  return {
    id,
    startedAtMs: day("2026-11-01T18:00:00Z"),
    won: true,
    ratingBefore: 1200,
    ratingAfter: 1210,
    mapName: "A Pro World",
    mode: "nm",
    opponentRatingBefore: 1200,
    sessionId: null,
    ...overrides,
  };
}

function round(id: string, gameId: string, countryCode: string | null): StatsRound {
  return {
    id,
    gameId,
    roundNumber: 1,
    startedAtMs: day("2026-11-01T18:00:00Z"),
    countryCode,
    lat: 0,
    lng: 0,
    damageMultiplier: 1,
    hpDelta: 0,
    duoBestScore: 4000,
    opponentBestScore: 4000,
    guesses: [],
  };
}

// Four Games that each differ from the first on one Game-level dimension.
const payload: StatsPayload = {
  duoId: "duo",
  players: [],
  sessions: [],
  learnings: [],
  games: [
    game("g_base", { sessionId: "ses_1" }),
    game("g_late", { startedAtMs: day("2026-11-20T23:30:00Z") }),
    game("g_nmpz", { mode: "nmpz", mapName: "A Community World" }),
    game("g_strong", { opponentRatingBefore: 1500 }),
    game("g_unrated", { opponentRatingBefore: null, mode: null, mapName: null }),
  ],
  rounds: [
    round("r_base_bg", "g_base", "BG"),
    round("r_base_ro", "g_base", "RO"),
    round("r_late_br", "g_late", "BR"),
    round("r_nmpz_bg", "g_nmpz", "BG"),
    round("r_strong_us", "g_strong", "US"),
    round("r_unrated_xx", "g_unrated", null),
  ],
};

const run = (filter: Partial<StatsFilter>) => {
  const result = applyFilter(payload, { ...EMPTY_STATS_FILTER, ...filter });
  return { games: result.games.map((g) => g.id), rounds: result.rounds.map((r) => r.id) };
};

describe("applyFilter", () => {
  it("keeps everything for the empty filter", () => {
    const result = applyFilter(payload, EMPTY_STATS_FILTER);
    expect(result.games).toEqual(payload.games);
    expect(result.rounds).toEqual(payload.rounds);
  });

  it("keeps Games whose local start day is within the time range, inclusive", () => {
    expect(run({ from: "2026-11-21" })).toEqual({ games: ["g_late"], rounds: ["r_late_br"] });
    expect(run({ to: "2026-11-20" }).games).not.toContain("g_late");
    expect(run({ to: "2026-11-01" }).games).toEqual([
      "g_base",
      "g_nmpz",
      "g_strong",
      "g_unrated",
    ]);
  });

  it("keeps Games played in the chosen Sessions", () => {
    expect(run({ sessionIds: ["ses_1"] })).toEqual({
      games: ["g_base"],
      rounds: ["r_base_bg", "r_base_ro"],
    });
  });

  it("keeps Games on the chosen Maps and Modes", () => {
    expect(run({ mapNames: ["A Community World"] }).games).toEqual(["g_nmpz"]);
    expect(run({ modes: ["nmpz"] }).games).toEqual(["g_nmpz"]);
  });

  it("keeps Games whose Opponents' rating is within the band, dropping unknown ratings", () => {
    expect(run({ opponentRatingMin: 1400 }).games).toEqual(["g_strong"]);
    expect(run({ opponentRatingMax: 1300 }).games).toEqual(["g_base", "g_late", "g_nmpz"]);
  });

  it("keeps only Rounds in the chosen countries, and only Games that still have a Round", () => {
    expect(run({ countryCodes: ["BG"] })).toEqual({
      games: ["g_base", "g_nmpz"],
      rounds: ["r_base_bg", "r_nmpz_bg"],
    });
  });

  it("drops a Round whose Game fails a Game-level filter even if the Round matches", () => {
    expect(run({ countryCodes: ["BG"], modes: ["nm"] })).toEqual({
      games: ["g_base"],
      rounds: ["r_base_bg"],
    });
  });

  it("returns nothing when no Game matches", () => {
    expect(run({ mapNames: ["Nowhere"] })).toEqual({ games: [], rounds: [] });
  });
});
