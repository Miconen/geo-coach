import { describe, expect, it } from "vitest";
import type { ClaimStatus } from "@geo-coach/shared";
import type { WorkbenchClaim, WorkbenchEvidence } from "$lib/server/workbench/view-model.js";
import {
  CLAIM_STATUSES,
  countByStatus,
  describeEvidence,
  filterWorkbenchClaims,
  groupClaimsByCountry,
} from "../knowledge.js";

function claim(id: string, status: ClaimStatus, countries: string[], topics: string[] = []): WorkbenchClaim {
  return {
    id,
    text: `Claim ${id}`,
    countries,
    regions: [],
    topics,
    status,
    evidence: [],
    viewerDirection: null,
    learningIds: [],
    imageUrls: [],
    imageIds: [],
    createdAt: "2026-11-20T19:00:00.000Z",
  };
}

const CLAIMS = [
  claim("a", "speculated", ["BG"], ["coverage"]),
  claim("b", "verified", ["BG", "RO"], ["bollards"]),
  claim("c", "disproved", ["PA"], ["coverage"]),
  claim("d", "disputed", []),
];
const ALL = { status: "all", topic: "all", query: "", country: null } as const;

describe("knowledge bank view helpers", () => {
  it("filters by each status", () => {
    for (const status of CLAIM_STATUSES) {
      const res = filterWorkbenchClaims(CLAIMS, { ...ALL, status });
      expect(res).toHaveLength(1);
      expect(res[0]!.status).toBe(status);
    }
    expect(countByStatus(CLAIMS)).toEqual({ speculated: 1, verified: 1, disproved: 1, disputed: 1 });
  });

  it("filters by topic, country and text, including country names", () => {
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, topic: "coverage" }).map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, country: "RO" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, query: "panama" }).map((c) => c.id)).toEqual(["c"]);
  });

  it("under Recall a masked Claim matches no query, so its count stays out (#56 3a)", () => {
    const masked = (id: string) => id === "c";
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, query: "panama", masked })).toEqual([]);
    expect(countByStatus(filterWorkbenchClaims(CLAIMS, { ...ALL, query: "panama", masked }))[CLAIMS.find((c) => c.id === "c")!.status]).toBe(0);
    // Without a query the masked Claim is listed (as a masked card), and a revealed one matches.
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, masked }).map((c) => c.id)).toContain("c");
    expect(filterWorkbenchClaims(CLAIMS, { ...ALL, query: "panama", masked: () => false }).map((c) => c.id)).toEqual(["c"]);
  });

  it("groups Claims by country name, a distinguisher under each country, general last", () => {
    const groups = groupClaimsByCountry(CLAIMS);
    expect(groups.map((g) => [g.code, g.claims.map((c) => c.id)])).toEqual([
      ["BG", ["a", "b"]],
      ["PA", ["c"]],
      ["RO", ["b"]],
      [null, ["d"]],
    ]);
    // Narrowed to one country, a two-country Claim shows only there
    expect(groupClaimsByCountry([CLAIMS[1]!], "RO").map((g) => g.code)).toEqual(["RO"]);
  });

  it("says which Round, Player or Source section Evidence points at", () => {
    const wb = {
      roundsById: {
        r1: { roundNumber: 3, gameId: "g1", countryName: "Bulgaria", countryCode: "BG", regionName: "Sofia" },
      },
      gamesById: { g1: { startedAt: "2026-11-20T19:00:00.000Z" } },
      players: { p1: { displayName: "Miko" } },
    } as unknown as Parameters<typeof describeEvidence>[1];
    const base: WorkbenchEvidence = {
      id: "e",
      kind: "round",
      direction: "for",
      roundId: "r1",
      playerId: null,
      source: null,
      note: null,
      createdAt: "2026-11-20T19:00:00.000Z",
    };
    expect(describeEvidence(base, wb)).toMatch(/^Round 3 \(.+\): Bulgaria \/ Sofia$/);
    expect(describeEvidence({ ...base, kind: "player", playerId: "p1", direction: "against" }, wb)).toBe("Miko rejected it");
    expect(
      describeEvidence(
        {
          ...base,
          kind: "documentation",
          source: { sourceId: "s", title: "Plonkit: Bulgaria", versionNo: 2, anchor: "bollards", heading: "Bollards" },
        },
        wb,
      ),
    ).toBe("Plonkit: Bulgaria v2 § Bollards");
  });
});
