import { countLoad } from "$lib/server/spike/state.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  if (url.searchParams.has("slow")) await new Promise((r) => setTimeout(r, 1500));
  return { loadCount: countLoad("other") };
};
