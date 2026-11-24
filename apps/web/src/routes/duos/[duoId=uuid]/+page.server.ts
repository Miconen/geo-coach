import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";

// The Duo's home is Review until Home ships (#56 3a); query params are forwarded.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  await assertDuoAccess(locals, params.duoId, url);
  redirect(302, `/duos/${params.duoId}/review${url.search}`);
};
