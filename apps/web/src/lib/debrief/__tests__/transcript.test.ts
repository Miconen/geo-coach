import { describe, expect, it } from "vitest";
import { roundTranscript, type TranscriptLine } from "../transcript.js";
import type { DebriefGuess, DebriefLine, DebriefRound } from "../types.js";

// Shaped on Game 1 · Round 1 of the 2026-11-23 18:31 dev Session: Mico guessed Lithuania first at 72.1 s, starting
// the Countdown; Cerkie's guess in Germany was submitted by the timer at 88.2 s, a moment after guessing ended at 87.1 s.
const MICO = "p-mico";
const CERKIE = "p-cerkie";

const guess = (o: Partial<DebriefGuess>): DebriefGuess => ({
  playerId: null,
  isDuo: false,
  lat: 0,
  lng: 0,
  countryCode: null,
  distanceMeters: null,
  score: 0,
  secondsToGuess: null,
  timedOut: false,
  guessedFirst: false,
  isBestForTeam: false,
  slower: false,
  ...o,
});
const say = (id: string, playerId: string, atS: number, afterEnd = false): DebriefLine => ({ id, playerId, text: id, atS, afterEnd });

type R = Pick<DebriefRound, "transcript" | "guesses" | "endS" | "countdownS">;
const round = (o: Partial<R> = {}): R => ({
  endS: 87.1,
  countdownS: 72.1,
  transcript: [say("u-early", CERKIE, 16), say("u-mid", MICO, 75), say("u-late", MICO, 92, true)],
  guesses: [
    guess({ playerId: CERKIE, isDuo: true, secondsToGuess: 88.2, timedOut: true, isBestForTeam: true }),
    guess({ playerId: MICO, isDuo: true, secondsToGuess: 72.1, guessedFirst: true }),
    guess({ isDuo: false, secondsToGuess: 80 }),
    guess({ isDuo: false, secondsToGuess: 85 }),
  ],
  ...o,
});
const ids = (ls: TranscriptLine[]) => ls.map((l) => l.id);

describe("roundTranscript", () => {
  it("puts the lines from the Countdown start to the end of guessing in one band, opened by the first guess", () => {
    const m = roundTranscript(round());
    expect(ids(m.before)).toEqual(["u-early"]);
    expect(m.band?.lengthS).toBe(15);
    expect(m.band?.lines[0]).toMatchObject({ kind: "guess", playerId: MICO, first: true });
    expect(ids(m.band!.lines)).toEqual(["guess-1", "u-mid", "guess-0"]);
    expect(ids(m.after)).toEqual(["u-late"]);
  });

  it("shows a Timed-out guess at the band's end, never after the Round-end line", () => {
    const m = roundTranscript(round());
    const last = m.band!.lines.at(-1)!;
    expect(last).toMatchObject({ kind: "guess", playerId: CERKIE, timedOut: true, after: false });
    expect(m.after.some((l) => l.kind === "guess")).toBe(false);
  });

  it("opens the band on the Opponents' guess when they guessed first, and shows no other Opponent guess", () => {
    const m = roundTranscript(
      round({
        countdownS: 40,
        guesses: [
          guess({ playerId: MICO, isDuo: true, secondsToGuess: 60 }),
          guess({ isDuo: false, secondsToGuess: 40, guessedFirst: true }),
          guess({ isDuo: false, secondsToGuess: 50 }),
        ],
      }),
    );
    expect(m.band?.lines[0]).toMatchObject({ kind: "guess", isDuo: false, playerId: null, first: true });
    expect(m.band?.lengthS).toBe(47);
    const guesses = [...m.before, ...m.band!.lines, ...m.after].filter((l) => l.kind === "guess");
    expect(guesses).toHaveLength(2);
  });

  it("opens the band on the first guess even when the stored timer start is a hair after it", () => {
    const m = roundTranscript(round({ countdownS: 72.4 }));
    expect(m.band?.lines[0]).toMatchObject({ kind: "guess", first: true });
    expect(m.before.some((l) => l.kind === "guess")).toBe(false);
  });

  it("draws no band without a timer start, and keeps every line up to the end of guessing before the Round-end line", () => {
    const m = roundTranscript(round({ countdownS: null }));
    expect(m.band).toBeNull();
    expect(ids(m.before)).toEqual(["u-early", "guess-1", "u-mid", "guess-0"]);
    expect(ids(m.after)).toEqual(["u-late"]);
  });

  it("leaves out guesses with no time", () => {
    const m = roundTranscript(round({ guesses: [guess({ playerId: MICO, isDuo: true, secondsToGuess: null, guessedFirst: true })] }));
    expect([...m.before, ...m.band!.lines].some((l) => l.kind === "guess")).toBe(false);
  });
});
