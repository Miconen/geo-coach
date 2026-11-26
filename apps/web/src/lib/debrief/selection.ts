import { pushQuery, updateQuery, viewParams } from "$lib/url-state.js";
import { parseAnchor } from "$lib/anchors.js";
import { setParam } from "$lib/view-url.js";

// The debrief view's selection in the URL (#66, #73, ADR 0007): which Game, Round and country are in focus, and which
// drawer is open. Focusing pushes a history entry, so Back steps out; toggling a drawer replaces. Neither reruns the
// page's server load.

export const SELECTION_KEYS = ["game", "round", "country", "drawer"] as const;
export type DebriefSelection = Record<(typeof SELECTION_KEYS)[number], string | null>;

/** The selection on screen (reactive inside `$derived`). */
export function readSelection(): DebriefSelection {
  const q = viewParams();
  return { game: q.get("game"), round: q.get("round"), country: q.get("country"), drawer: q.get("drawer") };
}

/** Moves the selection: a new history entry, or `replace` for a drawer toggle. */
export function select(patch: Partial<DebriefSelection>, opts: { replace?: boolean } = {}) {
  const mutate = (params: URLSearchParams) => {
    for (const k of SELECTION_KEYS) if (k in patch) setParam(params, k, patch[k]);
  };
  if (opts.replace) updateQuery(mutate);
  // A Round anchor that focused a Round has done its job; the query carries the focus from here.
  else pushQuery(mutate, parseAnchor(location.hash)?.kind === "round" ? { hash: null } : {});
}

/** The Round a `#round-<id>` anchor names, if any. */
export function anchoredRoundId(hash: string): string | null {
  const a = parseAnchor(hash);
  return a?.kind === "round" ? a.id : null;
}
