import { describe, expect, it } from "vitest";
import {
  OPPONENT_GUESS_COLOR,
  DIM_OPACITY,
  bearingDeg,
  bearingToScreen,
  boundsAround,
  cameraKey,
  edgeCandidates,
  edgeMarker,
  fadeOpacities,
  framePoints,
  lensCategories,
  litRoundIds,
  opacityByRound,
  sceneFeatures,
  type MapGuess,
  type MapRound,
  type MapScene,
} from "../scene.js";

const guess = (over: Partial<MapGuess>): MapGuess => ({
  lat: 0,
  lng: 0,
  countryCode: null,
  isDuo: true,
  playerId: "p1",
  color: "#3b82f6",
  initial: "M",
  score: 1000,
  distanceMeters: 100_000,
  ...over,
});

const round = (over: Partial<MapRound>): MapRound => ({
  id: "r1",
  gameId: "g1",
  label: "R1",
  title: "Game 1 · Round 1",
  detail: "",
  lat: 0,
  lng: 0,
  countryCode: "DK",
  won: false,
  guesses: [],
  ...over,
});

const scene = (over: Partial<MapScene>): MapScene => ({ header: "", rounds: [], focusRoundIds: [], masked: false, ...over });

describe("lensCategories", () => {
  it("fills the answer plain green with no outline when a Duo guess landed there", () => {
    const r = round({ countryCode: "DK", said: ["DK"], guesses: [guess({ countryCode: "DK" })] });
    const lens = lensCategories([r], false);
    expect(lens.fills.get("DK")).toBe("g");
    expect(lens.outlines.has("DK")).toBe(false);
  });

  it("fills the answer green and outlines it when it was said but missed", () => {
    const r = round({ countryCode: "DK", said: ["DK"], guesses: [guess({ countryCode: "DE" })] });
    const lens = lensCategories([r], false);
    expect(lens.fills.get("DK")).toBe("g");
    expect(lens.outlines.has("DK")).toBe(true);
  });

  it("fills a Duo wrong guess that was also said plain red, with no outline", () => {
    const r = round({ countryCode: "DK", said: ["DE"], guesses: [guess({ countryCode: "DE" })] });
    const lens = lensCategories([r], false);
    expect(lens.fills.get("DE")).toBe("r");
    expect(lens.outlines.has("DE")).toBe(false);
  });

  it("only outlines a country said while guessing that was neither guessed nor the answer", () => {
    const r = round({ countryCode: "DK", said: ["SE"], guesses: [guess({ countryCode: "DE" })] });
    const lens = lensCategories([r], false);
    expect(lens.fills.has("SE")).toBe(false);
    expect(lens.outlines.has("SE")).toBe(true);
  });

  it("paints nothing for an Opponent-only guess", () => {
    const r = round({ countryCode: "DK", guesses: [guess({ countryCode: "PL", isDuo: false, playerId: null })] });
    const lens = lensCategories([r], false);
    expect(lens.fills.has("PL")).toBe(false);
    expect(lens.outlines.has("PL")).toBe(false);
    // Said aloud too: an Opponent landing there isn't the Duo guessing it, so it's outlined, never filled.
    const said = lensCategories([round({ ...r, said: ["PL"] })], false);
    expect(said.fills.has("PL")).toBe(false);
    expect(said.outlines.has("PL")).toBe(true);
  });

  it("paints nothing under Recall", () => {
    const r = round({ guesses: [guess({ countryCode: "DE" })], said: ["SE", "DK"] });
    const lens = lensCategories([r], true);
    expect(lens.fills.size).toBe(0);
    expect(lens.outlines.size).toBe(0);
  });

  it("outlines nothing for a Round with no transcript (the Games list)", () => {
    const r = round({ countryCode: "DK", guesses: [guess({ countryCode: "DE" })] });
    expect(lensCategories([r], false).outlines.size).toBe(0);
  });

  it("fills a country green when it's the answer in one focused Round and a wrong guess in another", () => {
    const a = round({ id: "a", countryCode: "CZ" });
    const b = round({ id: "b", countryCode: "AT", guesses: [guess({ countryCode: "CZ" })] });
    expect(lensCategories([a, b], false).fills.get("CZ")).toBe("g");
    expect(lensCategories([b, a], false).fills.get("CZ")).toBe("g");
  });
});

describe("framePoints", () => {
  // Game 4 · Round 2 of the 2026-11-23 dev Session: Malaysia, one Duo guess in South America.
  const malaysia = round({
    id: "m",
    lat: 3.1,
    lng: 101.7,
    countryCode: "MY",
    guesses: [
      guess({ lat: -15.8, lng: -47.9, countryCode: "BR", distanceMeters: 16_000_000 }),
      guess({ lat: 1.35, lng: 103.8, countryCode: "SG", distanceMeters: 300_000, playerId: "p2" }),
      guess({ lat: -33.9, lng: 151.2, isDuo: false, playerId: null, distanceMeters: 6_600_000 }),
    ],
  });

  it("frames a focused Round on its answer and the Duo's nearby guesses only", () => {
    const pts = framePoints(scene({ rounds: [malaysia], focusRoundIds: ["m"] }));
    expect(pts).toEqual([
      [101.7, 3.1],
      [103.8, 1.35],
    ]);
  });

  it("works out the distance when the guess has none", () => {
    const r = round({ id: "x", lat: 0, lng: 0, guesses: [guess({ lat: 0, lng: 50, distanceMeters: null })] });
    expect(framePoints(scene({ rounds: [r], focusRoundIds: ["x"] }))).toEqual([[0, 0]]);
  });

  it("frames the Duo's guesses under Recall, never the answer", () => {
    const pts = framePoints(scene({ rounds: [malaysia], focusRoundIds: ["m"], masked: true }));
    expect(pts).toEqual([
      [-47.9, -15.8],
      [103.8, 1.35],
    ]);
  });

  it("frames every answer with nothing in focus", () => {
    const other = round({ id: "o", lat: 50, lng: 10 });
    expect(framePoints(scene({ rounds: [malaysia, other] }))).toEqual([
      [101.7, 3.1],
      [10, 50],
    ]);
  });

  it("moves the camera on selection, not on highlight", () => {
    const base = scene({ rounds: [malaysia], focusRoundIds: [] });
    expect(cameraKey({ ...base, highlight: { roundId: "m" } })).toBe(cameraKey(base));
    expect(cameraKey({ ...base, focusRoundIds: ["m"] })).not.toBe(cameraKey(base));
  });
});

describe("boundsAround", () => {
  it("takes the short way across the antimeridian", () => {
    expect(boundsAround([
      [170, -10],
      [-170, 10],
    ])).toEqual([
      [170, -10],
      [190, 10],
    ]);
  });

  it("keeps ordinary bounds as they are", () => {
    expect(boundsAround([
      [10, 50],
      [20, 40],
    ])).toEqual([
      [10, 40],
      [20, 50],
    ]);
  });
});

describe("dimming", () => {
  const rounds = [round({ id: "a", gameId: "g1" }), round({ id: "b", gameId: "g1" }), round({ id: "c", gameId: "g2" })];

  it("lights a set of Games", () => {
    expect(litRoundIds(scene({ rounds, highlight: { gameIds: ["g1"] } }))).toEqual(new Set(["a", "b"]));
    expect(litRoundIds(scene({ rounds, highlight: { gameIds: ["g1", "g2"] } }))).toEqual(new Set(["a", "b", "c"]));
  });

  it("lights the focused Rounds plus a hovered one", () => {
    expect(litRoundIds(scene({ rounds, focusRoundIds: ["a"], highlight: { roundId: "c" } }))).toEqual(new Set(["a", "c"]));
  });

  it("lights everything with no highlight or focus", () => {
    expect(litRoundIds(scene({ rounds }))).toBeNull();
  });

  it("cross-fades without touching Rounds lit before and after", () => {
    const from = new Map([["c", DIM_OPACITY]]);
    const mid = fadeOpacities(["a", "b", "c"], from, new Set(["a"]), 0.5);
    expect(mid.has("a")).toBe(false);
    expect(mid.get("b")).toBeCloseTo((1 + DIM_OPACITY) / 2);
    expect(mid.get("c")).toBeCloseTo(DIM_OPACITY);
    expect(fadeOpacities(["a", "b", "c"], from, null, 1).size).toBe(0);
  });

  it("builds a short opacity expression", () => {
    expect(opacityByRound(new Map())).toBe(1);
    expect(opacityByRound(new Map([["a", 0.12], ["b", 0.12]]))).toEqual(["match", ["get", "roundId"], ["a", "b"], 0.12, 1]);
  });
});

describe("edge markers", () => {
  const view = { width: 800, height: 600 };
  const inset = { top: 20, bottom: 20, left: 20, right: 20 };

  it("is null for a point on screen", () => {
    expect(edgeMarker(view, inset, { x: 1, y: 0 }, true)).toBeNull();
  });

  it("sits on the right edge for a point due east", () => {
    expect(edgeMarker(view, inset, { x: 500, y: 0 }, false)).toEqual({ x: 780, y: 300, angle: 0 });
  });

  it("sits on the top edge for a point due north, pointing up", () => {
    const m = edgeMarker(view, inset, bearingToScreen(0), false)!;
    expect(m.x).toBeCloseTo(400);
    expect(m.y).toBeCloseTo(20);
    expect(m.angle).toBeCloseTo(-90);
  });

  it("hits the nearer side on a diagonal", () => {
    const m = edgeMarker(view, inset, { x: 1, y: 1 }, false)!;
    expect(m.y).toBeCloseTo(580);
    expect(m.x).toBeCloseTo(680);
  });

  it("measures bearings clockwise from north", () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 10 })).toBeCloseTo(90);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: -10, lng: 0 })).toBeCloseTo(180);
  });

  it("marks only the focused Rounds' Duo guesses", () => {
    const r = round({ id: "a", guesses: [guess({}), guess({ isDuo: false, playerId: null })] });
    const other = round({ id: "b", guesses: [guess({})] });
    const c = edgeCandidates(scene({ rounds: [r, other], focusRoundIds: ["a"] }));
    expect(c).toHaveLength(1);
    expect(c[0]!.guess.isDuo).toBe(true);
  });
});

describe("sceneFeatures", () => {
  const r = round({
    id: "a",
    guesses: [guess({ countryCode: "DE" }), guess({ isDuo: false, playerId: null, color: "#ff0000" })],
  });
  const b = round({ id: "b", gameId: "g2", guesses: [guess({})] });

  it("hides answers, lines and km labels under Recall but keeps guess pins", () => {
    const f = sceneFeatures(scene({ rounds: [r], focusRoundIds: ["a"], masked: true }));
    expect(f.answers.features).toHaveLength(0);
    expect(f.lines.features).toHaveLength(0);
    expect(f.km.features).toHaveLength(0);
    expect(f.guesses.features).toHaveLength(2);
  });

  it("shows every guess of a focused Round, Opponents neutral", () => {
    const f = sceneFeatures(scene({ rounds: [r, b], focusRoundIds: ["a"] }));
    expect(f.guesses.features.map((x) => x.properties!.icon)).toEqual(["av:#3b82f6:M", `av:${OPPONENT_GUESS_COLOR}:O`]);
    expect(f.lines.features).toHaveLength(2);
    expect(f.km.features).toHaveLength(2);
  });

  it("drops km labels when the page asks, or with more than three Rounds in focus", () => {
    expect(sceneFeatures(scene({ rounds: [r], focusRoundIds: ["a"], kmLabels: false })).km.features).toHaveLength(0);
    const many = ["1", "2", "3", "4"].map((id) => round({ id, guesses: [guess({})] }));
    expect(sceneFeatures(scene({ rounds: many, focusRoundIds: many.map((m) => m.id) })).km.features).toHaveLength(0);
  });

  it("draws guess pins only for highlighted Games when asked", () => {
    const base = scene({ rounds: [r, b], guessPins: "highlighted" });
    expect(sceneFeatures(base).guesses.features).toHaveLength(0);
    const lit = sceneFeatures({ ...base, highlight: { gameIds: ["g2"] } });
    expect(lit.guesses.features.map((x) => x.properties!.roundId)).toEqual(["b"]);
  });

  it("labels pins only when asked", () => {
    expect(sceneFeatures(scene({ rounds: [r] })).answers.features[0]!.properties!.label).toBe("");
    expect(sceneFeatures(scene({ rounds: [r], labelPins: true })).answers.features[0]!.properties!.label).toBe("R1");
  });

  it("draws a line the short way across the antimeridian", () => {
    const x = round({ id: "x", lng: 179, guesses: [guess({ lng: -179 })] });
    const f = sceneFeatures(scene({ rounds: [x], focusRoundIds: ["x"] }));
    expect(f.lines.features[0]!.geometry.coordinates).toEqual([
      [179, 0],
      [181, 0],
    ]);
    expect(f.km.features[0]!.geometry.coordinates[0]).toBeCloseTo(180);
  });
});
