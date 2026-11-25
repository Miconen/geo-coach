import type {
  BestGuess,
  FirstGuesserStats,
  GameMode,
  PlayerSummary,
  RollingPoint,
} from "@geo-coach/shared";
import { formatNumber, formatPercent, formatSigned, unitLabel } from "./overview-text.js";
import { OPPONENT_COLOR, playerInk } from "../player-color.js";

// Wording for the Players section: the computed takeaways and the Best-guess chips.

export const MODE_LABELS: Record<GameMode, string> = { moving: "Moving", nm: "NM", nmpz: "NMPZ" };

/** A Player's colour (#74) for lines, dots and names, as it reads on the page's theme. */
export const playerColor = (players: readonly { id: string; avatarColor: string }[], playerId: string) =>
  playerInk(players.find((p) => p.id === playerId)?.avatarColor ?? OPPONENT_COLOR);

/** A Player's name by id; "?" for an id the payload doesn't name. */
export type NameOf = (playerId: string) => string;

/** "🇰🇪" for "KE"; empty for anything that isn't two letters. */
export function flagEmoji(countryCode: string | null): string {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return "";
  return [...countryCode.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

/** "a", "a and b", "a, b and c". */
function list(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function carryTakeaway(summaries: readonly PlayerSummary[], nameOf: NameOf): string {
  const rounds = summaries[0]?.rounds ?? 0;
  if (rounds === 0) return "No Rounds in this filter.";
  const parts = summaries.map(
    (s, i) => `${nameOf(s.playerId)}${i === 0 ? " had the best guess in" : ""} ${formatPercent(s.bestShare)}`,
  );
  return `${list(parts)} of ${unitLabel("rounds", rounds)}.`;
}

export function firstTakeaway(stats: FirstGuesserStats, nameOf: NameOf): string {
  if (stats.rounds === 0) return "No Rounds in this filter.";
  const firsts = stats.players.map(
    (p, i) => `${nameOf(p.playerId)}${i === 0 ? " pressed guess first in" : ""} ${formatPercent(p.share)}`,
  );
  const both = stats.bothTimedOut > 0 ? `; both timed out in ${formatPercent(stats.bothTimedOutShare)}` : "";
  const lead = `${list(firsts)} of Rounds${both}.`;
  const when = stats.players
    .filter((p) => p.bestShareWhenFirst !== null)
    .map(
      (p) =>
        `${nameOf(p.playerId)} ${formatPercent(p.bestShareWhenFirst)}` +
        (p.bestShareWhenOtherFirst !== null ? ` (${formatPercent(p.bestShareWhenOtherFirst)} otherwise)` : ""),
    );
  return when.length ? `${lead} Best guess when first: ${list(when)}.` : lead;
}

export function waitingTakeaway(summaries: readonly PlayerSummary[], nameOf: NameOf): string {
  const compared = summaries.filter(
    (s) => s.waiting.pressed.avgScore !== null && s.waiting.timedOut.avgScore !== null,
  );
  if (compared.length === 0) return "No Player has both pressed and timed-out guesses in this filter.";
  const parts = compared.map((s, i) => {
    const diff = Math.round(s.waiting.timedOut.avgScore! - s.waiting.pressed.avgScore!);
    const amount = diff === 0 ? "the same" : `${formatNumber(Math.abs(diff))} points ${diff < 0 ? "less" : "more"}`;
    return `${amount}${i === 0 ? " than pressed ones" : ""} for ${nameOf(s.playerId)}`;
  });
  return `Timed-out guesses average ${list(parts)}, on Rounds that aren't Splits.`;
}

export function trendTakeaway(
  series: readonly { playerId: string; points: readonly RollingPoint[] }[],
  rounds: number,
  window: number,
  nameOf: NameOf,
): string {
  if (rounds < window) {
    return `Trends need at least ${unitLabel("rounds", window)}; this filter has ${formatNumber(rounds)}.`;
  }
  const parts = series.flatMap(({ playerId, points }) => {
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) return [];
    return [
      `${nameOf(playerId)} ${formatPercent(first.bestShare)} → ${formatPercent(last.bestShare)} best, ` +
        `${formatNumber(first.medianKm)} → ${formatNumber(last.medianKm)} km`,
    ];
  });
  return `Over ${formatNumber(window)}-Round windows, first to latest: ${list(parts)}.`;
}

/** The reasons a Best guess stands out, as chip labels. */
export function bestGuessReasons(b: BestGuess): string[] {
  const reasons = [`${formatSigned(b.lead)} over next`];
  if (b.othersInOtherCountry > 0) {
    reasons.push(
      `${b.othersInOtherCountry} ${b.othersInOtherCountry === 1 ? "other" : "others"} in another country`,
    );
  }
  if (b.secondsSooner >= 1) reasons.push(`${Math.round(b.secondsSooner)} s sooner`);
  if (b.mode === "nmpz" || b.mode === "nm") reasons.push(MODE_LABELS[b.mode]);
  return reasons;
}
