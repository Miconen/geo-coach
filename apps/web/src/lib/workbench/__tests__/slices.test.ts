import { describe, expect, it } from "vitest";
import type {
  WorkbenchData,
  WorkbenchGame,
  WorkbenchGuess,
  WorkbenchLearning,
  WorkbenchPlayer,
  WorkbenchRound,
  WorkbenchUtterance,
} from "$lib/server/workbench/view-model.js";
import { gameSlice, roundSlice } from "../slices.js";

function player(id: string): WorkbenchPlayer {
  return {
    id,
    displayName: id,
    geoguessrUserId: null,
    geoguessrName: null,
    avatarColor: "#123456",
    isCurrentPlayer: false,
  };
}

function utterance(id: string, playerId: string): WorkbenchUtterance {
  return {
    id,
    recordingId: "rec",
    sessionId: "ses",
    playerId,
    text: `${playerId} says ${id}`,
    rawText: `${playerId} says ${id}`,
    startedAt: "2026-01-01T00:00:10.000Z",
    endedAt: "2026-01-01T00:00:12.000Z",
    avgLogprob: null,
    noSpeechProb: null,
    citedByLearningIds: [],
    rangeStatus: "processed",
    rangeStatusByPurpose: { extract: "processed", tips: "processed" },
  };
}

function guess(playerId: string | null): WorkbenchGuess {
  return {
    geoguessrPlayerId: `gg-${playerId ?? "opp"}`,
    playerId,
    nick: null,
    isDuo: playerId !== null,
    countryCode: "FI",
    regionCode: null,
    regionName: null,
    lat: null,
    lng: null,
    score: 4000,
    distanceMeters: null,
    guessedAt: null,
    guessedFirst: false,
    isBestForTeam: false,
    timedOut: false,
  };
}

function round(id: string, overrides: Partial<WorkbenchRound> = {}): WorkbenchRound {
  return {
    id,
    gameId: "g1",
    roundNumber: 1,
    countryCode: "FI",
    countryName: "Finland",
    regionCode: null,
    regionName: null,
    lat: null,
    lng: null,
    panoId: null,
    damageMultiplier: 1,
    startTime: "2026-01-01T00:00:00.000Z",
    timerStartTime: null,
    endTime: "2026-01-01T00:01:00.000Z",
    resultsEndTime: "2026-01-01T00:01:10.000Z",
    phases: [],
    duoBestScore: 4000,
    opponentBestScore: 3000,
    hpDelta: 0,
    guesses: [],
    replayPlayerCount: 0,
    utteranceIds: [],
    learningIds: [],
    debriefLearningIds: [],
    ...overrides,
  };
}

function game(id: string, roundIds: string[]): WorkbenchGame {
  return {
    id,
    geoguessrGameId: `gg-${id}`,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:10:00.000Z",
    won: true,
    duoRatingBefore: null,
    duoRatingAfter: null,
    ratingDelta: null,
    duoFinalHealth: null,
    opponentFinalHealth: null,
    opponentTeamName: null,
    roundCount: roundIds.length,
    roundIds,
    sessionIds: [],
    micCount: 0,
  };
}

function learning(id: string): WorkbenchLearning {
  return { id } as WorkbenchLearning;
}

type Source = Pick<WorkbenchData, "roundsById" | "utterancesById" | "players" | "gamesById" | "learnings">;

function source(parts: Partial<Source>): Source {
  return { roundsById: {}, utterancesById: {}, players: {}, gamesById: {}, learnings: [], ...parts };
}

describe("roundSlice", () => {
  it("returns null for an unknown Round", () => {
    expect(roundSlice(source({}), "nope")).toBeNull();
  });

  it("keeps a Round with no Utterances, with only its guessing Players", () => {
    const wb = source({
      roundsById: { r1: round("r1", { guesses: [guess("miko"), guess(null)] }) },
      players: { miko: player("miko"), sora: player("sora") },
    });

    const slice = roundSlice(wb, "r1");

    expect(slice?.round.id).toBe("r1");
    expect(slice?.utterances).toEqual([]);
    expect(Object.keys(slice?.players ?? {})).toEqual(["miko"]);
  });

  it("orders Utterances by the Round and keeps only speaking and guessing Players", () => {
    const wb = source({
      roundsById: { r1: round("r1", { utteranceIds: ["u2", "u1", "gone"], guesses: [guess("sora")] }) },
      utterancesById: {
        u1: utterance("u1", "miko"),
        u2: utterance("u2", "miko"),
        u3: utterance("u3", "kai"),
      },
      players: { miko: player("miko"), sora: player("sora"), kai: player("kai") },
    });

    const slice = roundSlice(wb, "r1");

    expect(slice?.utterances.map((u) => u.id)).toEqual(["u2", "u1"]);
    expect(Object.keys(slice?.players ?? {}).sort()).toEqual(["miko", "sora"]);
  });

  it("keeps an Utterance whose Player is missing, without inventing that Player", () => {
    const wb = source({
      roundsById: { r1: round("r1", { utteranceIds: ["u1"] }) },
      utterancesById: { u1: utterance("u1", "ghost") },
      players: { miko: player("miko") },
    });

    const slice = roundSlice(wb, "r1");

    expect(slice?.utterances.map((u) => u.id)).toEqual(["u1"]);
    expect(slice?.players).toEqual({});
  });
});

describe("gameSlice", () => {
  it("returns null for an unknown Game", () => {
    expect(gameSlice(source({}), "nope")).toBeNull();
  });

  it("slices each of a Game's Rounds in order and collects their Learnings", () => {
    const wb = source({
      gamesById: { g1: game("g1", ["r2", "r1", "missing"]) },
      roundsById: {
        r1: round("r1", { utteranceIds: ["u1"], learningIds: ["l1"] }),
        r2: round("r2", { roundNumber: 2, utteranceIds: ["u2"], learningIds: ["l2"] }),
        other: round("other", { gameId: "g2", learningIds: ["l3"] }),
      },
      utterancesById: { u1: utterance("u1", "miko"), u2: utterance("u2", "sora") },
      players: { miko: player("miko"), sora: player("sora") },
      learnings: [learning("l1"), learning("l2"), learning("l3")],
    });

    const slice = gameSlice(wb, "g1");

    expect(slice?.game.id).toBe("g1");
    expect(slice?.rounds.map((r) => r.round.id)).toEqual(["r2", "r1"]);
    expect(Object.keys(slice?.rounds[0]?.players ?? {})).toEqual(["sora"]);
    expect(Object.keys(slice?.rounds[1]?.players ?? {})).toEqual(["miko"]);
    expect(slice?.learnings.map((l) => l.id)).toEqual(["l1", "l2"]);
  });
});
