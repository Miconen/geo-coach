import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHttpError, type RequestEvent } from "@sveltejs/kit";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duoMemberships, duos, players } from "../../db/schema.js";
import { assertAuthAvailable, duoRoute, loginUrlFor, safeNext } from "../guards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.resolve(__dirname, "../../../../routes");

type Locals = App.Locals;
const player = (id: string): NonNullable<Locals["player"]> => ({
  id,
  discordId: "d",
  displayName: "P",
  geoguessrUserId: null,
  geoguessrName: null,
  avatarColor: "#000",
});

function event(locals: Partial<Locals>, duoId: string) {
  return {
    locals: { player: null, sessionId: null, authUnavailable: false, ...locals },
    params: { duoId },
  } as unknown as RequestEvent & { params: { duoId: string } };
}

describe("safeNext (open redirect)", () => {
  it.each([
    ["/duos/abc/review?learning=1#x", "/duos/abc/review?learning=1#x"],
    ["/stats?country=ES", "/stats?country=ES"],
    ["https://evil.example/", "/"],
    ["//evil.example/path", "/"],
    ["/\\evil.example", "/"],
    ["\\\\evil.example", "/"],
    ["/a\\b", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\r\nSet-Cookie: x=1", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
    ["", "/"],
    [null, "/"],
    [undefined, "/"],
  ])("%s -> %s", (raw, expected) => {
    expect(safeNext(raw as string | null | undefined)).toBe(expected);
  });

  it("builds a login URL that comes back to the deep link", () => {
    expect(loginUrlFor(new URL("http://x/stats?duo=1&country=ES"))).toBe(
      "/login?next=%2Fstats%3Fduo%3D1%26country%3DES",
    );
    expect(loginUrlFor(new URL("http://x/"))).toBe("/login");
  });
});

describe("duoRoute wrapper", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let memberId: string;
  let outsiderId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    memberId = uuidv7();
    outsiderId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "D", geoguessrTeamId: "t" });
    await handle.db.insert(players).values([
      { id: memberId, discordId: "m", displayName: "M" },
      { id: outsiderId, discordId: "o", displayName: "O" },
    ]);
    await handle.db.insert(duoMemberships).values({ duoId, playerId: memberId });
  });

  afterEach(async () => {
    await handle.close();
  });

  const handler = vi.fn(async (_event: unknown, _ctx: unknown) => new Response("ok"));
  const route = (stream = false) => duoRoute(handler, { db: () => handle.db, stream });

  it("checks auth availability, then sign-in, then membership, before the handler", async () => {
    handler.mockClear();
    let res = await route()(event({ authUnavailable: true, player: player(memberId) }, duoId));
    expect(res.status).toBe(503);
    res = await route()(event({ authUnavailable: true }, duoId));
    expect(res.status).toBe(503);
    res = await route()(event({}, duoId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    res = await route()(event({ player: player(outsiderId) }, duoId));
    expect(res.status).toBe(404);
    res = await route()(event({ player: player(memberId) }, uuidv7()));
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    res = await route()(event({ player: player(memberId) }, duoId));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![1]).toMatchObject({ duoId, player: { id: memberId } });
  });

  it("answers streaming routes in plain text", async () => {
    for (const [locals, status] of [
      [{ authUnavailable: true }, 503],
      [{}, 401],
      [{ player: player(outsiderId) }, 404],
    ] as const) {
      const res = await route(true)(event(locals, duoId));
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    }
  });
});

describe("assertAuthAvailable", () => {
  it("throws 503 only when the session store was unreadable", () => {
    expect(() => assertAuthAvailable({ player: null, sessionId: null, authUnavailable: false })).not.toThrow();
    try {
      assertAuthAvailable({ player: null, sessionId: null, authUnavailable: true });
      expect.unreachable();
    } catch (err) {
      expect(isHttpError(err, 503)).toBe(true);
    }
  });
});

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return serverFiles(full);
    return name === "+server.ts" ? [full] : [];
  });
}

describe("every /api/duos/** endpoint runs the wrapper first", () => {
  const files = serverFiles(path.join(routesDir, "api", "duos"));

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files.map((f) => [path.relative(routesDir, f), f]))("%s", (_rel, file) => {
    const src = readFileSync(file, "utf8");
    const handlers = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b[^=]*=\s*([^\n]*)/g)];
    expect(handlers.length).toBeGreaterThan(0);
    for (const [, method, rhs] of handlers) {
      expect(rhs, `${method} must be duoRoute(...)`).toMatch(/^duoRoute\(/);
    }
    expect(src).not.toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/);
  });
});

describe("cookie routes answer 503 when the session store is unreadable", () => {
  it("POST /api/learnings", async () => {
    const { POST } = await import("../../../../routes/api/learnings/+server.js");
    const ev = { locals: { player: null, sessionId: null, authUnavailable: true }, request: new Request("http://x") };
    await expect(POST(ev as never)).rejects.toSatisfy((err: unknown) => isHttpError(err, 503));
  });

  it("the hook marks auth unavailable instead of signed out", async () => {
    vi.resetModules();
    vi.doMock("$lib/server/auth/index.js", async (orig) => ({
      ...(await orig<object>()),
      verifyAuthSession: async () => {
        throw new Error("db down");
      },
    }));
    vi.doMock("$lib/server/db/index.js", () => ({ getDb: () => ({}) }));
    const { handle } = await import("../../../../hooks.server.js");
    const locals = {} as Locals;
    await handle({
      event: { locals, cookies: { get: () => "raw" } } as never,
      resolve: async () => new Response("ok"),
    });
    expect(locals).toMatchObject({ player: null, authUnavailable: true });
    vi.doUnmock("$lib/server/auth/index.js");
    vi.doUnmock("$lib/server/db/index.js");
  });
});
