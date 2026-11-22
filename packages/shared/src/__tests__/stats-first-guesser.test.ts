import { describe, expect, it } from "vitest";
import { duoFirstGuesser, type FirstGuesserGuess } from "../index.js";

const pressed = (playerId: string, secondsToGuess: number): FirstGuesserGuess => ({
  playerId,
  isDuo: true,
  timedOut: false,
  secondsToGuess,
});
const timedOut = (playerId: string, secondsToGuess: number): FirstGuesserGuess => ({
  playerId,
  isDuo: true,
  timedOut: true,
  secondsToGuess,
});
const opponent = (secondsToGuess: number, timedOut = false): FirstGuesserGuess => ({
  playerId: null,
  isDuo: false,
  timedOut,
  secondsToGuess,
});

describe("duoFirstGuesser", () => {
  it("picks the Duo Player who pressed guess earlier", () => {
    expect(duoFirstGuesser([pressed("miko", 30), pressed("sora", 22)])).toEqual({
      kind: "player",
      playerId: "sora",
    });
  });

  it("lets a pressed guess beat a timed-out one even when the timed-out timestamp is earlier", () => {
    expect(duoFirstGuesser([timedOut("miko", 40), pressed("sora", 41)])).toEqual({
      kind: "player",
      playerId: "sora",
    });
  });

  it("names nobody when both Duo guesses timed out", () => {
    expect(duoFirstGuesser([timedOut("miko", 41.2), timedOut("sora", 41.5)])).toEqual({
      kind: "bothTimedOut",
    });
  });

  it("names the presser when the other Player placed no guess", () => {
    expect(duoFirstGuesser([pressed("miko", 35)])).toEqual({ kind: "player", playerId: "miko" });
  });

  it("names nobody when no Duo Player pressed guess", () => {
    expect(duoFirstGuesser([timedOut("miko", 41.2)])).toEqual({ kind: "noPressedGuess" });
    expect(duoFirstGuesser([])).toEqual({ kind: "noPressedGuess" });
  });

  it("ignores Opponents' guesses and times", () => {
    const duo = [pressed("miko", 30), timedOut("sora", 41.3)];
    expect(duoFirstGuesser([opponent(5), ...duo, opponent(10)])).toEqual({
      kind: "player",
      playerId: "miko",
    });
    expect(
      duoFirstGuesser([opponent(3), timedOut("miko", 41.2), timedOut("sora", 41.5)]),
    ).toEqual({ kind: "bothTimedOut" });
  });
});
