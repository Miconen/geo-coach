import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { SESSION_COOKIE_NAME, deleteAuthSession } from "$lib/server/auth/index.js";

export const POST: RequestHandler = async ({ cookies }) => {
  const raw = cookies.get(SESSION_COOKIE_NAME);
  if (raw) {
    await deleteAuthSession(getDb(), raw);
    cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
  }
  redirect(302, "/login");
};
