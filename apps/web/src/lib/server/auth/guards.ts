import { error, json, redirect, type RequestEvent } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getDb, type AppDb } from "../db/index.js";
import { duoMemberships } from "../db/schema.js";

type Player = NonNullable<App.Locals["player"]>;

/** The session store could not be read (DB down): every cookie route answers 503 instead of "signed out". */
export function assertAuthAvailable(locals: App.Locals): void {
  if (locals.authUnavailable) error(503, "Sign-in is unavailable right now. Try again in a moment.");
}

export async function isPlayerInDuo(db: AppDb, playerId: string, duoId: string): Promise<boolean> {
  const row = await db.query.duoMemberships.findFirst({
    where: and(eq(duoMemberships.duoId, duoId), eq(duoMemberships.playerId, playerId)),
    columns: { duoId: true },
  });
  return row !== undefined;
}

export interface DuoRouteContext {
  db: AppDb;
  player: Player;
  duoId: string;
}

export interface DuoRouteOptions {
  /** Streaming routes (/events) answer plain text, never a JSON error body. */
  stream?: boolean;
  /** Test seam; defaults to the app database. */
  db?: () => AppDb;
}

type DuoEvent = RequestEvent & { params: { duoId: string } };

/**
 * The guard every /api/duos/[duoId=uuid]/* handler runs first (#56 1a-security): auth available (503), then
 * signed in (401), then Duo membership, where a non-member gets 404 so a Duo's existence never leaks.
 * assertPlayerInDuo keeps its 403 for the Companion and MCP.
 */
export function duoRoute<E extends DuoEvent>(
  handler: (event: E, ctx: DuoRouteContext) => Response | Promise<Response>,
  options: DuoRouteOptions = {},
): (event: E) => Promise<Response> {
  const fail = (status: 401 | 404 | 503, message: string) =>
    options.stream
      ? new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
      : json({ error: message }, { status });
  return async (event) => {
    if (event.locals.authUnavailable) return fail(503, "Sign-in is unavailable right now.");
    const player = event.locals.player;
    if (!player) return fail(401, "Unauthorized");
    const db = (options.db ?? getDb)();
    const duoId = event.params.duoId;
    let member: boolean;
    try {
      member = await isPlayerInDuo(db, player.id, duoId);
    } catch (err) {
      if (options.stream) return fail(503, "Unavailable");
      throw err;
    }
    if (!member) return fail(404, "Not found");
    return handler(event, { db, player, duoId });
  };
}

/**
 * A same-origin relative path to return to after sign-in, or "/" for anything else (absolute or
 * protocol-relative URLs, backslash tricks, control characters, other origins).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "/";
  try {
    const base = "http://geo-coach.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

/** The /login URL that comes back to `url` after sign-in. */
export function loginUrlFor(url: URL): string {
  const next = `${url.pathname}${url.search}`;
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

/**
 * Top of every Duo page and child layout load (#56 1b-shell): loads run concurrently and `await parent()`
 * skips the layout on in-Duo navigation, so each load checks for itself. Signed out: back to /login with this
 * URL as next (the only read of `url`, so signed-in loads never depend on it). Not a member: 404.
 */
export async function assertDuoAccess(
  locals: App.Locals,
  duoId: string,
  url: URL,
  db: AppDb = getDb(),
): Promise<Player> {
  assertAuthAvailable(locals);
  const player = locals.player;
  if (!player) redirect(302, loginUrlFor(url));
  if (!(await isPlayerInDuo(db, player.id, duoId))) error(404, "Not found");
  return player;
}

/** The last Duo a Player opened (X1): / sends them back to it. */
export const LAST_DUO_COOKIE = "last_duo";
