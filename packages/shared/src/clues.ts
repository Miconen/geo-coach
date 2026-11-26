import { z } from "zod";
import { isoCountryCodeSchema, learningRegionSchema } from "./contracts.js";

// GLOSSARY: Clue; ADR 0009. The families and seed values live in the versioned vocabulary prompt
// (apps/web/prompts/clue-vocabulary-vN.md), not here: the server reads them from there.

/** How a Claim ties a Clue to a country: typical there, found in some areas, or the country lacks it. */
export const cluePrevalenceSchema = z.enum(["typical", "some", "lacks"]);
export type CluePrevalence = z.infer<typeof cluePrevalenceSchema>;

/** A Claim rules out only the countries it names or a scope it states, never more than about this many (#90). */
export const MAX_LACKS_COUNTRIES = 15;

export const clueNameSchema = z.string().trim().min(1).max(80);

/** Names a Clue: an existing one by id, or a family and a value (reused if the Duo has it, else created). */
const clueRefShape = {
  clueId: z.string().uuid().optional(),
  family: z.string().trim().min(1).max(80).optional(),
  name: clueNameSchema.optional(),
};

function requireClueRef(val: { clueId?: string; family?: string; name?: string }, ctx: z.RefinementCtx) {
  if (!val.clueId && !(val.family && val.name)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pass clueId, or family and name" });
  }
}

/**
 * One Clue of a tagged Claim, with the countries and the Regions (#92) it ties at one prevalence. A Region is
 * `{ country, name }`, its name as the Claim spells it or the geocoder code `list_claims_to_tag` gives.
 */
export const claimClueLinkInputSchema = z
  .object({
    ...clueRefShape,
    prevalence: cluePrevalenceSchema,
    countries: z.array(isoCountryCodeSchema).max(60).default([]),
    regions: z.array(learningRegionSchema).max(60).default([]),
  })
  .superRefine(requireClueRef)
  .superRefine((val, ctx) => {
    if (val.countries.length === 0 && val.regions.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pass countries, regions, or both" });
    }
  });
export type ClaimClueLinkInput = z.infer<typeof claimClueLinkInputSchema>;

/** One `tag_claims` item: every Clue link of a Claim. An empty list tags the Claim as having none. */
export const claimTagItemInputSchema = z.object({
  claimId: z.string().uuid(),
  clues: z.array(claimClueLinkInputSchema).max(40).default([]),
});
export type ClaimTagItemInput = z.infer<typeof claimTagItemInputSchema>;

/** One Clue said in a Round, with the Utterances (spoken while guessing) that name or describe it. */
export const roundClueInputSchema = z
  .object({
    ...clueRefShape,
    utteranceRefs: z.array(z.string().min(1)).min(1),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .superRefine(requireClueRef);

/** One `add_round_clues` item: every Clue said in one Round. An empty list says none was. */
export const roundCluesItemInputSchema = z.object({
  roundId: z.string().uuid(),
  clues: z.array(roundClueInputSchema).max(30).default([]),
});
export type RoundCluesItemInput = z.infer<typeof roundCluesItemInputSchema>;
