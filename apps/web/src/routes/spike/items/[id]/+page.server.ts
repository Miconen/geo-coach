import { error } from "@sveltejs/kit";
import { countLoad, spikeState } from "$lib/server/spike/state.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
  // Reads only ?duo=, like routes/+page.server.ts, so other params must not rerun it.
  const duo = url.searchParams.get("duo");
  if (spikeState.revoked.has(params.id)) error(404, "Revoked");
  if (params.id.startsWith("slow")) await new Promise((r) => setTimeout(r, 1500));
  return { id: params.id, duo, loadCount: countLoad(`items:${params.id}`) };
};
