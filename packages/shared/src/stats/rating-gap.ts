import type { FilteredStats } from "./filter.js";
import { groupBy, mean } from "./math.js";
import { scoreGap } from "./rounds.js";

/** Width of a rating-gap band, in rating points. */
export const RATING_GAP_BAND_WIDTH = 50;

/** Bands with fewer Games (or Rounds) than this are hidden: a handful is not a win rate. */
export const MIN_RATING_GAP_BAND_COUNT = 5;

/**
 * One Game (or one Round standing in for a Game) on the "do we beat teams rated
 * above us?" chart.
 */
export interface RatingGapPoint {
  /** The Game's id, or the Round's for a Round point. */
  id: string;
  gameId: string;
  startedAtMs: number;
  /** The Opponents' rating minus the Duo's, before the Game. */
  ratingGap: number;
  won: boolean;
  /** Damage dealt minus Damage taken, overkill counted. */
  netDamage: number;
  /** The Duo's best score minus the Opponents', averaged per Round. */
  scoreGapPerRound: number;
}

/**
 * One point per Game with both ratings and a result. Net Damage and the score
 * gap come from the Game's Rounds in `stats`, so pass Rounds unnarrowed by country.
 */
export function gameRatingGapPoints(stats: FilteredStats): RatingGapPoint[] {
  const roundsByGame = groupBy(stats.rounds, (r) => r.gameId);
  return stats.games.flatMap((g) => {
    if (g.opponentRatingBefore === null || g.ratingBefore === null || g.won === null) return [];
    const rounds = roundsByGame.get(g.id) ?? [];
    return [
      {
        id: g.id,
        gameId: g.id,
        startedAtMs: g.startedAtMs,
        ratingGap: g.opponentRatingBefore - g.ratingBefore,
        won: g.won,
        netDamage: rounds.reduce((sum, r) => sum + r.hpDelta, 0),
        scoreGapPerRound: mean(rounds.map(scoreGap)) ?? 0,
      },
    ];
  });
}

/**
 * One point per Round, standing in for Games when a country filter is on (a Game
 * can't be split by country). A Round is won when the Duo dealt Damage; Rounds
 * where neither side did are left out.
 */
export function roundRatingGapPoints(stats: FilteredStats): RatingGapPoint[] {
  const gameById = new Map(stats.games.map((g) => [g.id, g]));
  return stats.rounds.flatMap((r) => {
    const g = gameById.get(r.gameId);
    if (!g || g.opponentRatingBefore === null || g.ratingBefore === null || r.hpDelta === 0) {
      return [];
    }
    return [
      {
        id: r.id,
        gameId: g.id,
        startedAtMs: r.startedAtMs,
        ratingGap: g.opponentRatingBefore - g.ratingBefore,
        won: r.hpDelta > 0,
        netDamage: r.hpDelta,
        scoreGapPerRound: scoreGap(r),
      },
    ];
  });
}

export interface RatingGapBand {
  /** The band's centre, a multiple of the band width. */
  band: number;
  /** The band covers rating gaps from `from` (inclusive) to `to` (exclusive). */
  from: number;
  to: number;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgNetDamage: number;
  avgNetDamageWins: number | null;
  avgNetDamageLosses: number | null;
  avgScoreGapPerRound: number;
}

/** The band centre a rating gap falls in (bands are centred on multiples of the width). */
export function ratingGapBandOf(ratingGap: number): number {
  // `+ 0` turns -0 into 0.
  return Math.round(ratingGap / RATING_GAP_BAND_WIDTH) * RATING_GAP_BAND_WIDTH + 0;
}

/** Win rate and Damage per rating-gap band, smallest gap first; small bands are hidden. */
export function ratingGapBands(points: readonly RatingGapPoint[]): RatingGapBand[] {
  const half = RATING_GAP_BAND_WIDTH / 2;
  return [...groupBy(points, (p) => ratingGapBandOf(p.ratingGap))]
    .filter(([, inBand]) => inBand.length >= MIN_RATING_GAP_BAND_COUNT)
    .map(([band, inBand]) => {
      const wins = inBand.filter((p) => p.won);
      const losses = inBand.filter((p) => !p.won);
      return {
        band,
        from: band - half,
        to: band + half,
        count: inBand.length,
        wins: wins.length,
        losses: losses.length,
        winRate: wins.length / inBand.length,
        avgNetDamage: mean(inBand.map((p) => p.netDamage))!,
        avgNetDamageWins: mean(wins.map((p) => p.netDamage)),
        avgNetDamageLosses: mean(losses.map((p) => p.netDamage)),
        avgScoreGapPerRound: mean(inBand.map((p) => p.scoreGapPerRound))!,
      };
    })
    .sort((a, b) => a.band - b.band);
}
