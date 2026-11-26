import { describe, expect, it } from "vitest";
import type { ClaimStatus, CluePrevalence } from "@geo-coach/shared";
import { regionsOf } from "@geo-coach/shared";
import { clueFillCounts, clueLensClaims, clueLensFills, clueLensMapFills, type ClueLensLink } from "../clue-lens.js";

let n = 0;
const link = (clueId: string, country: string, prevalence: CluePrevalence, status: ClaimStatus, regionCode: string | null = null): ClueLensLink => ({
  claimId: `c${++n}`,
  clueId,
  country,
  regionCode,
  prevalence,
  status,
});
const fills = (links: ClueLensLink[], shown = ["yellow", "truck"]) => Object.fromEntries(clueLensFills(links, new Set(shown)));

describe("the Clue lens fills (#89)", () => {
  it("lacks beats typical beats some", () => {
    expect(
      fills([
        link("yellow", "NO", "some", "verified"),
        link("yellow", "NO", "typical", "verified"),
        link("yellow", "IS", "typical", "verified"),
        link("yellow", "IS", "lacks", "verified"),
        link("yellow", "FI", "some", "verified"),
      ]),
    ).toEqual({ NO: "typical", IS: "out", FI: "some" });
  });

  it("a speculated link caps at in some areas and never rules out", () => {
    expect(
      fills([
        link("yellow", "NO", "typical", "speculated"),
        link("yellow", "IS", "lacks", "speculated"),
        link("yellow", "SE", "lacks", "disputed"),
        link("yellow", "FI", "some", "speculated"),
      ]),
    ).toEqual({ NO: "some", FI: "some" });
  });

  it("ignores disproved Claims", () => {
    expect(fills([link("yellow", "NO", "typical", "disproved"), link("yellow", "IS", "lacks", "disproved")])).toEqual({});
  });

  it("combining Clues takes the strongest fill per country, and hidden Clues paint nothing", () => {
    const links = [
      link("yellow", "NO", "some", "verified"),
      link("truck", "NO", "typical", "verified"),
      link("yellow", "KZ", "typical", "verified"),
      link("truck", "KZ", "lacks", "verified"),
      link("truck", "PA", "typical", "speculated"),
    ];
    expect(fills(links)).toEqual({ NO: "typical", KZ: "out", PA: "some" });
    expect(fills(links, ["yellow"])).toEqual({ NO: "some", KZ: "typical" });
    expect(fills(links, [])).toEqual({});
  });

  it("counts each fill for the legend", () => {
    expect(clueFillCounts(new Map([["NO", "typical"], ["IS", "out"], ["FI", "some"], ["SE", "some"]]))).toEqual({ out: 1, typical: 1, some: 2 });
  });

  it("lists every shown Claim that links a country, strongest first, disproved ones last", () => {
    const links = [
      link("yellow", "NO", "some", "speculated"),
      link("yellow", "NO", "typical", "disproved"),
      link("truck", "NO", "lacks", "verified"),
      link("truck", "SE", "typical", "verified"),
    ];
    expect(clueLensClaims(links, new Set(["yellow", "truck"]), "NO").map((l) => [l.clueId, l.prevalence, l.status])).toEqual([
      ["truck", "lacks", "verified"],
      ["yellow", "some", "speculated"],
      ["yellow", "typical", "disproved"],
    ]);
    expect(clueLensClaims(links, new Set(["yellow"]), "SE")).toEqual([]);
  });
});

describe("Region links in the Clue lens (#92)", () => {
  it("a Region typical link makes its country in some areas at country level", () => {
    expect(fills([link("yellow", "US", "typical", "verified", "US-HI")])).toEqual({ US: "some" });
    expect(fills([link("yellow", "US", "some", "speculated", "US-HI")])).toEqual({ US: "some" });
  });

  it("a Region lacks link doesn't rule its country out", () => {
    expect(fills([link("yellow", "US", "lacks", "verified", "US-HI")])).toEqual({});
    expect(fills([link("yellow", "US", "lacks", "verified", "US-HI"), link("yellow", "US", "typical", "verified")])).toEqual({ US: "typical" });
  });

  it("a country link still beats what its Regions roll up to", () => {
    expect(fills([link("yellow", "US", "typical", "verified", "US-HI"), link("yellow", "US", "lacks", "verified")])).toEqual({ US: "out" });
  });

  it("shades a country with Region links Region by Region, its other Regions neutral, other countries as before", () => {
    const links = [
      link("yellow", "US", "typical", "verified", "US-HI"),
      link("yellow", "US", "lacks", "verified", "US-AK"),
      link("yellow", "CA", "typical", "verified"),
      link("yellow", "MX", "lacks", "verified"),
    ];
    const map = clueLensMapFills(links, new Set(["yellow"]));
    expect(Object.fromEntries(map.countries)).toEqual({ CA: "typical", MX: "out" });
    expect(map.regionCountries).toEqual(["US"]);
    expect(Object.fromEntries(map.regions)).toEqual({ "US-HI": "typical", "US-AK": "out" });
    // The same countries as the country-level fills, the US drawn by its Regions instead.
    expect(Object.fromEntries(clueLensFills(links, new Set(["yellow"])))).toEqual({ US: "some", CA: "typical", MX: "out" });
  });

  it("a Region shows the stronger of its own links and its country's", () => {
    const links = [link("yellow", "US", "some", "verified", "US-HI"), link("yellow", "US", "typical", "verified"), link("yellow", "US", "lacks", "verified", "US-AK")];
    const { regions } = clueLensMapFills(links, new Set(["yellow"]));
    expect(regions.get("US-HI")).toBe("typical");
    expect(regions.get("US-AK")).toBe("out");
    expect(regions.get("US-TX")).toBe("typical");
    expect(regions.size).toBe(regionsOf("US").length);
  });

  it("only shown Clues' painting Region links shade by Region", () => {
    const links = [link("truck", "US", "typical", "verified", "US-HI"), link("yellow", "US", "typical", "disproved", "US-AK"), link("yellow", "US", "typical", "verified")];
    const map = clueLensMapFills(links, new Set(["yellow"]));
    expect(map.regionCountries).toEqual([]);
    expect(Object.fromEntries(map.countries)).toEqual({ US: "typical" });
    expect(map.regions.size).toBe(0);
  });

  it("the popup lists a country's Region links beside its country links", () => {
    const links = [link("yellow", "US", "typical", "verified", "US-HI"), link("yellow", "US", "some", "speculated")];
    expect(clueLensClaims(links, new Set(["yellow"]), "US").map((l) => [l.regionCode, l.prevalence])).toEqual([
      ["US-HI", "typical"],
      [null, "some"],
    ]);
  });
});
