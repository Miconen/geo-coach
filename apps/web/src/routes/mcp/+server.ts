import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { handleMcpHttpRequest } from "$lib/server/mcp/server.js";

export const GET: RequestHandler = ({ request }) => handleMcpHttpRequest(getDb(), request);
export const POST: RequestHandler = ({ request }) => handleMcpHttpRequest(getDb(), request);
export const DELETE: RequestHandler = ({ request }) => handleMcpHttpRequest(getDb(), request);
