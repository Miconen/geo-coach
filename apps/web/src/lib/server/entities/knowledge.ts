import type { AppDb } from "../db/index.js";
import {
  buildWorkbenchData,
  type WorkbenchClaim,
  type WorkbenchData,
  type WorkbenchLearning,
  type WorkbenchSource,
} from "../workbench/view-model.js";
import { links } from "../../links.js";

/**
 * /knowledge and the Claim drawers (#56 3a): the Duo's Claims (Evidence-derived status, the viewer's vote) and its
 * Sources, sliced from the Review derivation so both agree. Claim images use the ?r=2 URLs (one builder), and the
 * lookups keep only what the Claims' Evidence and linked Learnings name.
 */
export interface KnowledgePayload {
  kind: "knowledge";
  claims: WorkbenchClaim[];
  sources: WorkbenchSource[];
  wb: Pick<WorkbenchData, "roundsById" | "gamesById" | "players"> & { learnings: WorkbenchLearning[] };
}

export function knowledgeFromWorkbench(full: WorkbenchData): KnowledgePayload {
  const claims = full.claims.map((c) => ({ ...c, imageUrls: c.imageIds.map(links.sourceImage) }));
  const roundIds = new Set(claims.flatMap((c) => c.evidence.flatMap((e) => (e.roundId ? [e.roundId] : []))));
  const learningIds = new Set(claims.flatMap((c) => c.learningIds));
  const roundsById: KnowledgePayload["wb"]["roundsById"] = {};
  const gamesById: KnowledgePayload["wb"]["gamesById"] = {};
  for (const id of roundIds) {
    const round = full.roundsById[id];
    if (!round) continue;
    roundsById[id] = round;
    const game = full.gamesById[round.gameId];
    if (game) gamesById[game.id] = game;
  }
  return {
    kind: "knowledge",
    claims,
    sources: full.sources,
    wb: {
      roundsById,
      gamesById,
      players: full.players,
      learnings: full.learnings.filter((l) => learningIds.has(l.id)),
    },
  };
}

export async function loadKnowledgePayload(db: AppDb, duoId: string, playerId: string): Promise<KnowledgePayload> {
  return knowledgeFromWorkbench(await buildWorkbenchData(db, duoId, playerId, { speech: "cited" }));
}

/** One Claim and the lookups its card needs (Review's drawer, #56 3b); null when it is not this Duo's. */
export interface ClaimPayload {
  claim: WorkbenchClaim;
  wb: KnowledgePayload["wb"];
}

export async function loadClaimPayload(db: AppDb, duoId: string, playerId: string, claimId: string): Promise<ClaimPayload | null> {
  const full = await buildWorkbenchData(db, duoId, playerId, { speech: "cited" });
  const one = full.claimsById[claimId];
  if (!one) return null;
  const k = knowledgeFromWorkbench({ ...full, claims: [one] });
  return { claim: k.claims[0]!, wb: k.wb };
}
