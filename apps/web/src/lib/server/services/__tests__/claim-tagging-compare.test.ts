import { describe, expect, it } from "vitest";
import { compareClaimLinks, compareJobLinks, trialPromotionPlan, type ComparableLink } from "../index.js";

const link = (name: string, country: string, prevalence: ComparableLink["prevalence"], regionCode: string | null = null, family = "Road lines"): ComparableLink => ({
  family,
  name,
  country,
  regionCode,
  prevalence,
});

describe("comparing two tagging jobs' links (#94)", () => {
  it("flags added, removed and changed-prevalence links, and leaves equal ones out", () => {
    const a = [
      link("Yellow/orange centre line", "NO", "typical"),
      link("Red soil", "MX", "lacks", null, "Vegetation and landscape"),
      link("No front plate", "US", "typical", "US-HI", "Plates"),
    ];
    const b = [
      // Same Clue, spelt with another case: still the same link.
      link("yellow/orange centre line", "NO", "typical"),
      link("No front plate", "US", "some", "US-HI", "Plates"),
      link("No front plate", "US", "typical", null, "Plates"),
    ];
    expect(compareClaimLinks(a, b)).toEqual([
      // By Clue, then country, the whole country before its Regions.
      { change: "added", family: "Plates", name: "No front plate", country: "US", regionCode: null, from: null, to: "typical" },
      { change: "changed", family: "Plates", name: "No front plate", country: "US", regionCode: "US-HI", from: "typical", to: "some" },
      { change: "removed", family: "Vegetation and landscape", name: "Red soil", country: "MX", regionCode: null, from: "lacks", to: null },
    ]);
    expect(compareClaimLinks(a, a)).toEqual([]);
  });

  it("pairs the jobs' Claims, and marks a Claim only one job tagged", () => {
    const both = "c1";
    const onlyA = "c2";
    const res = compareJobLinks(
      new Map([
        [both, [link("White centre line", "GH", "typical")]],
        [onlyA, []],
      ]),
      new Map([[both, []]]),
    );
    expect(res).toEqual([
      {
        claimId: both,
        a: [link("White centre line", "GH", "typical")],
        b: [],
        differences: [{ change: "removed", family: "Road lines", name: "White centre line", country: "GH", regionCode: null, from: "typical", to: null }],
      },
      { claimId: onlyA, a: [], b: null, differences: [] },
    ]);
  });
});

describe("which Claims a trial's promotion tags (#94)", () => {
  const at = new Date("2026-11-26T10:00:00Z");
  const claims = [
    { id: "untagged", cluesPromptVersion: null, cluesTaggedAt: null },
    { id: "older", cluesPromptVersion: "clue-tag-v2", cluesTaggedAt: at },
    { id: "same", cluesPromptVersion: "clue-tag-v3", cluesTaggedAt: at },
    { id: "newer", cluesPromptVersion: "clue-tag-v4", cluesTaggedAt: at },
  ];

  it("takes untagged Claims and Claims an older version tagged, and leaves the rest", () => {
    expect(trialPromotionPlan(claims, "clue-tag-v3", false)).toEqual({
      promote: ["untagged", "older"],
      skipped: [
        { claimId: "same", reason: "Already tagged by clue-tag-v3" },
        { claimId: "newer", reason: "Already tagged by clue-tag-v4" },
      ],
    });
  });

  it("takes them all when forced", () => {
    expect(trialPromotionPlan(claims, "clue-tag-v3", true)).toEqual({ promote: ["untagged", "older", "same", "newer"], skipped: [] });
  });
});
