// A focused Round's transcript panel (#79, #83), as pure data: the lines before the Countdown, the Countdown band
// (GLOSSARY: from the first guess, by either team, to the end of guessing), and the lines after guessing ended. The
// band opens on the guess that started it; a Timed-out guess closes it, since the timer submits it a moment after
// guessing ends. RoundTranscript.svelte only renders this.
import type { DebriefRound } from "./types.js";

export type TranscriptLine =
  | { kind: "speech"; id: string; at: number; playerId: string; text: string; after: boolean }
  | {
      kind: "guess";
      id: string;
      at: number;
      /** The Duo's Player, or null for Opponents (whose guess shows only when it started the Countdown). */
      playerId: string | null;
      isDuo: boolean;
      /** Started the Countdown: the band's opener, carrying ⚡ and the Countdown's length. */
      first: boolean;
      timedOut: boolean;
      after: boolean;
    };

export interface RoundTranscriptModel {
  /** Before the Countdown, or every line up to the end of guessing when the Round has no timer start. */
  before: TranscriptLine[];
  /** The Countdown band, or null without a timer start. */
  band: { lengthS: number; lines: TranscriptLine[] } | null;
  /** After guessing ended: reactions to the reveal, dimmed and hidden under Recall. */
  after: TranscriptLine[];
}

export function roundTranscript(round: Pick<DebriefRound, "transcript" | "guesses" | "endS" | "countdownS">): RoundTranscriptModel {
  const lines: TranscriptLine[] = [
    ...round.transcript.map((u) => ({
      kind: "speech" as const,
      id: u.id,
      at: u.atS,
      playerId: u.playerId,
      text: u.text,
      after: u.afterEnd,
    })),
    // The Duo's guesses, bare (no country or score: nobody knows them yet), and an Opponent's only when it started
    // the Countdown, so the band opens on what started it.
    ...round.guesses.flatMap((g, i) => {
      if (g.secondsToGuess === null || !(g.isDuo || g.guessedFirst)) return [];
      // A Timed-out guess lands just after guessing ends; it belongs at the band's end, before the Round-end line.
      const at = g.timedOut ? Math.min(g.secondsToGuess, round.endS) : g.secondsToGuess;
      return [
        {
          kind: "guess" as const,
          id: `guess-${i}`,
          at,
          playerId: g.playerId,
          isDuo: g.isDuo,
          first: g.guessedFirst,
          timedOut: g.timedOut,
          after: !g.timedOut && at >= round.endS,
        },
      ];
    }),
  ].sort((a, b) => a.at - b.at || rank(a) - rank(b));

  const during = lines.filter((l) => !l.after);
  const after = lines.filter((l) => l.after);
  const start = round.countdownS;
  if (start === null) return { before: during, band: null, after };

  const inBand = (l: TranscriptLine) => l.at >= start || (l.kind === "guess" && (l.first || l.timedOut));
  const isTimedOut = (l: TranscriptLine) => l.kind === "guess" && l.timedOut && !l.first;
  // Timed-out guesses close the band.
  const band = [...during.filter((l) => inBand(l) && !isTimedOut(l)), ...during.filter(isTimedOut)];
  // The guess that started the Countdown opens the band, even if a stored time rounds a hair either side of it.
  const opener = band.findIndex((l) => l.kind === "guess" && l.first);
  if (opener > 0) band.unshift(...band.splice(opener, 1));
  return {
    before: during.filter((l) => !inBand(l)),
    band: { lengthS: Math.max(0, Math.round(round.endS - start)), lines: band },
    after,
  };
}

/** At the same moment: the opener first, Timed-out guesses last (they close the band). */
const rank = (l: TranscriptLine) => (l.kind === "guess" ? (l.first ? -1 : l.timedOut ? 1 : 0) : 0);
