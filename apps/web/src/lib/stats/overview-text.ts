import type { MistakeClass, Overview } from "@geo-coach/shared";

// Wording for the Overview & rating section: number formats and the one-line
// takeaways computed above each chart.

export const MISTAKE_CLASS_LABELS: Record<MistakeClass, string> = {
  "wrong-country": "Wrong country",
  far: "Right country, far",
  close: "Right country, close",
};

export function formatNumber(n: number | null, digits = 0): string {
  return n === null
    ? "–"
    : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSigned(n: number | null): string {
  if (n === null) return "–";
  const rounded = Math.round(n);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${formatNumber(Math.abs(rounded))}`;
}

export function formatPercent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)}%`;
}

export function formatSeconds(seconds: number | null): string {
  return seconds === null ? "–" : `${seconds.toFixed(1)} s`;
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function unitLabel(unit: "games" | "rounds", n: number): string {
  return unit === "games" ? plural(n, "Game", "Games") : plural(n, "Round", "Rounds");
}

/** The note shown when Game panels ignore the country filter. */
export const COUNTRY_FILTER_NOTE =
  "Rating, win rate and streaks ignore the country filter: a Game can't be split by country.";

export function climbingTakeaway(o: Overview): string {
  const { ratingChange, ratingFrom, rating, winRate, decided } = o.games;
  if (ratingChange === null) return "No rated Games in this filter.";
  const direction = ratingChange > 0 ? "Up" : ratingChange < 0 ? "Down" : "Level";
  const bands =
    o.streaks.winRuns.length + o.streaks.lossRuns.length > 0
      ? " Green bands are 3+ wins in a row, red bands 3+ losses."
      : "";
  return (
    `${direction}${ratingChange !== 0 ? ` ${formatNumber(Math.abs(ratingChange))}` : ""} over ` +
    `${unitLabel("games", o.games.games)} (${ratingFrom} → ${rating}), ` +
    `winning ${formatPercent(winRate)} of ${formatNumber(decided)}.${bands}`
  );
}

export function ratedAboveTakeaway(o: Overview): string {
  const { unit, points } = o.ratedAbove;
  const above = points.filter((p) => p.ratingGap > 0);
  const below = points.filter((p) => p.ratingGap <= 0);
  const rate = (ps: typeof points) => ps.filter((p) => p.won).length / ps.length;
  const standIn = unit === "rounds" ? " Rounds stand in for Games under a country filter." : "";
  if (above.length === 0) {
    return `No ${unit === "games" ? "Games" : "Rounds"} against higher-rated Opponents in this filter.${standIn}`;
  }
  const versusBelow =
    below.length > 0
      ? `, against ${formatPercent(rate(below))} of ${unitLabel(unit, below.length)} against the rest`
      : "";
  return (
    `We win ${formatPercent(rate(above))} of ${unitLabel(unit, above.length)} against ` +
    `higher-rated Opponents${versusBelow}.${standIn}`
  );
}

export function damageTakeaway(o: Overview): string {
  const { classes, points, slowThresholdSeconds } = o.damage;
  const total = classes.reduce((sum, c) => sum + c.damage, 0);
  const worst = [...classes].sort((a, b) => b.damage - a.damage)[0];
  if (!worst || points.length === 0 || total === 0) return "No lost Rounds in this filter.";
  const slow =
    slowThresholdSeconds !== null
      ? ` Ringed guesses were slow (over ${Math.round(slowThresholdSeconds)} s).`
      : "";
  return (
    `${MISTAKE_CLASS_LABELS[worst.mistakeClass]} costs most: ${formatNumber(worst.damage)} damage over ` +
    `${unitLabel("rounds", worst.rounds)}, ${formatPercent(worst.damage / total)} of the damage taken.${slow}`
  );
}
