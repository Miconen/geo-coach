import type { RequestHandler } from "./$types";
import { getDb } from "$lib/server/db/index.js";
import { handleCompanionRequest } from "$lib/server/companion-api/handler.js";

export const GET: RequestHandler = ({ request }) =>
  handleCompanionRequest(getDb(), request, "bootstrap");
