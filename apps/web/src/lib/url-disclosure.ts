import { updateQuery, viewParams } from "./url-state.js";
import { setListParam } from "./view-url.js";

/** ?open=runs&open=learnings: the page's open drawers (<details> disclosures), by key (#73). */
export const OPEN_PARAM = "open";

/**
 * Keeps a <details> drawer's open state in the URL: it opens on mount when the URL lists it, and toggling it
 * replaces the history entry, like a filter. It never closes a drawer itself, so a click made before hydration
 * (the browser opens the drawer natively) is kept, and written to the URL.
 */
export function urlDisclosure(node: HTMLDetailsElement, key: string) {
  const inUrl = () => new URLSearchParams(location.search).getAll(OPEN_PARAM).includes(key);
  let destroyed = false;
  const sync = () => {
    if (destroyed || node.open === inUrl()) return;
    updateQuery((params) => {
      const keys = params.getAll(OPEN_PARAM).filter((k) => k !== key);
      setListParam(params, OPEN_PARAM, node.open ? [...keys, key] : keys);
    });
  };
  // A task later: a toggle during hydration fires before the router may write the URL.
  const onToggle = () => setTimeout(sync, 0);
  node.addEventListener("toggle", onToggle);
  if (viewParams().getAll(OPEN_PARAM).includes(key)) node.open = true;
  else if (node.open) onToggle();
  return {
    destroy: () => {
      destroyed = true;
      node.removeEventListener("toggle", onToggle);
    },
  };
}
