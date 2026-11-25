import { error, json } from "@sveltejs/kit";
import { emitSpikeEvent, spikeEnabled, spikeState } from "$lib/server/spike/state.js";
import { clearWorkbenchCache } from "$lib/server/workbench/cache.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  if (!spikeEnabled()) error(404, "Not found");
  const body = (await request.json()) as {
    action: "emit" | "revoke" | "reset" | "drop" | "clear-workbench";
    id?: string;
  };
  if (body.action === "clear-workbench") clearWorkbenchCache();
  if (body.action === "emit") return json({ id: emitSpikeEvent() });
  if (body.action === "drop") {
    for (const c of spikeState.streams) c.close();
    spikeState.streams.clear();
  }
  if (body.action === "revoke" && body.id) spikeState.revoked.add(body.id);
  if (body.action === "reset") {
    spikeState.revoked.clear();
    spikeState.loads.clear();
  }
  return json({ ok: true });
};
