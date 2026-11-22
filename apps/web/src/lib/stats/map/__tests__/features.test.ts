import { describe, expect, it } from "vitest";
import type { StatsGuess, StatsPlayer, StatsRound } from "@geo-coach/shared";
import { avatarIcon, formatKm, roundDots, roundLayers } from "../features.js";
import { playerColors } from "../colors.js";
import type { PlacedRound } from "../geo.js";

const players: StatsPlayer[] = [
  { id: "p1", displayName: "Miko", avatarColor: "#2563eb" },
  { id: "p2", displayName: "Aino", avatarColor: "#7c3aed" },
];

function guess(overrides: Partial<StatsGuess>): StatsGuess {
  return {
    playerId: "p1",
    isDuo: true,
    lat: 44.4,
    lng: 26.1,
    countryCode: "RO",
    regionCode: null,
    distanceMeters: 300_000,
    score: 3000,
    guessedFirst: false,
    isBestForTeam: false,
    timedOut: false,
    secondsToGuess: 20,
    ...overrides,
  };
}

const round = {
  id: "r1",
  gameId: "g",
  roundNumber: 3,
  startedAtMs: 0,
  countryCode: "BG",
  regionCode: null,
  lat: 42.7,
  lng: 23.3,
  panoId: null,
  panoView: null,
  damageMultiplier: 1,
  hpDelta: -500,
  duoBestScore: 3000,
  opponentBestScore: 3500,
  guesses: [
    guess({ isBestForTeam: true }),
    guess({ playerId: "p2", lat: 42.1, lng: 24.7, distanceMeters: 5_400, countryCode: "BG" }),
    guess({ playerId: null, isDuo: false, isBestForTeam: true, lat: 42, lng: 23 }),
  ],
  call: null,
} satisfies StatsRound as PlacedRound;

describe("roundLayers", () => {
  it("Both joins each answer to its guesses with lines labelled in km", () => {
    const l = roundLayers([round], { show: "both", who: "all" }, players);
    expect(l.pins.features).toHaveLength(1);
    expect(l.marks.features.map((f) => f.properties!.icon)).toEqual(["av-0", "av-1", "av-opp"]);
    expect(l.lines.features).toHaveLength(3);
    expect(l.lines.features[0]!.geometry.coordinates).toEqual([[23.3, 42.7], [26.1, 44.4]]);
    expect(l.labels.features.map((f) => f.properties!.text)).toEqual(["300 km", "5.4 km", "300 km"]);
  });

  it("Answers and Guesses alone draw no lines", () => {
    const answers = roundLayers([round], { show: "answers", who: "all" }, players);
    expect(answers.pins.features).toHaveLength(1);
    expect(answers.marks.features).toHaveLength(0);
    expect(answers.lines.features).toHaveLength(0);
    const guesses = roundLayers([round], { show: "guesses", who: "duo" }, players);
    expect(guesses.pins.features).toHaveLength(0);
    expect(guesses.marks.features).toHaveLength(2);
    expect(guesses.lines.features).toHaveLength(0);
    expect(guesses.labels.features).toHaveLength(0);
  });

  it("Our best shows only the Duo's best guess", () => {
    const l = roundLayers([round], { show: "both", who: "best" }, players);
    expect(l.marks.features.map((f) => f.properties!.icon)).toEqual(["av-0"]);
  });

  it("numbers the answer pins for the Game view and classes them", () => {
    const [pin] = roundLayers([round], { show: "answers", who: "best" }, players).pins.features;
    expect(pin!.properties).toEqual({ roundId: "r1", cls: "wrong-country", num: "R3" });
    expect(roundDots([round]).features[0]!.properties).toEqual({ roundId: "r1", cls: "wrong-country" });
  });
});

describe("avatars and colours", () => {
  it("marks a guess by an unknown Player apart from the Opponents", () => {
    expect(avatarIcon(guess({ playerId: "zz" }), players)).toBe("av-unknown");
  });

  it("uses each Player's colour unless they share one", () => {
    expect(playerColors(players)).toEqual(["#2563eb", "#7c3aed"]);
    const same = players.map((p) => ({ ...p, avatarColor: "#2563eb" }));
    const [a, b] = playerColors(same);
    expect(a).not.toBe(b);
  });

  it("formats km", () => {
    expect(formatKm(null)).toBe("–");
    expect(formatKm(5_430)).toBe("5.4 km");
    expect(formatKm(1_234_567)).toBe("1,235 km");
  });
});
