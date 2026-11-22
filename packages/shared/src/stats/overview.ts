import { applyFilter, type FilteredStats, type StatsFilter } from "./filter.js";
import { gameHeadline, ratingSeries, streaks, type GameHeadline, type RatingPoint, type Streaks } from "./games.js";
import { roundHeadline, type RoundHeadline } from "./headline.js";
import type { StatsPayload, StatsRound } from "./payload.js";
import {
  gameRatingGapPoints,
  ratingGapBands,
  roundRatingGapPoints,
  type RatingGapBand,
  type RatingGapPoint,
} from "./rating-gap.js";
import {
  MISTAKE_CLASSES,
  bestDuoGuess,
  bestGuessShareOfCountrySize,
  damageTaken,
  isSlow,
  mistakeClass,
  slowThreshold,
  type MistakeClass,
} from "./rounds.js";

/** A lost Round on the "where does our damage come from?" scatter. */
export interface LostRoundPoint {
  roundId: string;
  gameId: string;
  countryCode: string;
  regionCode: string | null;
  mistakeClass: MistakeClass;
  /** How far off the best guess was. */
  km: number;
  /** That distance as a share of the country's size. */
  share: number;
  /** The best guess's points. */
  points: number;
  /** Damage taken, overkill counted. */
  damage: number;
  secondsToGuess: number | null;
  slow: boolean;
}

export interface MistakeClassTotal {
  mistakeClass: MistakeClass;
  rounds: number;
  damage: number;
}

/** Every lost Round with a mistake class and a known distance share. */
export function lostRoundPoints(
  rounds: readonly StatsRound[],
  slowThresholdSeconds: number | null,
): LostRoundPoint[] {
  return rounds.flatMap((r) => {
    const cls = mistakeClass(r);
    const share = bestGuessShareOfCountrySize(r);
    const guess = bestDuoGuess(r);
    if (r.hpDelta >= 0 || !cls || share === null || !guess || !r.countryCode) return [];
    return [
      {
        roundId: r.id,
        gameId: r.gameId,
        countryCode: r.countryCode,
        regionCode: r.regionCode,
        mistakeClass: cls,
        km: (guess.distanceMeters ?? 0) / 1000,
        share,
        points: guess.score,
        damage: damageTaken(r),
        secondsToGuess: guess.secondsToGuess,
        slow: isSlow(r, slowThresholdSeconds),
      },
    ];
  });
}

/** Rounds and Damage per mistake class, in MISTAKE_CLASSES order. */
export function mistakeClassTotals(points: readonly LostRoundPoint[]): MistakeClassTotal[] {
  return MISTAKE_CLASSES.map((cls) => {
    const inClass = points.filter((p) => p.mistakeClass === cls);
    return {
      mistakeClass: cls,
      rounds: inClass.length,
      damage: inClass.reduce((sum, p) => sum + p.damage, 0),
    };
  });
}

/** Everything the Overview & rating section shows, for one payload and filter. */
export interface Overview {
  /** True when the country filter is on: Game panels then ignore it. */
  countryFiltered: boolean;
  /** Game numbers, over the filter without its country part. */
  games: GameHeadline;
  /** Round numbers, over every filter. */
  rounds: RoundHeadline;
  rating: RatingPoint[];
  streaks: Streaks;
  ratedAbove: {
    /** What the points are: Games, or Rounds standing in for them under a country filter. */
    unit: "games" | "rounds";
    points: RatingGapPoint[];
    bands: RatingGapBand[];
  };
  damage: {
    /** Fixed over all the Duo's Rounds, so the filter never moves it. */
    slowThresholdSeconds: number | null;
    points: LostRoundPoint[];
    classes: MistakeClassTotal[];
  };
}

/** The filter without its country part, for panels a Game can't be split for. */
export function withoutCountryFilter(filter: StatsFilter): StatsFilter {
  return { ...filter, countryCodes: [] };
}

/**
 * The Overview & rating section. Round panels follow every filter; Game panels
 * (rating line, win rate, streaks) ignore the country filter, and the rated-above
 * chart switches to Rounds under it.
 */
export function overview(payload: StatsPayload, filter: StatsFilter): Overview {
  const countryFiltered = filter.countryCodes.length > 0;
  const filtered: FilteredStats = applyFilter(payload, filter);
  const gameScope = countryFiltered ? applyFilter(payload, withoutCountryFilter(filter)) : filtered;
  const slowThresholdSeconds = slowThreshold(payload.rounds);
  const ratedAbovePoints = countryFiltered
    ? roundRatingGapPoints(filtered)
    : gameRatingGapPoints(gameScope);
  const lost = lostRoundPoints(filtered.rounds, slowThresholdSeconds);
  return {
    countryFiltered,
    games: gameHeadline(gameScope.games),
    rounds: roundHeadline(filtered.rounds),
    rating: ratingSeries(gameScope.games),
    streaks: streaks(gameScope.games),
    ratedAbove: {
      unit: countryFiltered ? "rounds" : "games",
      points: ratedAbovePoints,
      bands: ratingGapBands(ratedAbovePoints),
    },
    damage: { slowThresholdSeconds, points: lost, classes: mistakeClassTotals(lost) },
  };
}
