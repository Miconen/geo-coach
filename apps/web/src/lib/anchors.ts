// Stable id anchors (#73): every Round, Learning and run has one, and page sections use plain names. links.ts
// builds URLs with them; the Duo layout follows a URL's #anchor to its element (opening any closed <details>
// around it), scrolls it into view and highlights it.

export type AnchorKind = "round" | "learning" | "run";

export const anchor = {
  round: (roundId: string) => `round-${roundId}`,
  learning: (learningId: string) => `learning-${learningId}`,
  run: (runId: string) => `run-${runId}`,
};

/** Page section anchors, one name per section kind so links can target them across pages. */
export const SECTION = {
  rounds: "rounds",
  learnings: "learnings",
  sessions: "sessions",
  runs: "runs",
  speech: "speech",
  claims: "claims",
  location: "location",
} as const;

const ENTITY_ANCHOR = /^(round|learning|run)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * What a URL hash points at: an entity (`#round-<uuid>`) or a section name. Null for an empty or malformed hash,
 * which a page ignores.
 */
export function parseAnchor(
  hash: string,
): { kind: AnchorKind; id: string } | { kind: "section"; id: string } | null {
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const m = ENTITY_ANCHOR.exec(raw);
  if (m) return { kind: m[1]!.toLowerCase() as AnchorKind, id: m[2]!.toLowerCase() };
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? { kind: "section", id: raw } : null;
}

const HIGHLIGHT_MS = 2400;

/**
 * Scrolls to the hash's element and highlights it, opening any <details> it sits in. Returns false when the
 * element isn't on the page (yet): callers may retry once their data renders.
 */
export function followHash(hash: string, doc: Document = document): boolean {
  if (!parseAnchor(hash)) return false;
  const el = doc.getElementById(decodeURIComponent(hash.replace(/^#/, "")));
  if (!el) return false;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.scrollIntoView({ block: "center" });
  el.setAttribute("data-anchored", "");
  setTimeout(() => el.removeAttribute("data-anchored"), HIGHLIGHT_MS);
  return true;
}
