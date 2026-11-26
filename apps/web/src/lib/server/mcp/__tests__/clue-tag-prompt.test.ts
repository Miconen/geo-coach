import { describe, expect, it } from "vitest";
import { resolveRegionName } from "@geo-coach/shared";
import { comparePromptVersions, loadClueVocabulary, loadPromptInstructions } from "../prompts.js";

// clue-tag-v3 (#94): the rules the graded first tagging run (Haiku, clue-tag-v2) showed were missing.
describe("the clue-tag-v3 prompt (#94)", () => {
  it("is the current Claim tagger prompt; v1 and v2 stay loadable by version for trials", async () => {
    const v3 = await loadPromptInstructions("clue-tag");
    expect(v3.promptVersion).toBe("clue-tag-v3");
    const v2 = await loadPromptInstructions("clue-tag", "clue-tag-v2");
    expect(v2.promptVersion).toBe("clue-tag-v2");
    expect(v2.instructions).toContain("(`clue-tag`, v2)");
    expect(v2.instructions).not.toContain("No contrast-based");
    expect((await loadPromptInstructions("clue-tag", "clue-tag-v1")).instructions).toContain("(`clue-tag`, v1)");
    expect((await loadClueVocabulary("clue-tag-v1")).families).toHaveLength(17);
    await expect(loadPromptInstructions("clue-tag", "clue-tag-v9")).rejects.toThrow(/Unknown/);
    await expect(loadPromptInstructions("extract", "extract-v1")).rejects.toThrow(/Unknown/);
  });

  it("holds each new rule with its example from the first run", async () => {
    const { instructions } = await loadPromptInstructions("clue-tag");
    const rules: Array<[string, string]> = [
      ["**No contrast-based *lacks*.**", "points to Sabah rather than Mexico or Indonesia"],
      ["**A rule isn't prevalence.**", "In Ghana a solid or double solid white line means no overtaking"],
      ["**A narrow scope caps at *some*.**", "TransAmerica Trail"],
      ["**Tag the subject, not the context.**", "Montenegrin Gen 3 always has them"],
      ["**\"Both A and B\" is *some* for each**", "Madagascar has both white and yellow centre lines"],
      ["**Absences and positives in some Regions are tagged.**", "Front licence plates in Canada point to Ontario or Quebec"],
    ];
    for (const [rule, example] of rules) {
      expect(instructions).toContain(rule);
      const at = instructions.indexOf(rule);
      // The example sits under its rule, before the next one.
      const next = instructions.indexOf("\n- **", at + rule.length);
      expect(instructions.slice(at, next === -1 ? undefined : next)).toContain(example);
    }
  });

  it("says the \"rather than\" example gives no lacks for the countries it contrasts", async () => {
    const { instructions } = await loadPromptInstructions("clue-tag");
    const line = instructions.split("\n").find((l) => l.includes("rather than Mexico or Indonesia"))!;
    expect(line).toMatch(/No \*lacks\* for MX or ID/);
    expect(line).not.toMatch(/(MX|ID) \*lacks\*/);
    // The Regions its examples link resolve, so the tagger can follow them.
    expect(resolveRegionName("MY", "Sabah")).not.toBeNull();
    expect(resolveRegionName("CA", "Ontario")?.code).toBe("CA-ON");
    expect(resolveRegionName("CA", "Quebec")?.code).toBe("CA-QC");
  });

  it("orders prompt versions by number, untagged first", () => {
    expect(comparePromptVersions("clue-tag-v2", "clue-tag-v3")).toBeLessThan(0);
    expect(comparePromptVersions("clue-tag-v10", "clue-tag-v3")).toBeGreaterThan(0);
    expect(comparePromptVersions(null, "clue-tag-v1")).toBeLessThan(0);
    expect(comparePromptVersions("clue-tag-v3", "clue-tag-v3")).toBe(0);
  });
});
