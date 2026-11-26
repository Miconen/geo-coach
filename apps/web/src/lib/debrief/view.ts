// Pure derivations for the debrief view (#79): wording, the map's Rounds, the countries missed, a country's view,
// the Round stepper and callout placement. The Svelte components only render these.
import { getCountryName } from "@geo-coach/shared";
import type { MapGuess, MapRound } from "$lib/map/scene.js";
import type { WorkbenchLearning } from "$lib/server/workbench/view-model.js";
import type { Debrief, DebriefGame, DebriefGuess, DebriefRound } from "./types.js";

/** "+1,571", "−12", "0"; "–" when unknown. */
export const signed = (n: number | null) =>
  n === null ? "–" : n > 0 ? `+${n.toLocaleString("en-US")}` : n < 0 ? `−${(-n).toLocaleString("en-US")}` : "0";

/** A country's flag emoji, or a white flag without one. */
export const flag = (code: string | null) =>
  code && /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : "🏳";

/** "Game 4 · Round 2". */
export const roundName = (r: Pick<DebriefRound, "gameNumber" | "roundNumber">) => `Game ${r.gameNumber} · Round ${r.roundNumber}`;

/** "1:05": seconds from a Round's start. */
export const clock = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, "0")}`;

/** How close the best guess came: ok under 100 km, warn under 750 km, else danger. */
export const kmTone = (km: number | null): "ok" | "warn" | "danger" | "none" =>
  km === null ? "none" : km < 100 ? "ok" : km < 750 ? "warn" : "danger";

export const resultLetter = (won: boolean | null) => (won ? "W" : won === false ? "L" : "–");

/** A Player colour as text on the map's dark callouts. */
export const onDark = (hex: string) => `color-mix(in srgb, ${hex}, #ffffff 45%)`;

export const countryName = (code: string) => {
  const name = getCountryName(code);
  return name && name !== code ? name : code;
};

export function record(d: Debrief) {
  return {
    won: d.games.filter((g) => g.won === true).length,
    lost: d.games.filter((g) => g.won === false).length,
    ratingDelta: d.games.reduce((n, g) => n + (g.ratingDelta ?? 0), 0),
    rounds: d.rounds.length,
    learnings: Object.keys(d.learnings).length,
  };
}

export const roundsOf = (d: Debrief, game: DebriefGame) => d.rounds.filter((r) => r.gameId === game.id);
export const learningsOf = (d: Debrief, ids: readonly string[]) => ids.flatMap((id) => (d.learnings[id] ? [d.learnings[id]!] : []));

/** The map's Rounds: one answer pin each, every placed guess in its Player's colour, and the countries its Learnings name. */
export function mapRounds(d: Debrief, rounds: readonly DebriefRound[]): MapRound[] {
  return rounds.flatMap((r) => {
    if (r.lat === null || r.lng === null) return [];
    const guesses: MapGuess[] = r.guesses.flatMap((g) => {
      if (g.lat === null || g.lng === null) return [];
      const p = g.playerId ? d.players[g.playerId] : undefined;
      return [
        {
          lat: g.lat,
          lng: g.lng,
          countryCode: g.countryCode,
          isDuo: g.isDuo,
          playerId: g.playerId,
          color: p?.color,
          initial: p?.initial,
          score: g.score,
          distanceMeters: g.distanceMeters,
        },
      ];
    });
    const learningCountries = [...new Set(learningsOf(d, r.learningIds).flatMap((l) => l.countries.map((c) => c.toUpperCase())))];
    return [
      {
        id: r.id,
        gameId: r.gameId,
        label: `R${r.roundNumber}`,
        title: roundName(r),
        detail: `${r.countryName ?? "?"} · ${r.won ? "won" : "lost"} · ${signed(r.hpDelta)}`,
        lat: r.lat,
        lng: r.lng,
        countryCode: r.countryCode,
        won: r.won,
        guesses,
        learningCountries,
      },
    ];
  });
}

export interface MissedCountry {
  code: string;
  name: string;
  rounds: DebriefRound[];
}

/** The answer countries the Duo missed (neither Duo guess there), most missed first. */
export function missedCountries(rounds: readonly DebriefRound[]): MissedCountry[] {
  const by = new Map<string, MissedCountry>();
  for (const r of rounds) {
    if (!r.missedAnswer || !r.countryCode) continue;
    const m = by.get(r.countryCode) ?? { code: r.countryCode, name: r.countryName ?? countryName(r.countryCode), rounds: [] };
    m.rounds.push(r);
    by.set(r.countryCode, m);
  }
  return [...by.values()].sort((a, b) => b.rounds.length - a.rounds.length || a.name.localeCompare(b.name));
}

export interface CountryView {
  code: string;
  name: string;
  /** Every Round the country was the answer to or caught a Duo guess, in play order. */
  rounds: DebriefRound[];
  /** The answer was this country. */
  asAnswer: DebriefRound[];
  /** A Duo guess landed here, but the answer was elsewhere. */
  asGuess: DebriefRound[];
  /** Current Learnings that name the country. */
  learnings: WorkbenchLearning[];
  missed: number;
}

export function countryView(d: Debrief, code: string): CountryView | null {
  const c = code.toUpperCase();
  const rounds = d.rounds.filter((r) => r.countryCode === c || r.guesses.some((g) => g.isDuo && g.countryCode === c));
  const learnings = Object.values(d.learnings).filter((l) => l.countries.some((x) => x.toUpperCase() === c));
  if (rounds.length === 0 && learnings.length === 0) return null;
  const asAnswer = rounds.filter((r) => r.countryCode === c);
  return {
    code: c,
    name: rounds.find((r) => r.countryCode === c)?.countryName ?? countryName(c),
    rounds,
    asAnswer,
    asGuess: rounds.filter((r) => r.countryCode !== c),
    learnings,
    missed: asAnswer.filter((r) => r.missedAnswer).length,
  };
}

/** Inside a Round, a clicked country other than the answer: who guessed there and the Learnings naming it. */
export function countryPopup(d: Debrief, round: DebriefRound, code: string) {
  const c = code.toUpperCase();
  return {
    code: c,
    name: countryName(c),
    guessedBy: round.guesses.filter((g) => g.countryCode === c),
    named: [...learningsOf(d, round.learningIds), ...learningsOf(d, d.sessionLearningIds)].filter((l) =>
      l.countries.some((x) => x.toUpperCase() === c),
    ),
    hasRounds: d.rounds.some((r) => r.countryCode === c || r.guesses.some((g) => g.isDuo && g.countryCode === c)),
  };
}

/** The ‹ n / N › stepper: the next Round in `seq` from `currentId` (wrapping), or the first/last from nothing. */
export function stepRound(seq: readonly { id: string }[], currentId: string | null, delta: 1 | -1): string | null {
  if (seq.length === 0) return null;
  const at = currentId === null ? -1 : seq.findIndex((r) => r.id === currentId);
  if (at === -1) return seq[delta > 0 ? 0 : seq.length - 1]!.id;
  return seq[(at + delta + seq.length) % seq.length]!.id;
}

export const playerName = (d: Debrief, g: Pick<DebriefGuess, "isDuo" | "playerId">) =>
  g.isDuo ? (d.players[g.playerId ?? ""]?.name ?? "Player") : "Opponent";

/**
 * Callouts beside guess pins, nudged down on screen so neighbours never overlap: pins sorted top to bottom, and a
 * callout less than `gap` below one that's horizontally close moves down to clear it.
 */
export function placeCallouts<T>(
  items: ReadonlyArray<{ item: T; x: number; y: number }>,
  gap: number,
  width = 230,
): Array<{ item: T; pin: { x: number; y: number }; y: number }> {
  const out = [...items].sort((a, b) => a.y - b.y).map((p) => ({ item: p.item, pin: { x: p.x, y: p.y }, y: p.y }));
  for (let i = 1; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const prev = out[j]!;
      const cur = out[i]!;
      if (Math.abs(cur.pin.x - prev.pin.x) < width && cur.y - prev.y < gap) cur.y = prev.y + gap;
    }
  }
  return out;
}
