import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  deriveClaimStatus,
  getCountryName,
  uuidv7,
  type ClaimStatus,
  type EvidenceDirection,
  type EvidenceKind,
  type LearningRegion,
  type SearchClaimsInput,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { claimEvidence, claimImages, claims, learnings, sourceImages } from "../db/schema.js";
import { DomainError, assertPlayerInDuo } from "./recordings.js";
import { evidenceInDuo, sourceImageInDuo } from "./scope.js";

export interface DerivedEvidence {
  id: string;
  kind: EvidenceKind;
  direction: EvidenceDirection;
  roundId: string | null;
  playerId: string | null;
  sourceVersionId: string | null;
  sectionAnchor: string | null;
  runId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface DerivedClaim {
  id: string;
  duoId: string;
  runId: string | null;
  createdByPlayerId: string | null;
  text: string;
  countries: string[];
  regions: LearningRegion[];
  topics: string[];
  createdAt: Date;
  status: ClaimStatus;
  evidence: DerivedEvidence[];
  /** Every Learning linked to the Claim, current or not; callers filter by status. */
  learningIds: string[];
  /** Source images shown with the Claim. */
  imageIds: string[];
}

/** A Duo's Claims, each with its Evidence and derived status (ADR 0005), oldest first. */
export async function deriveClaims(db: AppDb, duoId: string): Promise<DerivedClaim[]> {
  const [rows, evidenceRows, linkedLearnings, imageLinks] = await Promise.all([
    db.query.claims.findMany({
      where: eq(claims.duoId, duoId),
      orderBy: [asc(claims.createdAt), asc(claims.id)],
    }),
    db
      .select()
      .from(claimEvidence)
      .where(evidenceInDuo(duoId))
      .orderBy(asc(claimEvidence.createdAt), asc(claimEvidence.id)),
    db
      .select({ id: learnings.id, claimId: learnings.claimId })
      .from(learnings)
      .where(eq(learnings.duoId, duoId)),
    db
      .select({ claimId: claimImages.claimId, imageId: claimImages.sourceImageId })
      .from(claimImages)
      .innerJoin(sourceImages, eq(sourceImages.id, claimImages.sourceImageId))
      .innerJoin(claims, eq(claims.id, claimImages.claimId))
      .where(and(eq(claims.duoId, duoId), sourceImageInDuo(duoId))),
  ]);

  const evidenceByClaim = new Map<string, DerivedEvidence[]>();
  for (const e of evidenceRows) {
    const list = evidenceByClaim.get(e.claimId) ?? [];
    list.push({
      id: e.id,
      kind: e.kind,
      direction: e.direction,
      roundId: e.roundId,
      playerId: e.playerId,
      sourceVersionId: e.sourceVersionId,
      sectionAnchor: e.sectionAnchor,
      runId: e.runId,
      note: e.note,
      createdAt: e.createdAt,
    });
    evidenceByClaim.set(e.claimId, list);
  }
  const learningsByClaim = new Map<string, string[]>();
  for (const l of linkedLearnings) {
    if (!l.claimId) continue;
    const list = learningsByClaim.get(l.claimId) ?? [];
    list.push(l.id);
    learningsByClaim.set(l.claimId, list);
  }

  const imagesByClaim = new Map<string, string[]>();
  for (const link of imageLinks) {
    const list = imagesByClaim.get(link.claimId) ?? [];
    list.push(link.imageId);
    imagesByClaim.set(link.claimId, list);
  }

  return rows.map((c) => {
    const evidence = evidenceByClaim.get(c.id) ?? [];
    return {
      id: c.id,
      duoId: c.duoId,
      runId: c.runId,
      createdByPlayerId: c.createdByPlayerId,
      text: c.text,
      countries: c.countries,
      regions: c.regions,
      topics: c.topics,
      createdAt: c.createdAt,
      status: deriveClaimStatus(evidence),
      evidence,
      learningIds: learningsByClaim.get(c.id) ?? [],
      imageIds: imagesByClaim.get(c.id) ?? [],
    };
  });
}

/** Filters Claims by text, any shared country, any shared topic and status. */
export function filterClaims<C extends Pick<DerivedClaim, "text" | "countries" | "regions" | "topics" | "status">>(
  all: C[],
  filters: SearchClaimsInput,
): C[] {
  const q = filters.query?.trim().toLowerCase() ?? "";
  const countries = filters.countries ?? [];
  const topics = filters.topics ?? [];
  return all.filter((c) => {
    if (filters.status && c.status !== filters.status) return false;
    if (countries.length > 0 && !c.countries.some((code) => countries.includes(code))) return false;
    if (topics.length > 0 && !c.topics.some((t) => topics.includes(t))) return false;
    if (q) {
      const hay = [
        c.text,
        ...c.countries,
        ...c.countries.map(getCountryName),
        ...c.regions.map((r) => r.name),
        ...c.topics,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** One-line Evidence tally for agents, e.g. "2 Round, Player 1✓ 0✗". */
export function summarizeEvidence(evidence: ReadonlyArray<Pick<DerivedEvidence, "kind" | "direction">>): string {
  if (evidence.length === 0) return "no Evidence";
  const parts: string[] = [];
  const rounds = evidence.filter((e) => e.kind === "round").length;
  if (rounds > 0) parts.push(`${rounds} Round`);
  for (const kind of ["player", "documentation"] as const) {
    const ofKind = evidence.filter((e) => e.kind === kind);
    if (ofKind.length === 0) continue;
    const forCount = ofKind.filter((e) => e.direction === "for").length;
    const label = kind === "player" ? "Player" : "Documentation";
    parts.push(`${label} ${forCount}✓ ${ofKind.length - forCount}✗`);
  }
  return parts.join(", ");
}

export interface NewClaim {
  text: string;
  countries: string[];
  regions: LearningRegion[];
  topics: string[];
}

export interface NewEvidence {
  kind: EvidenceKind;
  direction: EvidenceDirection;
  roundId?: string | null;
  playerId?: string | null;
  sourceVersionId?: string | null;
  sectionAnchor?: string | null;
  /** Source images to show with the Claim, for Documentation Evidence. */
  imageIds?: string[];
  note?: string | null;
}

/** Creates a Claim in a Duo, attributed to a run when made inside one. */
export async function insertClaim(
  db: AppDb,
  input: NewClaim & { duoId: string; runId: string | null; createdByPlayerId: string | null },
): Promise<string> {
  const id = uuidv7();
  await db.insert(claims).values({
    id,
    duoId: input.duoId,
    runId: input.runId,
    createdByPlayerId: input.createdByPlayerId,
    text: input.text,
    countries: input.countries,
    regions: input.regions,
    topics: input.topics,
  });
  return id;
}

/**
 * Adds Evidence to a Claim. The same Round or Source section counts once per
 * Claim, so repeating it is a no-op; returns the ids of rows actually inserted.
 */
export async function insertEvidence(
  db: AppDb,
  claimId: string,
  duoId: string,
  runId: string | null,
  items: NewEvidence[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "round" && item.direction !== "for") {
      throw new DomainError("INVALID_EVIDENCE", "A Round only ever counts for a Claim", 400);
    }
    const id = uuidv7();
    const inserted = await db
      .insert(claimEvidence)
      .values({
        id,
        claimId,
        duoId,
        kind: item.kind,
        direction: item.direction,
        roundId: item.roundId ?? null,
        playerId: item.playerId ?? null,
        sourceVersionId: item.sourceVersionId ?? null,
        sectionAnchor: item.sectionAnchor ?? null,
        runId,
        note: item.note ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: claimEvidence.id });
    if (inserted.length > 0) ids.push(id);
    if (item.imageIds && item.imageIds.length > 0) {
      await db
        .insert(claimImages)
        .values(item.imageIds.map((sourceImageId) => ({ claimId, sourceImageId })))
        .onConflictDoNothing();
    }
  }
  return ids;
}

/** Claim ids among `ids` that belong to the Duo. */
export async function duoClaimIds(db: AppDb, duoId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.duoId, duoId), inArray(claims.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Sets the Player's own ✓ (`for`) or ✗ (`against`) on a Claim, replacing any
 * earlier one; `null` withdraws it. A Player can never touch another's Evidence.
 */
export async function setPlayerEvidence(
  db: AppDb,
  playerId: string,
  claimId: string,
  direction: EvidenceDirection | null,
): Promise<{ duoId: string; direction: EvidenceDirection | null }> {
  const claim = await db.query.claims.findFirst({ where: eq(claims.id, claimId) });
  if (!claim) throw new DomainError("NOT_FOUND", "Claim not found", 404);
  await assertPlayerInDuo(db, playerId, claim.duoId);

  await db
    .delete(claimEvidence)
    .where(
      and(
        eq(claimEvidence.claimId, claimId),
        eq(claimEvidence.kind, "player"),
        eq(claimEvidence.playerId, playerId),
      ),
    );
  if (direction) {
    await db.insert(claimEvidence).values({
      id: uuidv7(),
      claimId,
      duoId: claim.duoId,
      kind: "player",
      direction,
      playerId,
    });
  }
  return { duoId: claim.duoId, direction };
}

/** What a Claim's Evidence amounts to for edit/delete safety: Player and Round Evidence can't be recreated by an agent. */
export interface ClaimEvidenceFacts {
  hasPlayerEvidence: boolean;
  hasRoundEvidence: boolean;
  evidenceCount: number;
}

/** Per-Claim facts about Evidence, for the Claims among `ids` that belong to the Duo. */
export async function claimEvidenceFacts(
  db: AppDb,
  duoId: string,
  ids: string[],
): Promise<Map<string, ClaimEvidenceFacts>> {
  const facts = new Map<string, ClaimEvidenceFacts>();
  if (ids.length === 0) return facts;
  const rows = await db
    .select({ claimId: claimEvidence.claimId, kind: claimEvidence.kind, n: sql<number>`count(*)::int` })
    .from(claimEvidence)
    .where(and(eq(claimEvidence.duoId, duoId), inArray(claimEvidence.claimId, ids)))
    .groupBy(claimEvidence.claimId, claimEvidence.kind);
  for (const id of ids) facts.set(id, { hasPlayerEvidence: false, hasRoundEvidence: false, evidenceCount: 0 });
  for (const r of rows) {
    const f = facts.get(r.claimId)!;
    f.evidenceCount += r.n;
    if (r.kind === "player") f.hasPlayerEvidence = true;
    if (r.kind === "round") f.hasRoundEvidence = true;
  }
  return facts;
}

export interface ClaimPatch {
  text?: string;
  countries?: string[];
  regions?: LearningRegion[];
  topics?: string[];
}

/** Changes a Claim's wording, countries, regions or topics. Evidence stays as it is. */
export async function updateClaim(db: AppDb, duoId: string, claimId: string, patch: ClaimPatch): Promise<void> {
  const set: Partial<typeof claims.$inferInsert> = {};
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.countries !== undefined) set.countries = patch.countries;
  if (patch.regions !== undefined) set.regions = patch.regions;
  if (patch.topics !== undefined) set.topics = patch.topics;
  if (Object.keys(set).length === 0) return;
  await db.update(claims).set(set).where(and(eq(claims.id, claimId), eq(claims.duoId, duoId)));
}

/**
 * Deletes Claims of a Duo. Their Evidence and image links go with them; Learnings
 * that cited one keep their text and only lose the link.
 */
export async function deleteClaimsById(db: AppDb, duoId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(claims).where(and(eq(claims.duoId, duoId), inArray(claims.id, ids)));
}
