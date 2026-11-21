import { redirect } from "@sveltejs/kit";
import { generateState } from "arctic";
import type { RequestHandler } from "./$types";
import { getDiscordClient } from "$lib/server/auth/index.js";

export const GET: RequestHandler = async ({ cookies }) => {
  const discord = getDiscordClient();
  if (!discord) {
    return new Response("Discord OAuth is not configured on this server.", { status: 503 });
  }
  const state = generateState();
  const url = discord.createAuthorizationURL(state, null, ["identify"]);
  cookies.set("discord_oauth_state", state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });
  redirect(302, url.toString());
};
