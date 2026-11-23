import { describe, expect, it } from "vitest";
import {
  claimItemInputSchema,
  deriveClaimStatus,
  learningItemInputSchema,
  uuidv7,
} from "../index.js";

describe("deriveClaimStatus (ADR 0005)", () => {
  it("is speculated with no Evidence", () => {
    expect(deriveClaimStatus([])).toBe("speculated");
  });

  it("is verified with only Evidence for", () => {
    expect(
      deriveClaimStatus([
        { kind: "round", direction: "for" },
        { kind: "player", direction: "for" },
        { kind: "documentation", direction: "for" },
      ]),
    ).toBe("verified");
  });

  it("is disproved with only Player or Documentation Evidence against", () => {
    expect(deriveClaimStatus([{ kind: "player", direction: "against" }])).toBe("disproved");
    expect(deriveClaimStatus([{ kind: "documentation", direction: "against" }])).toBe("disproved");
  });

  it("is disputed with Evidence both for and against", () => {
    expect(
      deriveClaimStatus([
        { kind: "round", direction: "for" },
        { kind: "player", direction: "against" },
      ]),
    ).toBe("disputed");
  });

  it("never counts a Round against a Claim", () => {
    expect(deriveClaimStatus([{ kind: "round", direction: "against" }])).toBe("verified");
    expect(
      deriveClaimStatus([
        { kind: "round", direction: "against" },
        { kind: "player", direction: "for" },
      ]),
    ).toBe("verified");
  });
});

describe("claimItemInputSchema", () => {
  it("rejects Round Evidence against a Claim", () => {
    const res = claimItemInputSchema.safeParse({
      text: "Panama has truck coverage.",
      countries: ["PA"],
      evidence: [{ kind: "round", roundId: uuidv7(), direction: "against" }],
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toMatch(/Round only ever counts for/);
  });

  it("rejects Player Evidence from agents", () => {
    const res = claimItemInputSchema.safeParse({
      text: "Panama has truck coverage.",
      evidence: [{ kind: "player", playerId: uuidv7(), direction: "for" }],
    });
    expect(res.success).toBe(false);
  });

  it("takes either new Claim text or an existing claimId with Evidence", () => {
    expect(claimItemInputSchema.safeParse({ countries: ["PA"] }).success).toBe(false);
    expect(claimItemInputSchema.safeParse({ claimId: uuidv7() }).success).toBe(false);
    expect(
      claimItemInputSchema.safeParse({ claimId: uuidv7(), text: "x", evidence: [] }).success,
    ).toBe(false);
    expect(
      claimItemInputSchema.safeParse({
        claimId: uuidv7(),
        evidence: [{ kind: "round", roundId: uuidv7() }],
      }).success,
    ).toBe(true);
  });

  it("validates countries and regions like a Learning", () => {
    expect(
      claimItemInputSchema.safeParse({ text: "x", countries: ["ZZ"] }).success,
    ).toBe(false);
    expect(
      claimItemInputSchema.safeParse({
        text: "x",
        countries: ["BG"],
        regions: [{ country: "RO", name: "Cluj" }],
      }).success,
    ).toBe(false);
  });
});

describe("learningItemInputSchema claimId", () => {
  const base = { text: "x", utteranceRefs: ["u1"], claimId: uuidv7() };

  it("lets clues and distinguishers link a Claim", () => {
    expect(learningItemInputSchema.safeParse({ ...base, kind: "clue" }).success).toBe(true);
    expect(learningItemInputSchema.safeParse({ ...base, kind: "distinguisher" }).success).toBe(true);
  });

  it("refuses a Claim on strategies, mistakes and Study items", () => {
    for (const kind of ["strategy", "mistake", "study"]) {
      expect(learningItemInputSchema.safeParse({ ...base, kind }).success).toBe(false);
    }
  });
});
