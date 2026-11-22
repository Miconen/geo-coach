import * as h3 from "h3-js";
import { describe, expect, it } from "vitest";
import { AREA_RADIUS_KM, hexOpacity, hexSurface, type HexCell } from "../index.js";
import { bestGuess, makeRound } from "./stats-fixtures.js";

const WORLD = { resolution: 2, radiusKm: AREA_RADIUS_KM.world };

/** A Round at a point with the given score gap. */
function roundAt(id: string, lat: number, lng: number, gap: number, hpDelta = gap) {
  return makeRound(id, "g", {
    lat,
    lng,
    duoBestScore: 4000 + gap,
    opponentBestScore: 4000,
    hpDelta,
    guesses: [bestGuess("BG", 50)],
  });
}

function cellAt(cells: HexCell[], lat: number, lng: number, res: number): HexCell | undefined {
  const id = h3.latLngToCell(lat, lng, res);
  return cells.find((c) => c.cell === id);
}

describe("hexSurface", () => {
  // Ten good Rounds around Sofia, one bad Round alone in the Sahara.
  const sofia = Array.from({ length: 10 }, (_, i) =>
    roundAt(`s${i}`, 42.7 + (i % 3) * 0.2, 23.3 + (i % 4) * 0.2, 800),
  );
  const sahara = roundAt("lone", 23, 10, -1500);
  const cells = hexSurface(h3, [...sofia, sahara], "gap", WORLD);

  it("gives a hexagon near many good Rounds a positive gap", () => {
    const hex = cellAt(cells, 42.8, 23.5, WORLD.resolution)!;
    expect(hex).toBeDefined();
    expect(hex.value).toBeGreaterThan(0);
    expect(hex.value).toBeCloseTo(800);
  });

  it("fades hexagons backed by little data", () => {
    const dense = cellAt(cells, 42.8, 23.5, WORLD.resolution)!;
    const lone = cellAt(cells, 23, 10, WORLD.resolution)!;
    expect(lone.value).toBeCloseTo(-1500);
    expect(lone.weight).toBeLessThan(dense.weight);
    expect(hexOpacity(lone.weight)).toBeLessThan(hexOpacity(dense.weight));
  });

  it("spreads a Round only within the radius", () => {
    // Nothing from Sofia reaches Crete (~850 km) at a 400 km radius.
    const crete = cellAt(hexSurface(h3, sofia, "gap", WORLD), 35.34, 25.13, WORLD.resolution);
    expect(crete).toBeUndefined();
    // A lone Round reaches the hexagons around it, every centre within the radius.
    const one = [roundAt("one", 42.7, 23.3, 500)];
    for (const [key, resolution] of [["world", 2], ["focused", 3]] as const) {
      const radiusKm = AREA_RADIUS_KM[key];
      const cells = hexSurface(h3, one, "gap", { resolution, radiusKm });
      expect(cells.length).toBeGreaterThan(1);
      for (const c of cells) {
        const [lat, lng] = h3.cellToLatLng(c.cell);
        expect(h3.greatCircleDistance([42.7, 23.3], [lat, lng], h3.UNITS.km)).toBeLessThanOrEqual(radiusKm);
      }
    }
  });

  it("averages by distance weight, nearer Rounds counting more", () => {
    const near = roundAt("near", 42.7, 23.3, 1000);
    const far = roundAt("far", 44.4, 26.1, -1000); // Bucharest, ~300 km away
    const hex = cellAt(hexSurface(h3, [near, far], "gap", WORLD), 42.7, 23.3, WORLD.resolution)!;
    expect(hex.value).toBeGreaterThan(0);
    expect(hex.value).toBeLessThan(1000);
  });

  it("measures Damage taken per Round and the wrong-country rate", () => {
    const lost = roundAt("lost", 42.7, 23.3, -500, -1000);
    const wrong = makeRound("wrong", "g", { lat: 42.7, lng: 23.3, guesses: [bestGuess("RO", 200)] });
    const damage = cellAt(hexSurface(h3, [lost], "damage", WORLD), 42.7, 23.3, 2)!;
    expect(damage.value).toBeCloseTo(1000);
    const rate = cellAt(hexSurface(h3, [lost, wrong], "wrong-country", WORLD), 42.7, 23.3, 2)!;
    expect(rate.value).toBeCloseTo(0.5, 1);
  });

  it("counts the Rounds whose answer is in the hexagon", () => {
    const hex = cellAt(cells, 23, 10, WORLD.resolution)!;
    expect(hex.rounds).toBe(1);
  });

  it("skips Rounds without a location", () => {
    const nowhere = makeRound("n", "g", { lat: null, lng: null });
    expect(hexSurface(h3, [nowhere], "gap", WORLD)).toEqual([]);
  });

  it("skips hexagons that cross the antimeridian", () => {
    const fiji = hexSurface(h3, [roundAt("fj", -17, 179.9, 500)], "gap", WORLD);
    expect(fiji.length).toBeGreaterThan(0);
    for (const c of fiji) {
      const lngs = c.ring.map(([lng]) => lng);
      expect(Math.max(...lngs) - Math.min(...lngs)).toBeLessThan(180);
    }
  });

  it("closes each ring in GeoJSON [lng, lat] order", () => {
    const hex = cellAt(cells, 23, 10, WORLD.resolution)!;
    expect(hex.ring[0]).toEqual(hex.ring.at(-1));
    expect(hex.ring[0]![0]).toBeGreaterThan(5); // a longitude near 10°E, not a latitude near 23°N
    expect(hex.ring[0]![0]).toBeLessThan(15);
  });
});

describe("hexOpacity", () => {
  it("grows with the weight behind a hexagon, within bounds", () => {
    expect(hexOpacity(0.35)).toBeCloseTo(0.3);
    expect(hexOpacity(1)).toBeGreaterThan(hexOpacity(0.5));
    expect(hexOpacity(100)).toBeCloseTo(0.85);
  });
});
