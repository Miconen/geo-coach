import type { AppDb } from "../db/index.js";
import { loadWorkbench } from "../workbench/cache.js";
import {
  type WorkbenchClaim,
  type WorkbenchData,
  type WorkbenchLearning,
  type WorkbenchSource,
} from "../workbench/view-model.js";
import { links } from "../../links.js";
import {
  CLAIM_CARD_PAGE,
  groupClaimsByCountry,
  windowClaimGroups,
  type ClaimSummary,
} from "../../workbench/knowledge.js";

/**
 * /knowledge and the Claim drawers (#56 3a): the Duo's Claims (Evidence-derived status, the viewer's vote) and its
 * Sources, sliced from the Review derivation so both agree. Claim images use the ?r=2 URLs (one builder), and the
 * lookups keep only what the Claims' Evidence and linked Learnings name.
 */
export type KnowledgeLookups = Pick<WorkbenchData, "roundsById" | "gamesById" | "players"> & { learnings: WorkbenchLearning[] };

/** Some of the Duo's full Claims and the lookups their cards need. */
export interface ClaimDetails {
  claims: WorkbenchClaim[];
  wb: KnowledgeLookups;
}

/**
 * /knowledge lists, filters and groups every Claim by its summary; full Claims ship only for the cards first shown
 * (the first page under ?country=, and ?claim=), the rest load on demand through claimDetails.
 */
export interface KnowledgePayload extends ClaimDetails {
  kind: "knowledge";
  summaries: ClaimSummary[];
  sources: WorkbenchSource[];
}

export function claimDetails(full: WorkbenchData, claimIds: Iterable<string>): ClaimDetails {
  const claims: WorkbenchClaim[] = [];
  for (const id of claimIds) {
    const c = full.claimsById[id];
    if (c) claims.push({ ...c, imageUrls: c.imageIds.map(links.sourceImage) });
  }
  const roundIds = new Set(claims.flatMap((c) => c.evidence.flatMap((e) => (e.roundId ? [e.roundId] : []))));
  const learningIds = new Set(claims.flatMap((c) => c.learningIds));
  const roundsById: KnowledgeLookups["roundsById"] = {};
  const gamesById: KnowledgeLookups["gamesById"] = {};
  for (const id of roundIds) {
    const round = full.roundsById[id];
    if (!round) continue;
    roundsById[id] = round;
    const game = full.gamesById[round.gameId];
    if (game) gamesById[game.id] = game;
  }
  return {
    claims,
    wb: { roundsById, gamesById, players: full.players, learnings: full.learnings.filter((l) => learningIds.has(l.id)) },
  };
}

export async function loadKnowledgePayload(
  db: AppDb,
  duoId: string,
  playerId: string,
  shown: { country: string | null; claimId: string | null } = { country: null, claimId: null },
): Promise<KnowledgePayload> {
  const full = await loadWorkbench(db, duoId, playerId, { speech: "cited" });
  const summaries: ClaimSummary[] = full.claims.map(({ id, text, countries, regions, topics, status }) => ({
    id,
    text,
    countries,
    regions,
    topics,
    status,
  }));
  const firstIds = new Set<string>();
  for (const g of windowClaimGroups(groupClaimsByCountry(summaries, shown.country), CLAIM_CARD_PAGE)) {
    for (const c of g.claims) firstIds.add(c.id);
  }
  if (shown.claimId) firstIds.add(shown.claimId);
  return { kind: "knowledge", summaries, sources: full.sources, ...claimDetails(full, firstIds) };
}

export async function loadClaimDetails(db: AppDb, duoId: string, playerId: string, claimIds: string[]): Promise<ClaimDetails> {
  return claimDetails(await loadWorkbench(db, duoId, playerId, { speech: "cited" }), claimIds);
}

/** One Claim and the lookups its card needs (Review's drawer, #56 3b); null when it is not this Duo's. */
export interface ClaimPayload {
  claim: WorkbenchClaim;
  wb: KnowledgeLookups;
}

export async function loadClaimPayload(db: AppDb, duoId: string, playerId: string, claimId: string): Promise<ClaimPayload | null> {
  const { claims, wb } = await loadClaimDetails(db, duoId, playerId, [claimId]);
  return claims[0] ? { claim: claims[0], wb } : null;
}
