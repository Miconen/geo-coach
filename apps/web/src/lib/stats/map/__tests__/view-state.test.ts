import { describe, expect, it } from "vitest";
import { WORLD_VIEW, backToWorld, clickRegion, focusCountry, stepBack, type ExplorerView } from "../view-state.js";

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
