/**
 * Every in-app URL is built here (#56 X1), typed against routes that have shipped. A builder for a route that
 * has not shipped yet does not exist, so EntityChip renders plain text for it (see `entityHref`).
 */

type Query = Record<string, string | number | null | undefined | readonly string[]>;

function withQuery(path: string, query: Query = {}, hash?: string | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

export const links = {
  /** The Duo's entry point (redirects to Review until Home ships). */
  duo: (duoId: string) => `/duos/${duoId}`,
  /** Review. ?learning= pins a Learning even if filters hide it; ?run= opens a run in its Session. */
  review: (duoId: string, q: { learning?: string | null; run?: string | null; country?: string | null } = {}) =>
    withQuery(`/duos/${duoId}/review`, { learning: q.learning, run: q.run, country: q.country }, q.run ? `run-${q.run}` : null),
  /** Statistics; `params` are the Stats filter params (see packages/shared stats filter). */
  stats: (duoId: string, params: URLSearchParams | Query = {}) =>
    params instanceof URLSearchParams
      ? withQuery(`/duos/${duoId}/stats`, Object.fromEntries(groupParams(params)))
      : withQuery(`/duos/${duoId}/stats`, params),
  /** Global Settings (not Duo-scoped). */
  settings: () => "/settings",
  /** Sign-in that returns to `next`. */
  login: (next?: string | null) => withQuery("/login", { next: next && next !== "/" ? next : null }),
};

function groupParams(params: URLSearchParams): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, v] of params) out.set(k, [...(out.get(k) ?? []), v]);
  return out;
}

/** Entity kinds a chip can stand for (one shape, icon and colour each; see entity-tokens.ts). */
export type EntityKind = "game" | "round" | "session" | "learning" | "claim" | "source" | "run" | "country";

export interface EntityRef {
  kind: EntityKind;
  duoId: string;
  id: string;
  /** Round number, for Round chips (X7: non-positive numbers never link). */
  roundNumber?: number;
  /** The run's Session, for run chips. */
  sessionId?: string;
}

/**
 * Where an entity chip links, or null while its page has not shipped (the chip then renders plain text).
 * Learning chips pin the Learning on Review; run chips open the run in Review until the Session page ships.
 */
export function entityHref(ref: EntityRef): string | null {
  switch (ref.kind) {
    case "learning":
      return links.review(ref.duoId, { learning: ref.id });
    case "run":
      return links.review(ref.duoId, { run: ref.id });
    case "country":
      return links.stats(ref.duoId, { country: ref.id });
    default:
      return null;
  }
}
