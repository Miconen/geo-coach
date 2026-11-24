import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import {
  applySuggestionOnce,
  deleteTranscriptRule,
  deleteUtteranceEdit,
  dismissSuggestion,
  DomainError,
  fixUtterance,
  listTranscriptRules,
  listTranscriptSuggestions,
  listUtteranceEdits,
  saveTranscriptRule,
} from "$lib/server/services/index.js";
import { duoEventBus } from "$lib/server/events/bus.js";
import { duoRoute } from "$lib/server/auth/guards.js";

const phrase = z.string().trim().min(1).max(120);
const country = z.string().trim().length(2).nullish();
const MAX_TEXT_OFFSET = 1_000_000;

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveRule"),
    source: phrase,
    replacement: phrase,
    countryCode: country,
    enabled: z.boolean().optional(),
  }),
  z.object({ action: z.literal("deleteRule"), source: phrase, countryCode: country }),
  z.object({
    action: z.literal("applyOnce"),
    replacement: phrase,
    occurrences: z
      .array(
        z.object({
          utteranceId: z.string().uuid(),
          charStart: z.number().int().min(0).max(MAX_TEXT_OFFSET),
          charEnd: z.number().int().min(1).max(MAX_TEXT_OFFSET),
          originalText: z.string().min(1).max(200),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({
    action: z.literal("fixUtterance"),
    utteranceId: z.string().uuid(),
    find: phrase,
    replacement: phrase,
    scope: z.enum(["once", "always", "country"]),
    countryCode: country,
  }),
  z.object({ action: z.literal("undoEdit"), editId: z.string().uuid() }),
  z.object({ action: z.literal("dismiss"), source: phrase, replacement: phrase }),
]);

const querySchema = z.object({
  suggestions: z.enum(["0", "1"]).default("1"),
  edits: z.coerce.number().int().min(1).max(100_000).default(100),
});

function failure(err: unknown) {
  if (err instanceof DomainError) return json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return json({ error: "Invalid correction payload" }, { status: 400 });
  throw err;
}

export const GET: RequestHandler = duoRoute(async ({ url }, { db, duoId }) => {
  try {
    const query = querySchema.parse({
      suggestions: url.searchParams.get("suggestions") ?? undefined,
      edits: url.searchParams.get("edits") ?? undefined,
    });
    const [rules, suggestions, editPage] = await Promise.all([
      listTranscriptRules(db, duoId),
      query.suggestions === "1" ? listTranscriptSuggestions(db, duoId) : null,
      listUtteranceEdits(db, duoId, query.edits),
    ]);
    return json({
      rules,
      ...(suggestions ? { suggestions } : {}),
      edits: editPage.edits,
      totalEdits: editPage.total,
    });
  } catch (err) {
    return failure(err);
  }
});

export const POST: RequestHandler = duoRoute(async ({ request }, { db, player, duoId }) => {
  try {
    const input = actionSchema.parse(await request.json());
    const playerId = player.id;
    let applied: number | undefined;
    if (input.action === "saveRule") await saveTranscriptRule(db, { ...input, duoId, playerId });
    if (input.action === "deleteRule") {
      await deleteTranscriptRule(db, duoId, input.source, input.countryCode);
    }
    if (input.action === "applyOnce") {
      ({ applied } = await applySuggestionOnce(db, { ...input, duoId, playerId }));
    }
    if (input.action === "fixUtterance") {
      ({ applied } = await fixUtterance(db, { ...input, duoId, playerId }));
    }
    if (input.action === "undoEdit") await deleteUtteranceEdit(db, duoId, input.editId);
    if (input.action === "dismiss") await dismissSuggestion(db, { ...input, duoId });
    duoEventBus.emitChanged(duoId, "corrections", duoId);
    return json({ ok: true, applied });
  } catch (err) {
    return failure(err);
  }
});
