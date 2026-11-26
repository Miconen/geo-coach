import { describe, expect, it } from "vitest";
import type { ClaimStatus, CluePrevalence } from "@geo-coach/shared";
import { CLUE_FILL_LABEL, CLUE_FILL_ORDER, clueFillCounts, clueLensClaims, clueLensFills, type ClueLensLink } from "../clue-lens.js";

let n = 0;
const link = (clueId: string, country: string, prevalence: CluePrevalence, status: ClaimStatus): ClueLensLink => ({
  claimId: `c${++n}`,
  clueId,
  country,
  prevalence,
  status,
});
const fills = (links: ClueLensLink[], shown = ["yellow", "truck"], notSeen: string[] = []) =>
  Object.fromEntries(clueLensFills(links, new Set(shown), new Set(notSeen)));

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
    expect(clueFillCounts(new Map([["NO", "typical"], ["IS", "out"], ["FI", "some"], ["SE", "some"], ["DK", "unlikely"]]))).toEqual({
      out: 1,
      typical: 1,
      unlikely: 1,
      some: 2,
    });
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

describe("Clues not seen this Round (#93)", () => {
  it("a not seen Clue makes a country unlikely where a verified Claim says it's typical", () => {
    expect(fills([link("yellow", "NO", "typical", "verified")], ["yellow"], ["yellow"])).toEqual({ NO: "unlikely" });
  });

  it("a not seen Clue's speculated typical, some, or lacks links paint nothing", () => {
    expect(
      fills(
        [
          link("yellow", "NO", "typical", "speculated"),
          link("yellow", "SE", "typical", "disputed"),
          link("yellow", "FI", "some", "verified"),
          link("yellow", "IS", "lacks", "verified"),
          link("yellow", "DK", "typical", "disproved"),
        ],
        ["yellow"],
        ["yellow"],
      ),
    ).toEqual({});
  });

  it("ruled out beats typical beats unlikely beats some", () => {
    const links = [
      link("yellow", "NO", "typical", "verified"),
      link("truck", "NO", "lacks", "verified"),
      link("yellow", "SE", "typical", "verified"),
      link("truck", "SE", "typical", "verified"),
      link("yellow", "FI", "typical", "verified"),
      link("truck", "FI", "some", "verified"),
      link("truck", "DK", "typical", "speculated"),
    ];
    // yellow not seen, truck seen.
    expect(fills(links, ["yellow", "truck"], ["yellow"])).toEqual({ NO: "out", SE: "typical", FI: "unlikely", DK: "some" });
  });

  it("a Clue seen as typical beats another Clue not seen there", () => {
    const links = [link("yellow", "NO", "typical", "verified"), link("truck", "NO", "typical", "verified")];
    expect(fills(links, ["yellow", "truck"], ["truck"])).toEqual({ NO: "typical" });
    expect(fills(links, ["truck"], ["truck"])).toEqual({ NO: "unlikely" });
  });

  it("a hidden not seen Clue paints nothing", () => {
    expect(fills([link("yellow", "NO", "typical", "verified")], [], ["yellow"])).toEqual({});
  });

  it("orders the legend strongest first: ruled out, typical, unlikely, in some areas", () => {
    expect(CLUE_FILL_ORDER).toEqual(["out", "typical", "unlikely", "some"]);
    expect(CLUE_FILL_LABEL.unlikely).toBe("Unlikely: typical there, not seen this Round");
  });

  it("lists a not seen Clue's typical link above an in some areas one in the popup", () => {
    const links = [link("truck", "NO", "some", "verified"), link("yellow", "NO", "typical", "verified")];
    expect(clueLensClaims(links, new Set(["yellow", "truck"]), "NO", new Set(["yellow"])).map((l) => l.clueId)).toEqual(["yellow", "truck"]);
  });
});
