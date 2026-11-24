import { error } from "@sveltejs/kit";
import { spikeEnabled } from "$lib/server/spike/state.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = () => {
  if (!spikeEnabled()) error(404, "Not found");
  return {};
};
