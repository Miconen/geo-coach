import { describe, expect, it } from "vitest";
import type { ClaimStatus, CluePrevalence } from "@geo-coach/shared";
import { clueFillCounts, clueLensClaims, clueLensFills, type ClueLensLink } from "../clue-lens.js";

let n = 0;
const link = (clueId: string, country: string, prevalence: CluePrevalence, status: ClaimStatus): ClueLensLink => ({
  claimId: `c${++n}`,
  clueId,
  country,
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
