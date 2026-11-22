import { describe, expect, it } from "vitest";
import {
  compareEffect,
  effectConditions,
  effectContext,
  effectOutcomes,
  scanEffects,
  splitEffect,
  type StatsGuess,
  type StatsRound,
} from "../index.js";
import { makeGame, makeGuess, makePayload, makeRound } from "./stats-fixtures.js";

const t0 = Date.parse("2026-11-01T18:00:00Z");
const PLAYERS = [{ id: "a", displayName: "Mico" }, { id: "b", displayName: "Cerkie" }];
const cond = (id: string) => effectConditions(PLAYERS).find((c) => c.id === id)!;
const out = (id: string) => effectOutcomes(PLAYERS).find((o) => o.id === id)!;

let seq = 0;
/** A Round where `first` pressed first and `best` had the best guess. */
function round(first: "a" | "b", best: "a" | "b", o: Partial<StatsRound> = {}): StatsRound {
  seq += 1;
  const g = (id: string, s: number): StatsGuess =>
    makeGuess({ playerId: id, secondsToGuess: s, isBestForTeam: id === best, countryCode: "BG" });
  return makeRound(`r${seq}`, "g1", {
    roundNumber: seq,
    startedAtMs: t0 + seq * 60_000,
    guesses: [g(first, 10), g(first === "a" ? "b" : "a", 20)],
    ...o,
  });
}

const many = (n: number, f: () => StatsRound) => Array.from({ length: n }, f);

describe("compareEffect", () => {
  it("compares the outcome where the condition holds against where it doesn't", () => {
    const rounds = [...many(20, () => round("a", "a")), ...many(20, () => round("b", "b"))];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    const r = compareEffect(rounds, cond("first:a"), out("best:a"), ctx);
    expect(r.when).toMatchObject({ n: 20, value: 1 });
    expect(r.otherwise).toMatchObject({ n: 20, value: 0 });
    expect(r.diff).toBe(1);
  });

  it("calls a difference real only when it's clear of noise with enough Rounds", () => {
    const mixed = (first: "a" | "b") => many(20, () => round(first, seq % 2 ? "a" : "b"));
    const rounds = [...mixed("a"), ...mixed("b")];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    expect(compareEffect(rounds, cond("first:a"), out("best:a"), ctx).real).toBe(false);

    const few = [round("a", "a"), round("b", "b")];
    expect(compareEffect(few, cond("first:a"), out("best:a"), ctx).real).toBe(false);
  });

  it("reads HP going into the Round from the Game's earlier Rounds", () => {
    const rounds = [
      round("a", "a", { roundNumber: 1, hpDelta: -1000 }),
      round("a", "a", { roundNumber: 2, hpDelta: 500 }),
    ];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    expect(cond("behind").test(rounds[0]!, ctx)).toBeNull();
    expect(cond("behind").test(rounds[1]!, ctx)).toBe(true);
  });

  it("looks at the previous Game only when it was played shortly before", () => {
    const games = [
      makeGame("g0", { startedAtMs: t0 - 30 * 60_000, won: false }),
      makeGame("g1", { startedAtMs: t0 }),
      makeGame("g2", { startedAtMs: t0 + 10 * 60 * 60_000 }),
    ];
    const ctx = effectContext(makePayload({ games }));
    expect(cond("after-loss").test(makeRound("x", "g1"), ctx)).toBe(true);
    expect(cond("after-loss").test(makeRound("y", "g2"), ctx)).toBeNull();
  });
});

describe("splitEffect and scanEffects", () => {
  it("splits the comparison per country", () => {
    const rounds = [
      ...many(12, () => round("a", "a", { countryCode: "BR" })),
      ...many(12, () => round("b", "b", { countryCode: "BR" })),
      ...many(3, () => round("a", "b", { countryCode: "FR" })),
      ...many(3, () => round("b", "a", { countryCode: "FR" })),
    ];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    const split = splitEffect(rounds, cond("first:a"), out("best:a"), ctx, "country");
    expect(split.map((s) => [s.key, s.result.diff])).toEqual([
      ["BR", 1],
      ["FR", -1],
    ]);
  });

  it("finds only strong signals", () => {
    const rounds = [...many(30, () => round("a", "a")), ...many(30, () => round("b", "b"))];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    const found = scanEffects(rounds, effectConditions(PLAYERS), effectOutcomes(PLAYERS), ctx);
    expect(found.some((f) => f.condition.id === "first:a" && f.outcome.id === "best:a")).toBe(true);
    expect(found.every((f) => Math.abs(f.result.z!) >= 3.5)).toBe(true);
  });
});

describe("scanEffects skips what a condition implies by definition", () => {
  it("never pairs pressing first with the time to the first guess", () => {
    const fast = (s: number) =>
      makeRound(`f${s}`, "g1", {
        guesses: [makeGuess({ playerId: "a", secondsToGuess: s }), makeGuess({ playerId: null, isDuo: false, secondsToGuess: 30 })],
      });
    const slow = (s: number) =>
      makeRound(`s${s}`, "g1", {
        guesses: [makeGuess({ playerId: "a", secondsToGuess: 40 + s }), makeGuess({ playerId: null, isDuo: false, secondsToGuess: 30 })],
      });
    const rounds = [...Array.from({ length: 20 }, (_, i) => fast(i)), ...Array.from({ length: 20 }, (_, i) => slow(i))];
    const ctx = effectContext(makePayload({ games: [makeGame("g1")], rounds }));
    const found = scanEffects(rounds, effectConditions(PLAYERS), effectOutcomes(PLAYERS), ctx);
    expect(found.some((f) => f.condition.id === "duo-first" && f.outcome.id === "first-press")).toBe(false);
  });
});
