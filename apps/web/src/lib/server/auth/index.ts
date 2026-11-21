import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Discord } from "arctic";
import { uuidv7, type TokenScope } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { apiTokens, authSessions, duoMemberships, players } from "../db/schema.js";

export const SESSION_COOKIE_NAME = "geocoach_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isDevLoginEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "development";
}

export function getDiscordClient(): Discord | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return new Discord(clientId, clientSecret, redirectUri);
}

export async function createAuthSession(
  db: AppDb,
  playerId: string,
): Promise<{ rawSessionToken: string; expiresAt: Date }> {
  const rawSessionToken = randomBytes(32).toString("base64url");
  const sessionId = hashToken(rawSessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(authSessions).values({
    id: sessionId,
    playerId,
    expiresAt,
  });

  return { rawSessionToken, expiresAt };
}

export async function verifyAuthSession(db: AppDb, rawSessionToken: string) {
  if (!rawSessionToken) return null;
  const sessionId = hashToken(rawSessionToken);
  const session = await db.query.authSessions.findFirst({
    where: eq(authSessions.id, sessionId),
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
    return null;
  }

  const player = await db.query.players.findFirst({
    where: eq(players.id, session.playerId),
  });
  if (!player) return null;

  return { sessionId: session.id, player };
}

export async function deleteAuthSession(db: AppDb, rawSessionToken: string): Promise<void> {
  const sessionId = hashToken(rawSessionToken);
  await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

export async function findPlayerByDiscordIdInAnyDuo(db: AppDb, discordId: string) {
  const player = await db.query.players.findFirst({
    where: eq(players.discordId, discordId),
  });
  if (!player) return null;

  const membership = await db.query.duoMemberships.findFirst({
    where: eq(duoMemberships.playerId, player.id),
  });
  if (!membership) return null;

  return player;
}

export async function issueApiToken(
  db: AppDb,
  playerId: string,
  scope: TokenScope,
  label: string,
  ttlDays: number = 90,
): Promise<{
  id: string;
  rawToken: string;
  tokenPrefix: string;
  scope: TokenScope;
  expiresAt: Date;
}> {
  const id = uuidv7();
  const prefix = scope === "companion" ? "gc_cmp_" : "gc_mcp_";
  const rawToken = `${prefix}${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 14);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await db.insert(apiTokens).values({
    id,
    playerId,
    scope,
    label: label.trim() || `${scope} token`,
    tokenHash,
    tokenPrefix,
    expiresAt,
  });

  return { id, rawToken, tokenPrefix, scope, expiresAt };
}

export async function verifyApiToken(
  db: AppDb,
  rawToken: string,
  requiredScope: TokenScope,
) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = await db.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.tokenHash, tokenHash),
      eq(apiTokens.scope, requiredScope),
      isNull(apiTokens.revokedAt),
    ),
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  const player = await db.query.players.findFirst({
    where: eq(players.id, row.playerId),
  });
  if (!player) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id));

  return { token: row, player };
}

export async function revokeApiToken(
  db: AppDb,
  playerId: string,
  tokenId: string,
): Promise<boolean> {
  const existing = await db.query.apiTokens.findFirst({
    where: and(eq(apiTokens.id, tokenId), eq(apiTokens.playerId, playerId)),
  });
  if (!existing) return false;

  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));
  return true;
}

export async function listPlayerTokens(db: AppDb, playerId: string) {
  return db.query.apiTokens.findMany({
    where: eq(apiTokens.playerId, playerId),
    orderBy: [desc(apiTokens.createdAt)],
  });
}

export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() ?? null;
}
