import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { assertDuoAccess } from "$lib/server/auth/guards.js";
import { getDb } from "$lib/server/db/index.js";
import { loadSourceView } from "$lib/server/entities/index.js";

// ?v= is a positive int4 like X1's n (else 404); missing means the current version.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const db = getDb();
  await assertDuoAccess(locals, params.duoId, url, db);
  const v = url.searchParams.get("v");
  if (v !== null && (!/^[1-9]\d{0,9}$/.test(v) || Number(v) > 2_147_483_647)) error(404, "Not found");
  const view = await loadSourceView(db, params.duoId, params.sourceId, v === null ? null : Number(v), url.searchParams.get("section"));
  if (!view) error(404, "Not found");
  return { view, crumbs: [{ label: view.source.title }] };
};
