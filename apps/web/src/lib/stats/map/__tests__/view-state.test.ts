import { describe, expect, it } from "vitest";
import {
  WORLD_VIEW,
  backToWorld,
  clickRegion,
  focusCountry,
  mapUrlViewOf,
  parseMapView,
  sameMapUrlView,
  stepBack,
  writeMapView,
  type ExplorerView,
} from "../view-state.js";

const area = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

describe("stepBack", () => {
  it("steps back one thing at a time: Round, tool, area, Regions, country", () => {
    let view: ExplorerView | null = {
      country: "BG",
      regions: ["BG-22"],
      roundId: "r1",
      gameId: "g1",
      tool: "lasso",
      area,
    };
    const steps: ExplorerView[] = [];
    while ((view = stepBack(view))) steps.push(view);
    expect(steps).toEqual([
      { country: "BG", regions: ["BG-22"], roundId: null, gameId: null, tool: "lasso", area },
      { country: "BG", regions: ["BG-22"], roundId: null, gameId: null, tool: "pan", area },
      { country: "BG", regions: ["BG-22"], roundId: null, gameId: null, tool: "pan", area: null },
      { country: "BG", regions: [], roundId: null, gameId: null, tool: "pan", area: null },
      WORLD_VIEW,
    ]);
  });

  it("is null on the plain world view", () => {
    expect(stepBack(WORLD_VIEW)).toBeNull();
  });
});

describe("focusCountry and backToWorld", () => {
  it("focusing a country closes the open Round and clears the Region selection", () => {
    const view = focusCountry({ ...WORLD_VIEW, roundId: "r", regions: ["RO-B"] }, "BG");
    expect(view).toMatchObject({ country: "BG", regions: [], roundId: null });
  });

  it("going back to the world leaves the Game view but keeps a drawn area", () => {
    const view = backToWorld({ ...WORLD_VIEW, country: "BG", gameId: "g", roundId: "r", area });
    expect(view).toEqual({ ...WORLD_VIEW, area });
  });
});

describe("clickRegion", () => {
  const focused = focusCountry(WORLD_VIEW, "BG");

  it("selects only the clicked Region, and clears it on a second click", () => {
    const one = clickRegion({ ...focused, regions: ["BG-01", "BG-02"] }, "BG-22", false);
    expect(one.regions).toEqual(["BG-22"]);
    expect(clickRegion(one, "BG-22", false).regions).toEqual([]);
  });

  it("adds and removes Regions with shift or ctrl", () => {
    const two = clickRegion(clickRegion(focused, "BG-22", true), "BG-01", true);
    expect(two.regions).toEqual(["BG-22", "BG-01"]);
    expect(clickRegion(two, "BG-22", true).regions).toEqual(["BG-01"]);
  });
});

describe("Map view URL params (#73)", () => {
  const R = "22222222-2222-4222-8222-222222222222";

  it("round-trips the focus, keeping the filter's params", () => {
    const params = new URLSearchParams("country=ES&smooth=light");
    writeMapView(params, { country: "BG", regions: ["BG-22", "BG-01"], roundId: R, allRounds: true });
    expect(params.toString()).toBe(`country=ES&smooth=light&focus=BG&region=BG-22&region=BG-01&round=${R}&allRounds=1`);
    expect(parseMapView(params)).toEqual({ country: "BG", regions: ["BG-22", "BG-01"], roundId: R, allRounds: true });
    writeMapView(params, {});
    expect(params.toString()).toBe("country=ES&smooth=light");
  });

  it("ignores malformed and inconsistent params", () => {
    expect(parseMapView(new URLSearchParams("focus=zz&region=BG-22&round=nope&allRounds=1"))).toEqual({
      country: null,
      regions: [],
      roundId: null,
      allRounds: false,
    });
    // Regions of another country, or unknown ones, are dropped; "Show all Rounds" needs a Round.
    expect(parseMapView(new URLSearchParams("focus=BG&region=DE-BY&region=BG-99x&region=BG-22&allRounds=1"))).toEqual({
      country: "BG",
      regions: ["BG-22"],
      roundId: null,
      allRounds: false,
    });
  });

  it("reads an explorer view's URL part; the tool and area stay out", () => {
    const view = { ...focusCountry(WORLD_VIEW, "BG"), roundId: R, gameId: "g1", tool: "lasso" as const, area };
    const u = mapUrlViewOf(view);
    expect(u).toEqual({ country: "BG", regions: [], roundId: R, allRounds: true });
    expect(sameMapUrlView(u, { ...u, regions: [] })).toBe(true);
    expect(sameMapUrlView(u, { ...u, regions: ["BG-22"] })).toBe(false);
    expect(sameMapUrlView(u, { ...u, allRounds: false })).toBe(false);
  });
});
