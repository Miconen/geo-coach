/** A Round a Learning's cited speech overlaps: a candidate for the Learning's derived Rounds. */
export interface DerivedRoundCandidate {
  roundId: string;
  /** How many of the Learning's cited Utterances overlap the Round's window. */
  citedCount: number;
  answerCountry: string | null;
  guesses: ReadonlyArray<{ countryCode: string | null; isDuo: boolean }>;
}

/**
 * The derived Rounds a Learning is about (#87), so speech that spills into the next Round doesn't attach it there.
 * Keeps the related candidates: the answer country, or a country a Duo guess landed in, is among the Learning's
 * countries (Opponents' guesses don't count). With none related, keeps the candidate with the most cited Utterances,
 * every one on a tie. Candidates keep their order; none in, none out (the debrief fallback then applies).
 */
export function keptDerivedRoundIds(
  candidates: readonly DerivedRoundCandidate[],
  learningCountries: readonly string[],
): string[] {
  const countries = new Set(learningCountries.map((c) => c.toUpperCase()));
  const named = (code: string | null) => code !== null && countries.has(code.toUpperCase());
  const related = candidates.filter(
    (c) => named(c.answerCountry) || c.guesses.some((g) => g.isDuo && named(g.countryCode)),
  );
  if (related.length > 0) return related.map((c) => c.roundId);
  const most = Math.max(0, ...candidates.map((c) => c.citedCount));
  return candidates.filter((c) => c.citedCount === most).map((c) => c.roundId);
}
