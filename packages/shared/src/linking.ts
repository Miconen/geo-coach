import type { DerivedRound, RoundPhase } from "./geoguessr.js";

export interface TimeInterval {
  startedAt: Date;
  endedAt: Date;
}

export interface UtteranceRoundLink {
  roundNumber: number;
  phase: RoundPhase;
}

/**
 * Half-open overlap check [a.start, a.end) vs [b.start, b.end), treating zero-length intervals
 * as point containment inside [b.start, b.end).
 */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  const aStart = a.startedAt.getTime();
  const aEnd = a.endedAt.getTime();
  const bStart = b.startedAt.getTime();
  const bEnd = b.endedAt.getTime();

  if (aStart === aEnd) {
    return aStart >= bStart && aStart < bEnd;
  }
  if (bStart === bEnd) {
    return bStart >= aStart && bStart < aEnd;
  }
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Links an Utterance's UTC interval to every overlapping Round phase across a Game.
 * Boundary-straddling Utterances link to both adjacent buckets without splitting.
 */
export function linkUtteranceToRounds(
  utterance: TimeInterval,
  rounds: readonly Pick<DerivedRound, "roundNumber" | "phases">[],
): UtteranceRoundLink[] {
  const links: UtteranceRoundLink[] = [];
  for (const round of rounds) {
    for (const phaseInterval of round.phases) {
      if (intervalsOverlap(utterance, phaseInterval)) {
        links.push({
          roundNumber: round.roundNumber,
          phase: phaseInterval.phase,
        });
      }
    }
  }
  return links;
}
