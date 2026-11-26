import { pushState, replaceState } from "$app/navigation";

// The debrief view's selection in the URL (#66, ADR 0007): which Game, Round and country are in focus, and which
// drawer is open. Focusing pushes a history entry, so Back steps out; toggling a drawer replaces. page.state holds
// it for shallow Back and Forward, the query string for a cold load, a reload or a shared link.

export const SELECTION_KEYS = ["game", "round", "country", "drawer"] as const;
export type DebriefSelection = Record<(typeof SELECTION_KEYS)[number], string | null>;

export const EMPTY_SELECTION: DebriefSelection = { game: null, round: null, country: null, drawer: null };

/** The anchor of a Round in the debrief: `#round-<id>` focuses it. */
export const roundAnchor = (roundId: string) => `round-${roundId}`;

/** The selection on screen: page.state first (shallow history), else the URL. */
export function readSelection(page: { url: URL; state: App.PageState }): DebriefSelection {
  const fromState = page.state.debrief;
  if (fromState) return { ...EMPTY_SELECTION, ...fromState };
  const q = page.url.searchParams;
  return { game: q.get("game"), round: q.get("round"), country: q.get("country"), drawer: q.get("drawer") };
}

/**
 * Moves the selection: a new history entry, or `replace` for a drawer toggle. Builds the URL from the live address,
 * not page.url (ADR 0007: a shallow replaceState leaves page.url behind). Never reruns the page's server load.
 */
export function select(current: DebriefSelection, patch: Partial<DebriefSelection>, opts: { replace?: boolean } = {}) {
  const sel: DebriefSelection = { ...current, ...patch };
  const url = new URL(location.href);
  for (const k of SELECTION_KEYS) {
    const v = sel[k];
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  // An anchor that focused a Round has done its job; the query string carries the focus from here.
  if (url.hash.startsWith("#round-")) url.hash = "";
  (opts.replace ? replaceState : pushState)(url, { debrief: sel });
}
