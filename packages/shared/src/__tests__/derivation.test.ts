import { describe, expect, it } from "vitest";
import {
  CURRENT_API_VERSION,
  computeRecordingOffsetMs,
  deriveGameFromRawDuel,
  deriveUtteranceUtc,
  findDuoTeam,
  isSupportedApiVersion,
  isValidIsoCountryCode,
  linkUtteranceToRounds,
  learningItemInputSchema,
  uuidv7,
} from "../index.js";

describe("uuidv7", () => {
  it("generates valid RFC 9562 v7 UUIDs in time order", () => {
    const a = uuidv7(1_763_664_000_000);
    const b = uuidv7(1_763_664_001_000);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(b > a).toBe(true);
  });
});

describe("clock offset and UTC derivation", () => {
  it("uses median of low-RTT measurements and ignores high-RTT spikes", () => {
    const result = computeRecordingOffsetMs(
      [
        { offsetMs: 120, rttMs: 40 },
        { offsetMs: 140, rttMs: 35 },
        { offsetMs: 130, rttMs: 60 },
        { offsetMs: 900, rttMs: 600 }, // high RTT spike ignored
      ],
      null,
    );
    expect(result).toEqual({ offsetMs: 130, calibrated: true, source: "measured" });
  });

  it("prefers manual override over measurements", () => {
    const result = computeRecordingOffsetMs(
      [{ offsetMs: 120, rttMs: 30 }],
      -450,
    );
    expect(result).toEqual({ offsetMs: -450, calibrated: true, source: "manual" });
  });

  it("returns uncalibrated offset 0 when no measurements exist", () => {
    const result = computeRecordingOffsetMs([], null);
    expect(result).toEqual({ offsetMs: 0, calibrated: false, source: "uncalibrated" });
  });

  it("derives UTC start and end from anchor + sample ms + offset", () => {
    const anchor = Date.parse("2026-11-20T19:00:00.000Z");
    const utc = deriveUtteranceUtc(anchor, 5_000, 8_250, -250);
    expect(utc.startedAt.toISOString()).toBe("2026-11-20T19:00:04.750Z");
    expect(utc.endedAt.toISOString()).toBe("2026-11-20T19:00:08.000Z");
  });
});

describe("deriveGameFromRawDuel", () => {
  const sampleDuel = {
    gameId: "gg_duel_001",
    status: "Finished",
    options: { isTeamDuels: true, isRated: true },
    teams: [
      {
        id: "gg_team_duo",
        name: "Road to Champ",
        health: 4200,
        players: [
          {
            playerId: "gg_p1",
            nick: "MikoGeo",
            guesses: [
              {
                roundNumber: 1,
                lat: 42.7,
                lng: 25.4,
                distance: 18_500,
                score: 4920,
                countryCode: "bg",
                created: "2026-11-20T19:00:25.000Z",
              },
              {
                roundNumber: 2,
                lat: 44.4,
                lng: 26.1,
                distance: 310_000,
                score: 3650,
                countryCode: "ro",
                created: "2026-11-20T19:01:40.000Z",
              },
            ],
            progressChange: {
              rankedTeamDuelsProgress: {
                ratingBefore: 1165,
                ratingAfter: 1179,
                positionBefore: 420,
                positionAfter: 390,
                winStreak: 3,
              },
            },
          },
          {
            playerId: "gg_p2",
            nick: "SoraMaps",
            guesses: [
              {
                roundNumber: 1,
                lat: 42.1,
                lng: 24.7,
                distance: 62_000,
                score: 4710,
                countryCode: "bg",
                created: "2026-11-20T19:00:31.000Z",
              },
              {
                roundNumber: 2,
                lat: 42.6,
                lng: 23.3,
                distance: 45_000,
                score: 4820,
                countryCode: "bg",
                created: "2026-11-20T19:01:30.000Z",
              },
            ],
            progressChange: {
              rankedTeamDuelsProgress: {
                ratingBefore: 1165,
                ratingAfter: 1179,
                positionBefore: 420,
                positionAfter: 390,
                winStreak: 3,
              },
            },
          },
        ],
      },
      {
        id: "gg_team_opp",
        name: "Balkan Bosses",
        health: 0,
        players: [
          {
            playerId: "gg_opp1",
            nick: "OppOne",
            guesses: [
              {
                roundNumber: 1,
                lat: 44.5,
                lng: 26.0,
                distance: 280_000,
                score: 3800,
                countryCode: "ro",
                created: "2026-11-20T19:00:35.000Z",
              },
              {
                roundNumber: 2,
                lat: 42.5,
                lng: 25.0,
                distance: 90_000,
                score: 4600,
                countryCode: "bg",
                created: "2026-11-20T19:01:35.000Z",
              },
            ],
          },
        ],
      },
    ],
    rounds: [
      {
        roundNumber: 1,
        panorama: {
          panoId: "pano_1",
          lat: 42.69,
          lng: 25.32,
          countryCode: "bg",
          subdivision: "Stara Zagora",
        },
        startTime: "2026-11-20T19:00:00.000Z",
        timerStartTime: "2026-11-20T19:00:25.000Z",
        endTime: "2026-11-20T19:00:40.000Z",
        damageMultiplier: 1.0,
      },
      {
        roundNumber: 2,
        panorama: {
          panoId: "pano_2",
          lat: 42.65,
          lng: 23.40,
          countryCode: "bg",
          subdivision: "Sofia",
        },
        startTime: "2026-11-20T19:00:53.000Z",
        timerStartTime: null,
        endTime: "2026-11-20T19:01:50.000Z",
        damageMultiplier: 1.5,
      },
    ],
    result: { winningTeamId: "gg_team_duo" },
  };

  it("derives Game rating, win state, Rounds, phases, HP deltas, and per-Player guesses", () => {
    const derived = deriveGameFromRawDuel(sampleDuel, "gg_team_duo", {
      gg_p1: "player_miko",
      gg_p2: "player_sora",
    });

    expect(derived.geoguessrGameId).toBe("gg_duel_001");
    expect(derived.won).toBe(true);
    expect(derived.duoRatingBefore).toBe(1165);
    expect(derived.duoRatingAfter).toBe(1179);
    expect(derived.roundCount).toBe(2);
    expect(derived.startedAt.toISOString()).toBe("2026-11-20T19:00:00.000Z");
    // Final round ends at 19:01:50 + 15s tail = 19:02:05
    expect(derived.endedAt.toISOString()).toBe("2026-11-20T19:02:05.000Z");

    const r1 = derived.rounds[0]!;
    expect(r1.countryCode).toBe("BG");
    expect(r1.phases).toEqual([
      {
        phase: "play",
        startedAt: new Date("2026-11-20T19:00:00.000Z"),
        endedAt: new Date("2026-11-20T19:00:25.000Z"),
      },
      {
        phase: "countdown",
        startedAt: new Date("2026-11-20T19:00:25.000Z"),
        endedAt: new Date("2026-11-20T19:00:40.000Z"),
      },
      {
        phase: "results",
        startedAt: new Date("2026-11-20T19:00:40.000Z"),
        endedAt: new Date("2026-11-20T19:00:53.000Z"),
      },
    ]);
    expect(r1.duoBestScore).toBe(4920);
    expect(r1.opponentBestScore).toBe(3800);
    expect(r1.hpDelta).toBe(1120);
    const p1Guess = r1.guesses.find((g) => g.playerId === "player_miko")!;
    expect(p1Guess.guessedFirst).toBe(true);
    expect(p1Guess.isBestForTeam).toBe(true);

    // Round 2 has null timerStartTime -> no countdown phase, results ends at endTime + 15s
    const r2 = derived.rounds[1]!;
    expect(r2.phases.map((p) => p.phase)).toEqual(["play", "results"]);
    expect(r2.phases[1]!.endedAt.toISOString()).toBe("2026-11-20T19:02:05.000Z");
    expect(r2.hpDelta).toBe(Math.round((4820 - 4600) * 1.5));
  });

  it("derives the Map, the Mode and the Opponents' rating before the Game", () => {
    const opponentProgress = {
      rankedTeamDuelsProgress: { ratingBefore: 1455, ratingAfter: 1462, winStreak: 4 },
    };
    const duel = {
      ...sampleDuel,
      options: {
        ...sampleDuel.options,
        map: { name: "A Pro World", slug: "pro-world" },
        movementOptions: { forbidMoving: true, forbidZooming: false, forbidRotating: false },
      },
      teams: [
        sampleDuel.teams[0]!,
        {
          ...sampleDuel.teams[1]!,
          players: [{ ...sampleDuel.teams[1]!.players[0]!, progressChange: opponentProgress }],
        },
      ],
    };

    const derived = deriveGameFromRawDuel(duel, "gg_team_duo", {});

    expect(derived.mapName).toBe("A Pro World");
    expect(derived.mode).toBe("nm");
    expect(derived.opponentRatingBefore).toBe(1455);
  });

  it("tells Moving, NoMove and NMPZ apart, and leaves unknowns null", () => {
    const modeOf = (movementOptions: unknown) =>
      deriveGameFromRawDuel(
        { ...sampleDuel, options: { ...sampleDuel.options, movementOptions } },
        "gg_team_duo",
        {},
      ).mode;

    expect(modeOf({ forbidMoving: false, forbidZooming: false, forbidRotating: false })).toBe(
      "moving",
    );
    expect(modeOf({ forbidMoving: true, forbidZooming: true, forbidRotating: true })).toBe("nmpz");
    expect(modeOf(undefined)).toBeNull();

    const bare = deriveGameFromRawDuel(sampleDuel, "gg_team_duo", {});
    expect(bare.mapName).toBeNull();
    expect(bare.opponentRatingBefore).toBeNull();
  });

  it("multi-links boundary-straddling Utterances across adjacent phases and Rounds", () => {
    const derived = deriveGameFromRawDuel(sampleDuel, "gg_team_duo", {
      gg_p1: "player_miko",
      gg_p2: "player_sora",
    });

    // Utterance crosses round 1 countdown -> results (19:00:38 to 19:00:43)
    const links1 = linkUtteranceToRounds(
      {
        startedAt: new Date("2026-11-20T19:00:38.000Z"),
        endedAt: new Date("2026-11-20T19:00:43.000Z"),
      },
      derived.rounds,
    );
    expect(links1).toEqual([
      { roundNumber: 1, phase: "countdown" },
      { roundNumber: 1, phase: "results" },
    ]);

    // Utterance crosses round 1 results -> round 2 play (19:00:51 to 19:00:56)
    const links2 = linkUtteranceToRounds(
      {
        startedAt: new Date("2026-11-20T19:00:51.000Z"),
        endedAt: new Date("2026-11-20T19:00:56.000Z"),
      },
      derived.rounds,
    );
    expect(links2).toEqual([
      { roundNumber: 1, phase: "results" },
      { roundNumber: 2, phase: "play" },
    ]);
  });
});

describe("API contracts & validation", () => {
  it("accepts current and previous API versions and rejects older", () => {
    expect(isSupportedApiVersion(CURRENT_API_VERSION)).toBe(true);
    expect(isSupportedApiVersion(CURRENT_API_VERSION + 1)).toBe(false);
    expect(isSupportedApiVersion(0)).toBe(false);
  });

  it("validates ISO 3166-1 alpha-2 country codes and region pairing", () => {
    expect(isValidIsoCountryCode("BG")).toBe(true);
    expect(isValidIsoCountryCode("ZZ")).toBe(false);

    const ok = learningItemInputSchema.safeParse({
      kind: "clue",
      text: "Yellow-top bollards point to Bulgaria.",
      countries: ["BG"],
      regions: [{ country: "BG", name: "Stara Zagora" }],
      topics: ["bollards"],
      origin: "speech",
      utteranceRefs: ["u1"],
    });
    expect(ok.success).toBe(true);

    const badRegion = learningItemInputSchema.safeParse({
      kind: "clue",
      text: "Region without matching country.",
      countries: ["BG"],
      regions: [{ country: "RO", name: "Transylvania" }],
      topics: [],
      origin: "speech",
      utteranceRefs: ["u1"],
    });
    expect(badRegion.success).toBe(false);
  });
});

describe("findDuoTeam", () => {
  const teams = [
    { id: "game_team_blue", players: [{ playerId: "o1" }, { playerId: "o2" }] },
    { id: "game_team_red", players: [{ playerId: "p1" }, { playerId: "p2" }] },
  ];

  it("matches the ranked teamId by its players, in either order", () => {
    expect(findDuoTeam(teams, "p1-p2")?.id).toBe("game_team_red");
    expect(findDuoTeam(teams, "p2-p1")?.id).toBe("game_team_red");
  });

  it("returns undefined when the Duo didn't play", () => {
    expect(findDuoTeam(teams, "p1-x9")).toBeUndefined();
  });
});
