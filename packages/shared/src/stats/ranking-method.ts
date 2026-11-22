// How a ranking pulls a country's per-Round values toward the Duo's mean, so a
// country with few Rounds can't top or bottom a ranking on luck alone.

/** Turns a country's per-Round values and the Duo's mean into a sort value. */
export type RankingMethod = (values: readonly number[], duoMean: number) => number;

/** Rounds a country is padded with at the Duo's mean by the default method. */
export const RANKING_PRIOR_ROUNDS = 5;

/**
 * The default ranking method: the country's mean as if it also had
 * `RANKING_PRIOR_ROUNDS` Rounds at the Duo's mean.
 *
 * UNDER REVIEW: a first attempt; the method and its prior may be retuned.
 */
export const DEFAULT_RANKING_METHOD: RankingMethod = (values, duoMean) => {
  const sum = values.reduce((total, v) => total + v, 0);
  return (sum + RANKING_PRIOR_ROUNDS * duoMean) / (values.length + RANKING_PRIOR_ROUNDS);
};

/** Countries with fewer Rounds than this are greyed out and sort last (adjustable on the page). */
export const DEFAULT_GREY_OUT_ROUNDS = 5;
