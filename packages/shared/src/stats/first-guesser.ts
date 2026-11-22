/** The guess fields `duoFirstGuesser` reads; a `StatsGuess` has them all. */
export interface FirstGuesserGuess {
  playerId: string | null;
  isDuo: boolean;
  timedOut: boolean;
  /** Seconds from the Round's start to the guess. */
  secondsToGuess: number | null;
}

/**
 * Who guessed first within the Duo on one Round (GLOSSARY: Timed-out guess):
 * the Duo Player who pressed guess earlier, since a pressed guess beats a
 * timed-out one whatever their timestamps. "bothTimedOut" when both Duo
 * Players' guesses timed out; "noPressedGuess" when no Duo Player pressed
 * otherwise (one timed out and the other didn't guess, or nobody guessed).
 */
export type DuoFirstGuesser =
  | { kind: "player"; playerId: string }
  | { kind: "bothTimedOut" }
  | { kind: "noPressedGuess" };

/** Opponents' guesses, and their times, never count. */
export function duoFirstGuesser(guesses: readonly FirstGuesserGuess[]): DuoFirstGuesser {
  const duo = guesses.filter(
    (g): g is FirstGuesserGuess & { playerId: string } => g.isDuo && g.playerId !== null,
  );
  let first: (FirstGuesserGuess & { playerId: string }) | undefined;
  for (const g of duo) {
    if (g.timedOut) continue;
    if (!first || earlier(g.secondsToGuess, first.secondsToGuess)) first = g;
  }
  if (first) return { kind: "player", playerId: first.playerId };
  const timedOutPlayers = new Set(duo.filter((g) => g.timedOut).map((g) => g.playerId));
  return timedOutPlayers.size >= 2 ? { kind: "bothTimedOut" } : { kind: "noPressedGuess" };
}

/** A pressed guess with no time sorts after one with a time. */
function earlier(a: number | null, b: number | null): boolean {
  if (a === null) return false;
  return b === null || a < b;
}
