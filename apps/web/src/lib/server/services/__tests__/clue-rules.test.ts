import { describe, expect, it } from "vitest";
import { claimTaggingQueue, latestClueRunFor, needsClueTagging, type QueueClaim } from "../clues.js";

const t = (min: number) => new Date(Date.UTC(2026, 10, 20, 12, min));

function claim(id: string, over: Partial<QueueClaim> = {}): QueueClaim {
  return { id, createdAt: t(0), updatedAt: null, cluesPromptVersion: null, cluesTaggedAt: null, ...over };
}

describe("the Claim tagging queue (#89)", () => {
  it("holds untagged Claims and those tagged by an older prompt version", () => {
    expect(needsClueTagging(claim("a"), "clue-tag-v2")).toBe(true);
    expect(needsClueTagging(claim("a", { cluesPromptVersion: "clue-tag-v1", cluesTaggedAt: t(5) }), "clue-tag-v2")).toBe(true);
    expect(needsClueTagging(claim("a", { cluesPromptVersion: "clue-tag-v2", cluesTaggedAt: t(5) }), "clue-tag-v2")).toBe(false);
  });

  it("puts a Claim edited after its tagging back in", () => {
    const tagged = { cluesPromptVersion: "clue-tag-v1", cluesTaggedAt: t(5) };
    expect(needsClueTagging(claim("a", { ...tagged, updatedAt: t(4) }), "clue-tag-v1")).toBe(false);
    expect(needsClueTagging(claim("a", { ...tagged, updatedAt: t(6) }), "clue-tag-v1")).toBe(true);
  });

  it("serves the most recently created or edited Claims first, up to the limit, skipping excluded ones", () => {
    const all = [
      claim("old", { createdAt: t(1) }),
      claim("new", { createdAt: t(9) }),
      claim("edited", { createdAt: t(0), updatedAt: t(20), cluesPromptVersion: "clue-tag-v1", cluesTaggedAt: t(10) }),
      claim("done", { createdAt: t(30), cluesPromptVersion: "clue-tag-v1", cluesTaggedAt: t(31) }),
      claim("taken", { createdAt: t(15) }),
    ];
    expect(claimTaggingQueue(all, "clue-tag-v1")).toEqual(["edited", "taken", "new", "old"]);
    expect(claimTaggingQueue(all, "clue-tag-v1", { limit: 2, exclude: new Set(["taken"]) })).toEqual(["edited", "new"]);
  });

  it("continues where a limited batch stopped once that batch is tagged", () => {
    const all = Array.from({ length: 5 }, (_, i) => claim(`c${i}`, { createdAt: t(i) }));
    const first = claimTaggingQueue(all, "v1", { limit: 3 });
    expect(first).toEqual(["c4", "c3", "c2"]);
    const after = all.map((c) => (first.includes(c.id) ? { ...c, cluesPromptVersion: "v1", cluesTaggedAt: t(50) } : c));
    expect(claimTaggingQueue(after, "v1", { limit: 3 })).toEqual(["c1", "c0"]);
  });
});

describe("which clues run's links a Round shows (ADR 0002)", () => {
  const guessing = { startedAt: t(10), endedAt: t(12) };
  const run = (id: string, start: number, end: number, finished: number | null, status = "finished" as const) => ({
    id,
    rangeStart: t(start),
    rangeEnd: t(end),
    status: finished === null ? ("open" as const) : status,
    finishedAt: finished === null ? null : t(finished),
  });

  it("is the latest finished run whose range covers the Round's guessing", () => {
    const runs = [run("r1", 0, 30, 40), run("r2", 5, 15, 50), run("r3", 20, 30, 60)];
    expect(latestClueRunFor(guessing, runs)?.id).toBe("r2");
  });

  it("ignores open runs and runs over other parts of the Session", () => {
    const runs = [run("r1", 0, 30, 40), run("r2", 0, 30, null), run("r3", 13, 30, 60)];
    expect(latestClueRunFor(guessing, runs)?.id).toBe("r1");
    expect(latestClueRunFor(guessing, [run("r3", 13, 30, 60)])).toBeNull();
  });
});
