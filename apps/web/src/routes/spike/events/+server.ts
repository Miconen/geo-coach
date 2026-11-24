import { error } from "@sveltejs/kit";
import { spikeEnabled, spikeState } from "$lib/server/spike/state.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
  if (!spikeEnabled()) error(404, "Not found");
  let ctrl: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start(controller) {
      ctrl = controller;
      spikeState.streams.add(controller);
      controller.enqueue("retry: 200\n: ready\n\n");
    },
    cancel() {
      spikeState.streams.delete(ctrl);
    },
  });
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
};
