import { describe, expect, it } from "vitest";
import { keptDerivedRoundIds, type DerivedRoundCandidate } from "../learning-rounds.js";

const round = (
  roundId: string,
  citedCount: number,
  answerCountry: string | null,
  guesses: Array<{ countryCode: string | null; isDuo: boolean }> = [],
): DerivedRoundCandidate => ({ roundId, citedCount, answerCountry, guesses });

// #87: among the Rounds a Learning's cited speech overlaps, keep the related ones, else the majority.
describe("keptDerivedRoundIds", () => {
  it("drops the next Round that one spilling Utterance reaches", () => {
    const kept = keptDerivedRoundIds([round("chile", 4, "CL"), round("south-africa", 1, "ZA")], ["CL", "AR"]);
    expect(kept).toEqual(["chile"]);
  });

  it("keeps every related Round, even when an unrelated one holds most of the speech", () => {
    const kept = keptDerivedRoundIds(
      [round("r5", 1, "CZ"), round("r6", 5, "PL"), round("r8", 1, "SK", [{ countryCode: "CZ", isDuo: true }])],
      ["CZ"],
    );
    expect(kept).toEqual(["r5", "r8"]);
  });

  it("keeps the majority candidate when none is related", () => {
    expect(keptDerivedRoundIds([round("a", 1, "BR"), round("b", 3, "PE")], ["CL"])).toEqual(["b"]);
  });

  it("keeps every tied candidate", () => {
    expect(keptDerivedRoundIds([round("a", 2, "BR"), round("b", 2, "PE"), round("c", 1, "ZA")], ["CL"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("falls back to the majority for a Learning that names no country", () => {
    expect(keptDerivedRoundIds([round("a", 3, "CL"), round("b", 1, "CL")], [])).toEqual(["a"]);
  });

  it("counts a Duo guess's country, not an Opponent's", () => {
    const guessed = (isDuo: boolean) => [{ countryCode: "CL", isDuo }];
    const candidates = [round("main", 1, "BR", guessed(false)), round("next", 2, "PE", guessed(true))];
    expect(keptDerivedRoundIds(candidates, ["CL"])).toEqual(["next"]);
    const opponentOnly = [round("main", 3, "BR", guessed(false)), round("next", 1, "PE")];
    expect(keptDerivedRoundIds(opponentOnly, ["CL"])).toEqual(["main"]);
  });

  it("keeps nothing without candidates, so the debrief fallback can apply", () => {
    expect(keptDerivedRoundIds([], ["CL"])).toEqual([]);
  });
});
