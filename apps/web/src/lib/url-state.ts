import { pushState, replaceState } from "$app/navigation";
import { page } from "$app/state";
import { nextViewHref } from "./view-url.js";

// View state in the URL (ADR 0007, #73). These two helpers are the only way pages write view params: filters,
// tabs and drawers replace the history entry; focusing on something (a country, a Region, a Round) pushes one,
// so Back undoes it. Both store the new query in page.state too: shallow routing leaves page.url at the loaded
// URL, so readers go through `viewParams()`, which prefers page.state and falls back to the URL on a cold load.

/**
 * Rewrites the address bar's query in place (#56 2b). It reads the live address, not page.url: a shallow
 * replaceState leaves page.url as it was, so two controls rebuilding from it dropped each other's params.
 */
export function updateQuery(mutate: (params: URLSearchParams) => void): void {
  const href = nextViewHref(location, mutate);
  replaceState(href, { ...page.state, query: new URL(href, location.origin).search });
}

/**
 * Like `updateQuery`, but adds a history entry, for focus changes. `hash` replaces the anchor (null drops it);
 * left out, the current anchor stays.
 */
export function pushQuery(mutate: (params: URLSearchParams) => void, opts: { hash?: string | null } = {}): void {
  const href = nextViewHref(location, mutate, opts.hash);
  // A focus change that changes nothing adds no entry (a repeated click, a restore from Back).
  if (href === `${location.pathname}${location.search}${location.hash}`) return;
  // Stamp the entry we're leaving with its own query first: a cold-loaded entry has no page.state.query, so Back
  // to it after a reload would read page.url, which a reload of a later entry has moved on.
  if (page.state.query === undefined) {
    replaceState(`${location.pathname}${location.search}${location.hash}`, { ...page.state, query: location.search });
  }
  pushState(href, { ...page.state, query: new URL(href, location.origin).search });
}

/**
 * The view params of the current history entry: page.state's after a shallow push or replace (or a Back to one),
 * else the loaded URL's. Reactive when read inside `$derived` or an effect.
 */
export function viewParams(): URLSearchParams {
  return new URLSearchParams(page.state.query ?? page.url.search);
}
