// Player colours (#74): each Player picks one from PLAYER_PALETTE in Settings, and every surface that shows a Player
// draws the colour resolvePlayerColors gives it. The palette keeps clear of the map lens colours (the Outcome lens's
// green, red and yellow, and the "said aloud, not guessed" violet), and every entry reads as text on every theme
// (playerInk) and under a white initial on an avatar pin.

export const PLAYER_PALETTE = [
  { key: "blue", label: "Blue", hex: "#2b6cb0" },
  { key: "pink", label: "Pink", hex: "#c0267a" },
  { key: "brown", label: "Brown", hex: "#854d0e" },
  { key: "cyan", label: "Cyan", hex: "#0e7490" },
  { key: "teal", label: "Teal", hex: "#0f766e" },
] as const;

export type PlayerColorKey = (typeof PLAYER_PALETTE)[number]["key"];

/** Opponents are never coloured by Player: one neutral grey everywhere. */
export const OPPONENT_COLOR = "#5b6472";

/** The map lens colours a Player colour must stay clear of. */
export const LENS_COLORS = {
  answer: "#22c55e",
  wrongGuess: "#ef4444",
  inLearnings: "#facc15",
  saidAloud: "#8b5cf6",
} as const;

const HEX_BY_KEY = new Map<string, string>(PLAYER_PALETTE.map((c) => [c.key, c.hex]));

export function isPlayerColorKey(value: unknown): value is PlayerColorKey {
  return typeof value === "string" && HEX_BY_KEY.has(value);
}

export interface PlayerColorChoice {
  id: string;
  /** The stored choice (a palette key), or null when the Player hasn't picked one. */
  color: string | null;
}

/**
 * The colour to draw for each Player of a Duo, by Player id. Players with no (or an unknown) choice get the first
 * palette colour nobody has taken, in id order, so the Duo's two defaults differ. When two Players chose the same
 * colour, the viewer keeps theirs and the partner is drawn in the first colour nobody else uses (without a viewer
 * among them, the first by id keeps it), so the two can always be told apart.
 */
export function resolvePlayerColors(
  players: readonly PlayerColorChoice[],
  viewerPlayerId?: string | null,
): Record<string, string> {
  const ordered = [...players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chosen = new Map<string, PlayerColorKey | null>(
    ordered.map((p) => [p.id, isPlayerColorKey(p.color) ? p.color : null]),
  );
  const used = new Set<PlayerColorKey>();
  const resolved = new Map<string, PlayerColorKey>();
  const firstFree = (avoid: ReadonlySet<PlayerColorKey>) =>
    PLAYER_PALETTE.find((c) => !avoid.has(c.key))?.key ?? PLAYER_PALETTE[0].key;

  // Explicit choices first, so a default never takes a colour someone picked; the viewer claims a shared one first.
  const viewerFirst = [...ordered].sort((a, b) => Number(b.id === viewerPlayerId) - Number(a.id === viewerPlayerId));
  for (const p of viewerFirst) {
    const key = chosen.get(p.id);
    if (!key) continue;
    if (used.has(key)) continue; // a duplicate: resolved below
    resolved.set(p.id, key);
    used.add(key);
  }
  const reserved = new Set<PlayerColorKey>([...chosen.values()].filter((k): k is PlayerColorKey => k !== null));
  for (const p of ordered) {
    if (resolved.has(p.id)) continue;
    const key = firstFree(new Set([...used, ...reserved]));
    resolved.set(p.id, key);
    used.add(key);
  }
  const out: Record<string, string> = {};
  for (const p of players) out[p.id] = HEX_BY_KEY.get(resolved.get(p.id)!)!;
  return out;
}

/** The CSS colour for a Player's name as text: themes lighten it on dark backgrounds (--speaker-lighten). */
export function playerInk(hex: string): string {
  return `color-mix(in srgb, ${hex}, #ffffff var(--speaker-lighten))`;
}
