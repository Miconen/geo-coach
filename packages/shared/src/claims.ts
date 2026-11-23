import { z } from "zod";
import {
  isoCountryCodeSchema,
  learningRegionSchema,
  type LearningRegion,
} from "./contracts.js";

/** GLOSSARY: Claim. Never stored; derived from Evidence by `deriveClaimStatus` (ADR 0005). */
export const claimStatusSchema = z.enum(["speculated", "verified", "disproved", "disputed"]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

/** GLOSSARY: Evidence. */
export const evidenceKindSchema = z.enum(["round", "player", "documentation"]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const evidenceDirectionSchema = z.enum(["for", "against"]);
export type EvidenceDirection = z.infer<typeof evidenceDirectionSchema>;

/**
 * A Claim's status from its Evidence (ADR 0005): speculated with none, verified
 * with only Evidence for, disproved with only Evidence against, disputed with both.
 * A Round only ever counts for a Claim, whatever direction it was stored with.
 */
export function deriveClaimStatus(
  evidence: ReadonlyArray<{ kind: EvidenceKind; direction: EvidenceDirection }>,
): ClaimStatus {
  let hasFor = false;
  let hasAgainst = false;
  for (const e of evidence) {
    if (e.kind !== "round" && e.direction === "against") hasAgainst = true;
    else hasFor = true;
  }
  if (hasFor && hasAgainst) return "disputed";
  if (hasFor) return "verified";
  if (hasAgainst) return "disproved";
  return "speculated";
}

const topicsSchema = z.array(z.string().trim().toLowerCase().min(1).max(60)).default([]);

/**
 * Evidence an agent may attach through `add_claims`: a Round whose true location
 * confirms the Claim, or a section of a Source. Player Evidence comes only from
 * the Player themselves in the workbench.
 */
export const agentEvidenceInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("round"),
    roundId: z.string().uuid(),
    direction: evidenceDirectionSchema.default("for"),
    note: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    kind: z.literal("documentation"),
    sourceVersionId: z.string().uuid(),
    section: z.string().trim().min(1).max(200),
    direction: evidenceDirectionSchema.default("for"),
    /** Names of images uploaded to that Source version, shown with the Claim. */
    images: z.array(z.string().trim().min(1).max(200)).default([]),
    note: z.string().trim().max(500).nullable().optional(),
  }),
]);
export type AgentEvidenceInput = z.infer<typeof agentEvidenceInputSchema>;

/**
 * One `add_claims` item: either a new Claim (`text` plus optional Evidence) or
 * Evidence for an existing Claim (`claimId` plus at least one Evidence item).
 */
export const claimItemInputSchema = z
  .object({
    claimId: z.string().uuid().optional(),
    text: z.string().trim().min(1).max(500).optional(),
    countries: z.array(isoCountryCodeSchema).default([]),
    regions: z.array(learningRegionSchema).default([]),
    topics: topicsSchema,
    evidence: z.array(agentEvidenceInputSchema).default([]),
  })
  .superRefine((val, ctx) => {
    val.evidence.forEach((e, i) => {
      if (e.kind === "round" && e.direction === "against") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", i, "direction"],
          message:
            "A Round only ever counts for a Claim: a country can be covered by several cars and generations",
        });
      }
    });
    if (val.claimId) {
      if (val.text !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: "Pass either claimId (to add Evidence) or text (to create a Claim), not both",
        });
      }
      if (val.evidence.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message: "Adding to an existing Claim needs at least one Evidence item",
        });
      }
      return;
    }
    if (val.text === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "text is required to create a Claim (or pass claimId to add Evidence)",
      });
    }
    const countrySet = new Set(val.countries);
    val.regions.forEach((reg: LearningRegion, i) => {
      if (!countrySet.has(reg.country)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["regions", i, "country"],
          message: `Region "${reg.name}" references country ${reg.country} which is not in countries[]`,
        });
      }
    });
  });
export type ClaimItemInput = z.infer<typeof claimItemInputSchema>;

export const searchClaimsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  countries: z.array(isoCountryCodeSchema).optional(),
  topics: z.array(z.string().trim().toLowerCase().min(1).max(60)).optional(),
  status: claimStatusSchema.optional(),
});
export type SearchClaimsInput = z.infer<typeof searchClaimsInputSchema>;

/** A Player's own ✓/✗ on a Claim; `null` withdraws it. */
export const playerEvidenceInputSchema = z.object({
  direction: evidenceDirectionSchema.nullable(),
});
export type PlayerEvidenceInput = z.infer<typeof playerEvidenceInputSchema>;

/** What kind of document a Source is (GLOSSARY: Source). */
export const sourceKindSchema = z.enum(["web", "pdf", "other"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;
