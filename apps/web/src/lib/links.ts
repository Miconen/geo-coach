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
  /** The Duo's Home (#56 3a). */
  duo: (duoId: string) => `/duos/${duoId}`,
  /** Review. ?learning= pins a Learning even if filters hide it; ?run= opens a run in its Session; ?claim= a Claim drawer. */
  review: (
    duoId: string,
    q: { learning?: string | null; run?: string | null; country?: string | null; claim?: string | null } = {},
  ) =>
    withQuery(
      `/duos/${duoId}/review`,
      { learning: q.learning, run: q.run, country: q.country, claim: q.claim },
      q.run ? `run-${q.run}` : null,
    ),
  /** A Claim's drawer; its canonical route is Review's ?claim= (#56 X1). */
  claim: (duoId: string, claimId: string) => withQuery(`/duos/${duoId}/review`, { claim: claimId }),
  /** Knowledge: Claims and Sources. ?country= filters; ?claim= opens a Claim drawer in place. */
  knowledge: (duoId: string, q: { country?: string | null; claim?: string | null } = {}) =>
    withQuery(`/duos/${duoId}/knowledge`, { country: q.country, claim: q.claim }),
  /** A Source; ?v= pins a version (else the current one), ?section= one excerpt (#anchor). */
  source: (duoId: string, sourceId: string, q: { v?: number | null; section?: string | null } = {}) =>
    withQuery(`/duos/${duoId}/knowledge/sources/${sourceId}`, { v: q.v, section: q.section }, q.section),
  /** A Source image. ?r=2 is revalidated on every view through the member check (no-cache), unlike the old URL. */
  sourceImage: (imageId: string) => `/api/sources/images/${imageId}?r=2`,
  /** Statistics; `params` are the Stats filter params (see packages/shared stats filter). */
  stats: (duoId: string, params: URLSearchParams | Query = {}) =>
    params instanceof URLSearchParams
      ? withQuery(`/duos/${duoId}/stats`, Object.fromEntries(groupParams(params)))
      : withQuery(`/duos/${duoId}/stats`, params),
  /** Games index. */
  games: (duoId: string) => `/duos/${duoId}/games`,
  /** A Game. */
  game: (duoId: string, gameId: string) => `/duos/${duoId}/games/${gameId}`,
  /** A Round by its stored number; null for X7's non-positive numbers (they never link). */
  round: (duoId: string, gameId: string, roundNumber: number, q: { location?: boolean } = {}) =>
    roundNumber > 0
      ? withQuery(`/duos/${duoId}/games/${gameId}/rounds/${roundNumber}`, { location: q.location ? "1" : null }, q.location ? "location" : null)
      : null,
  /** Sessions index. */
  sessions: (duoId: string) => `/duos/${duoId}/sessions`,
  /** A Session; ?run= pins a run (#run-<id>). */
  session: (duoId: string, sessionId: string, q: { run?: string | null } = {}) =>
    withQuery(`/duos/${duoId}/sessions/${sessionId}`, { run: q.run }, q.run ? `run-${q.run}` : null),
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
  /** The Round's Game, for Round chips. */
  gameId?: string;
  /** The run's Session, for run chips. */
  sessionId?: string;
}

/**
 * Where an entity chip links, or null while its page has not shipped (the chip then renders plain text) or the
 * target never links (X7 Round numbers). Learning chips pin the Learning on Review; run chips open their Session.
 */
export function entityHref(ref: EntityRef): string | null {
  switch (ref.kind) {
    case "learning":
      return links.review(ref.duoId, { learning: ref.id });
    case "run":
      return ref.sessionId ? links.session(ref.duoId, ref.sessionId, { run: ref.id }) : links.review(ref.duoId, { run: ref.id });
    case "game":
      return links.game(ref.duoId, ref.id);
    case "round":
      return ref.gameId && ref.roundNumber !== undefined ? links.round(ref.duoId, ref.gameId, ref.roundNumber) : null;
    case "session":
      return links.session(ref.duoId, ref.id);
    case "country":
      return links.stats(ref.duoId, { country: ref.id });
    case "claim":
      return links.claim(ref.duoId, ref.id);
    case "source":
      return links.source(ref.duoId, ref.id);
    default:
      return null;
  }
}
