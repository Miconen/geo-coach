/**
 * Every in-app URL is built here (#56 X1), typed against routes that have shipped. A builder for a route that
 * has not shipped yet does not exist, so EntityChip renders plain text for it (see `entityHref`).
 */

import { anchor } from "./anchors.js";
import { RANK_PARAM, writeMapView, type MapUrlView } from "./stats/map/view-state.js";

type Query = Record<string, string | number | null | undefined | readonly string[]>;

function toParams(query: Query | URLSearchParams): URLSearchParams {
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.set(key, String(value));
  }
  return params;
}

function withQuery(path: string, query: Query | URLSearchParams = {}, hash?: string | null): string {
  const qs = toParams(query).toString();
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
      q.run ? anchor.run(q.run) : null,
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
  /**
   * Statistics; `params` are the Stats filter params (see packages/shared stats filter). `view.map` focuses the
   * Map view (a country, its Regions, an open Round, its Game shown whole) and `view.rank` a Rankings row (#73);
   * `view.section` scrolls to a section.
   */
  stats: (
    duoId: string,
    params: URLSearchParams | Query = {},
    view: { map?: Partial<MapUrlView>; rank?: string | null; section?: string | null } = {},
  ) => {
    const qs = toParams(params);
    if (view.map) writeMapView(qs, view.map);
    if (view.rank) qs.set(RANK_PARAM, view.rank);
    return withQuery(`/duos/${duoId}/stats`, qs, view.section);
  },
  /** Games index. */
  games: (duoId: string) => `/duos/${duoId}/games`,
  /** A Game; `round` or `learning` scrolls to and highlights that item (#73), `section` a page section. */
  game: (duoId: string, gameId: string, q: { round?: string | null; learning?: string | null; section?: string | null } = {}) =>
    withQuery(`/duos/${duoId}/games/${gameId}`, {}, q.round ? anchor.round(q.round) : q.learning ? anchor.learning(q.learning) : q.section),
  /**
   * A Round by its stored number; null for X7's non-positive numbers (they never link). `location` shows the exact
   * location (#location); `learning` scrolls to one of its Learnings (#73), `section` a page section.
   */
  round: (
    duoId: string,
    gameId: string,
    roundNumber: number,
    q: { location?: boolean; learning?: string | null; section?: string | null } = {},
  ) =>
    roundNumber > 0
      ? withQuery(
          `/duos/${duoId}/games/${gameId}/rounds/${roundNumber}`,
          { location: q.location ? "1" : null },
          q.learning ? anchor.learning(q.learning) : q.location ? "location" : q.section,
        )
      : null,
  /** Sessions index. */
  sessions: (duoId: string) => `/duos/${duoId}/sessions`,
  /**
   * A Session; ?run= pins a run (#run-<id>). `round` or `learning` anchors one item (#73); on the map-first Session
   * page a Round anchor focuses that Round instead of scrolling to it.
   */
  session: (duoId: string, sessionId: string, q: { run?: string | null; round?: string | null; learning?: string | null } = {}) =>
    withQuery(
      `/duos/${duoId}/sessions/${sessionId}`,
      { run: q.run },
      q.run ? anchor.run(q.run) : q.round ? anchor.round(q.round) : q.learning ? anchor.learning(q.learning) : null,
    ),
  /** Global Settings (not Duo-scoped). */
  settings: () => "/settings",
  /** Sign-in that returns to `next`. */
  login: (next?: string | null) => withQuery("/login", { next: next && next !== "/" ? next : null }),
};

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
