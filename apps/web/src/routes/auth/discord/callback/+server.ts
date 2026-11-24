import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import {
  SESSION_COOKIE_NAME,
  createAuthSession,
  findPlayerByDiscordIdInAnyDuo,
  getDiscordClient,
} from "$lib/server/auth/index.js";
import { safeNext } from "$lib/server/auth/guards.js";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const discord = getDiscordClient();
  if (!discord) {
    return new Response("Discord OAuth is not configured.", { status: 503 });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = cookies.get("discord_oauth_state");
  cookies.delete("discord_oauth_state", { path: "/" });
  const next = safeNext(cookies.get("login_next"));
  cookies.delete("login_next", { path: "/" });

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const tokens = await discord.validateAuthorizationCode(code, null);
  const discordUserRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!discordUserRes.ok) {
    return new Response("Failed to fetch Discord profile", { status: 502 });
  }
  const discordUser = (await discordUserRes.json()) as { id: string };

  const player = await findPlayerByDiscordIdInAnyDuo(getDb(), discordUser.id);
  if (!player) {
    return new Response(
      "Your Discord account is not a Player in any configured Duo on this geo-coach server.",
      { status: 403 },
    );
  }

  const { rawSessionToken, expiresAt } = await createAuthSession(getDb(), player.id);
  cookies.set(SESSION_COOKIE_NAME, rawSessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });

  redirect(302, next);
};
