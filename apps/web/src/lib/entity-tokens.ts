import type { EntityKind } from "./links.js";

/**
 * The token table (#56 1b-shell): one chip shape, icon and colour per entity. Status badges (stale, draft,
 * superseded) use their own pill style and never these tokens, so a link never looks like a status.
 * Add a row when a new entity chip ships; never change an existing one.
 */
export const ENTITY_TOKENS: Record<EntityKind, { icon: string; color: string; label: string }> = {
  game: { icon: "◆", color: "var(--accent)", label: "Game" },
  round: { icon: "●", color: "var(--info)", label: "Round" },
  session: { icon: "▲", color: "var(--ok)", label: "Session" },
  learning: { icon: "✎", color: "var(--warn)", label: "Learning" },
  claim: { icon: "❖", color: "var(--accent-soft-ink)", label: "Claim" },
  source: { icon: "§", color: "var(--muted)", label: "Source" },
  run: { icon: "↻", color: "var(--muted)", label: "Run" },
  country: { icon: "⚑", color: "var(--ink)", label: "Country" },
};
