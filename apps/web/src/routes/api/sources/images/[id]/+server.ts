import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { DomainError, readSourceImageForPlayer } from "$lib/server/services/index.js";

/** A Source image, served only to signed-in Players of the Duo that owns it. */
export const GET: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.player) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const image = await readSourceImageForPlayer(getDb(), locals.player.id, params.id);
    const etag = `"${image.sha256}"`;
    const headers = {
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=86400",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(image.bytes), { headers });
  } catch (err) {
    if (err instanceof DomainError) {
      return json({ error: err.message }, { status: err.status });
    }
    return json({ error: "Image unavailable" }, { status: 404 });
  }
};
