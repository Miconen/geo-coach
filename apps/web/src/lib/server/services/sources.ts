import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { uuidv7, type SourceKind } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import {
  claimEvidence,
  claims,
  sourceImages,
  sourceSections,
  sourceVersions,
  sources,
} from "../db/schema.js";
import { DomainError, assertPlayerInDuo } from "./recordings.js";
import { evidenceInDuo, sourceImageInDuo, sourceVersionInDuo } from "./scope.js";

export const MAX_SOURCE_MARKDOWN_CHARS = 1_000_000;
export const MAX_SOURCE_IMAGE_BYTES = Number(process.env.SOURCE_IMAGE_MAX_BYTES ?? 2 * 1024 * 1024);

export interface SourceSectionDraft {
  anchor: string;
  ordinal: number;
  heading: string;
  level: number;
  body: string;
}

function slugify(heading: string): string {
  return (
    heading
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/**
 * Splits markdown into flat sections, one per ATX heading (`#` to `######`),
 * ignoring headings inside fenced code. Text before the first heading becomes
 * the `intro` section. Anchors are heading slugs, suffixed `-2`, `-3` on repeats,
 * so the same document always yields the same anchors.
 */
export function splitMarkdownSections(markdown: string): SourceSectionDraft[] {
  const sections: SourceSectionDraft[] = [];
  const used = new Map<string, number>();
  let current: { heading: string; level: number; lines: string[] } = { heading: "", level: 0, lines: [] };
  let fence: string | null = null;

  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (current.level === 0 && !body) return;
    const base = current.level === 0 ? "intro" : slugify(current.heading);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    sections.push({
      anchor: seen === 1 ? base : `${base}-${seen}`,
      ordinal: sections.length,
      heading: current.level === 0 ? "(intro)" : current.heading,
      level: current.level,
      body,
    });
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
    }
    const heading = fence === null ? /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (heading && heading[2]) {
      flush();
      current = { heading: heading[2], level: heading[1]!.length, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

/** Local image names a markdown document references (`![alt](name)`), in order, without URLs. */
export function referencedImageNames(markdown: string): string[] {
  const names = new Set<string>();
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    const target = m[1]!;
    if (/^(https?:|data:|\/\/)/i.test(target)) continue;
    names.add(target);
  }
  return [...names];
}

const IMAGE_SIGNATURES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  "image/png": {
    ext: "png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/jpeg": { ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", matches: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString("latin1")) },
  "image/webp": {
    ext: "webp",
    matches: (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
};

/**
 * Decodes and checks an uploaded Source image: base64 only, within the size
 * cap, and its bytes really are the declared PNG, JPEG, GIF or WebP.
 */
export function decodeSourceImage(mimeType: string, base64: string): { bytes: Buffer; ext: string } {
  const type = mimeType.trim().toLowerCase();
  const signature = IMAGE_SIGNATURES[type];
  if (!signature) {
    throw new DomainError(
      "UNSUPPORTED_IMAGE",
      `Unsupported image type "${mimeType}": use ${Object.keys(IMAGE_SIGNATURES).join(", ")}`,
      400,
    );
  }
  const cleaned = base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    throw new DomainError("INVALID_IMAGE", "base64 is not valid base64", 400);
  }
  const approxBytes = Math.floor((cleaned.length * 3) / 4);
  if (approxBytes > MAX_SOURCE_IMAGE_BYTES + 2) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `Image is ${Math.round(approxBytes / 1024)} KiB; the limit is ${Math.round(MAX_SOURCE_IMAGE_BYTES / 1024)} KiB. Downscale or recompress it.`,
      413,
    );
  }
  const bytes = Buffer.from(cleaned, "base64");
  if (bytes.length === 0) throw new DomainError("INVALID_IMAGE", "Image is empty", 400);
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `Image is ${Math.round(bytes.length / 1024)} KiB; the limit is ${Math.round(MAX_SOURCE_IMAGE_BYTES / 1024)} KiB. Downscale or recompress it.`,
      413,
    );
  }
  if (!signature.matches(bytes)) {
    throw new DomainError("INVALID_IMAGE", `The uploaded bytes are not a valid ${type} file`, 400);
  }
  return { bytes, ext: signature.ext };
}

/** Where Source images live on disk: a Docker volume in production, `data/` locally. */
export function sourceImagesDir(): string {
  return process.env.SOURCE_IMAGES_DIR ?? path.resolve(process.cwd(), "data/source-images");
}

function storagePath(storageKey: string): string {
  return path.join(sourceImagesDir(), storageKey);
}

export interface SourceVersionResult {
  sourceId: string;
  sourceVersionId: string;
  versionNo: number;
  sections: Array<{ anchor: string; heading: string; level: number }>;
  imagesToUpload: string[];
  /** Claims whose Documentation Evidence cites a section this version changed or dropped. */
  claimsToRecheck: Array<{
    claimId: string;
    text: string;
    cited: { versionNo: number; section: string };
    change: "changed" | "removed";
  }>;
}

/**
 * Stores a document as a new Source, or as the next version of `sourceId`.
 * Earlier versions, and the Evidence pinned to them, are kept.
 */
export async function addSourceVersion(
  db: AppDb,
  playerId: string,
  input: {
    duoId: string;
    sourceId?: string;
    title: string;
    url?: string | null;
    kind: SourceKind;
    markdown: string;
  },
): Promise<SourceVersionResult> {
  await assertPlayerInDuo(db, playerId, input.duoId);
  if (input.markdown.length > MAX_SOURCE_MARKDOWN_CHARS) {
    throw new DomainError(
      "SOURCE_TOO_LARGE",
      `markdown is ${input.markdown.length} characters; the limit is ${MAX_SOURCE_MARKDOWN_CHARS}`,
      413,
    );
  }
  const sections = splitMarkdownSections(input.markdown);
  if (sections.length === 0) throw new DomainError("EMPTY_SOURCE", "markdown has no content", 400);

  let sourceId = input.sourceId;
  let versionNo = 1;
  if (sourceId) {
    const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
    if (!source || source.duoId !== input.duoId) {
      throw new DomainError("NOT_FOUND", `Source ${sourceId} not found in this Duo`, 404);
    }
    const latest = await db.query.sourceVersions.findFirst({
      where: eq(sourceVersions.sourceId, sourceId),
      orderBy: [desc(sourceVersions.versionNo)],
    });
    versionNo = (latest?.versionNo ?? 0) + 1;
    await db
      .update(sources)
      .set({ title: input.title, url: input.url ?? source.url, kind: input.kind })
      .where(eq(sources.id, sourceId));
  } else {
    sourceId = uuidv7();
    await db.insert(sources).values({
      id: sourceId,
      duoId: input.duoId,
      title: input.title,
      url: input.url ?? null,
      kind: input.kind,
      createdByPlayerId: playerId,
    });
  }

  const sourceVersionId = uuidv7();
  await db.insert(sourceVersions).values({
    id: sourceVersionId,
    sourceId,
    duoId: input.duoId,
    versionNo,
    markdown: input.markdown,
    createdByPlayerId: playerId,
  });
  await db.insert(sourceSections).values(sections.map((s) => ({ sourceVersionId, ...s })));

  return {
    sourceId,
    sourceVersionId,
    versionNo,
    sections: sections.map((s) => ({ anchor: s.anchor, heading: s.heading, level: s.level })),
    imagesToUpload: referencedImageNames(input.markdown),
    claimsToRecheck:
      versionNo > 1 ? await findClaimsToRecheck(db, input.duoId, sourceId, sourceVersionId, sections) : [],
  };
}

async function findClaimsToRecheck(
  db: AppDb,
  duoId: string,
  sourceId: string,
  newVersionId: string,
  newSections: SourceSectionDraft[],
): Promise<SourceVersionResult["claimsToRecheck"]> {
  const olderVersions = await db.query.sourceVersions.findMany({
    where: and(eq(sourceVersions.sourceId, sourceId), ne(sourceVersions.id, newVersionId)),
  });
  if (olderVersions.length === 0) return [];
  const versionNoById = new Map(olderVersions.map((v) => [v.id, v.versionNo]));
  const cited = await db
    .select({
      claimId: claimEvidence.claimId,
      sourceVersionId: claimEvidence.sourceVersionId,
      anchor: claimEvidence.sectionAnchor,
      text: claims.text,
      body: sourceSections.body,
    })
    .from(claimEvidence)
    .innerJoin(claims, eq(claims.id, claimEvidence.claimId))
    .innerJoin(
      sourceSections,
      and(
        eq(sourceSections.sourceVersionId, claimEvidence.sourceVersionId),
        eq(sourceSections.anchor, claimEvidence.sectionAnchor),
      ),
    )
    .where(and(inArray(claimEvidence.sourceVersionId, [...versionNoById.keys()]), evidenceInDuo(duoId)));

  // Only each Claim's latest citation of this Source counts: one re-checked on v2 isn't flagged by v1
  const latestByClaim = new Map<string, number>();
  for (const row of cited) {
    const no = versionNoById.get(row.sourceVersionId!)!;
    latestByClaim.set(row.claimId, Math.max(latestByClaim.get(row.claimId) ?? 0, no));
  }
  const newBodyByAnchor = new Map(newSections.map((s) => [s.anchor, s.body]));
  const result: SourceVersionResult["claimsToRecheck"] = [];
  for (const row of cited) {
    if (versionNoById.get(row.sourceVersionId!) !== latestByClaim.get(row.claimId)) continue;
    const now = newBodyByAnchor.get(row.anchor!);
    if (now === row.body) continue;
    result.push({
      claimId: row.claimId,
      text: row.text,
      cited: { versionNo: versionNoById.get(row.sourceVersionId!)!, section: row.anchor! },
      change: now === undefined ? "removed" : "changed",
    });
  }
  return result;
}

/** Stores one image of a Source version on disk; uploading the same name again replaces it. */
export async function addSourceImage(
  db: AppDb,
  playerId: string,
  input: { sourceVersionId: string; name: string; mimeType: string; base64: string },
): Promise<{ imageId: string; name: string; byteSize: number; referencedInMarkdown: boolean }> {
  const version = await db.query.sourceVersions.findFirst({
    where: eq(sourceVersions.id, input.sourceVersionId),
  });
  if (!version) throw new DomainError("NOT_FOUND", "Source version not found", 404);
  await assertPlayerInDuo(db, playerId, version.duoId);

  const name = input.name.trim();
  if (!name || name.length > 200) {
    throw new DomainError("INVALID_IMAGE", "name must be 1-200 characters", 400);
  }
  const { bytes, ext } = decodeSourceImage(input.mimeType, input.base64);

  const existing = await db.query.sourceImages.findFirst({
    where: and(eq(sourceImages.sourceVersionId, version.id), eq(sourceImages.name, name)),
  });
  const imageId = existing?.id ?? uuidv7();
  const storageKey = `${version.duoId}/${imageId}.${ext}`;
  const filePath = storagePath(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, filePath);

  const row = {
    mimeType: input.mimeType.trim().toLowerCase(),
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storageKey,
  };
  if (existing) {
    await db.update(sourceImages).set(row).where(eq(sourceImages.id, imageId));
  } else {
    await db.insert(sourceImages).values({
      id: imageId,
      sourceVersionId: version.id,
      duoId: version.duoId,
      name,
      ...row,
    });
  }
  return {
    imageId,
    name,
    byteSize: bytes.length,
    referencedInMarkdown: referencedImageNames(version.markdown).includes(name),
  };
}

/** A stored Source image, only for a Player of the Duo that owns it. */
export async function readSourceImageForPlayer(
  db: AppDb,
  playerId: string,
  imageId: string,
): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
  // The image, its version and the version's Source must share one Duo (X6).
  const [image] = await db
    .select()
    .from(sourceImages)
    .where(
      and(
        eq(sourceImages.id, imageId),
        sql`exists (select 1 from ${sourceVersions} v join ${sources} so on so.id = v.source_id
          where v.id = ${sourceImages.sourceVersionId} and v.duo_id = ${sourceImages.duoId}
            and so.duo_id = ${sourceImages.duoId})`,
      ),
    )
    .limit(1);
  if (!image) throw new DomainError("NOT_FOUND", "Image not found", 404);
  try {
    await assertPlayerInDuo(db, playerId, image.duoId);
  } catch (err) {
    // Don't confirm to outsiders that the image exists
    if (err instanceof DomainError) throw new DomainError("NOT_FOUND", "Image not found", 404);
    throw err;
  }
  const bytes = await readFile(storagePath(image.storageKey));
  return { bytes, mimeType: image.mimeType, sha256: image.sha256 };
}

export interface DocumentationCitation {
  sourceVersionId: string;
  section: string;
  images: string[];
}

/**
 * Checks Documentation Evidence against a Duo's Sources: the version must be
 * the Duo's, the section must exist in it, and named images must be uploaded.
 * Returns the image ids to show with the Claim, or the problem.
 */
export async function resolveDocumentationCitation(
  db: AppDb,
  duoId: string,
  citation: DocumentationCitation,
): Promise<{ imageIds: string[] } | { error: string }> {
  const version = await db.query.sourceVersions.findFirst({
    where: eq(sourceVersions.id, citation.sourceVersionId),
  });
  if (!version || version.duoId !== duoId) {
    return { error: `Unknown or other Duo's sourceVersionId: ${citation.sourceVersionId}` };
  }
  const section = await db.query.sourceSections.findFirst({
    where: and(
      eq(sourceSections.sourceVersionId, version.id),
      eq(sourceSections.anchor, citation.section),
    ),
  });
  if (!section) {
    return {
      error: `Section "${citation.section}" isn't in version ${version.versionNo} of that Source; use an anchor add_source returned`,
    };
  }
  if (citation.images.length === 0) return { imageIds: [] };
  const images = await db.query.sourceImages.findMany({
    where: and(
      eq(sourceImages.sourceVersionId, version.id),
      inArray(sourceImages.name, citation.images),
    ),
  });
  const missing = citation.images.filter((n) => !images.some((img) => img.name === n));
  if (missing.length > 0) {
    return {
      error: `Images not uploaded to that Source version: ${missing.join(", ")}; call add_source_image first`,
    };
  }
  return { imageIds: images.map((img) => img.id) };
}

export interface SourceSummary {
  id: string;
  title: string;
  url: string | null;
  kind: SourceKind;
  createdAt: Date;
  versions: Array<{ id: string; versionNo: number; createdAt: Date; sectionCount: number; imageCount: number }>;
}

/** A Duo's Sources with their versions, newest version last. */
export async function listSources(db: AppDb, duoId: string): Promise<SourceSummary[]> {
  const [rows, versions] = await Promise.all([
    db.query.sources.findMany({ where: eq(sources.duoId, duoId), orderBy: [asc(sources.createdAt)] }),
    db
      .select({
        id: sourceVersions.id,
        sourceId: sourceVersions.sourceId,
        versionNo: sourceVersions.versionNo,
        createdAt: sourceVersions.createdAt,
      })
      .from(sourceVersions)
      .where(sourceVersionInDuo(duoId))
      .orderBy(asc(sourceVersions.versionNo)),
  ]);
  if (rows.length === 0) return [];
  const versionIds = versions.map((v) => v.id);
  const [sectionRows, imageRows] = await Promise.all([
    db
      .select({ versionId: sourceSections.sourceVersionId })
      .from(sourceSections)
      .where(inArray(sourceSections.sourceVersionId, versionIds)),
    db
      .select({ versionId: sourceImages.sourceVersionId })
      .from(sourceImages)
      .where(and(inArray(sourceImages.sourceVersionId, versionIds), sourceImageInDuo(duoId))),
  ]);
  const count = (list: Array<{ versionId: string }>) => {
    const m = new Map<string, number>();
    for (const r of list) m.set(r.versionId, (m.get(r.versionId) ?? 0) + 1);
    return m;
  };
  const sectionCounts = count(sectionRows);
  const imageCounts = count(imageRows);
  return rows.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    kind: s.kind,
    createdAt: s.createdAt,
    versions: versions
      .filter((v) => v.sourceId === s.id)
      .map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        createdAt: v.createdAt,
        sectionCount: sectionCounts.get(v.id) ?? 0,
        imageCount: imageCounts.get(v.id) ?? 0,
      })),
  }));
}

export interface CitedSection {
  sourceVersionId: string;
  anchor: string;
  heading: string;
  versionNo: number;
  sourceId: string;
  title: string;
}

/** Every Source section a Duo's Documentation Evidence cites, with its Source's title and version. */
export async function listCitedSections(db: AppDb, duoId: string): Promise<CitedSection[]> {
  const rows = await db
    .selectDistinct({
      sourceVersionId: sourceSections.sourceVersionId,
      anchor: sourceSections.anchor,
      heading: sourceSections.heading,
      versionNo: sourceVersions.versionNo,
      sourceId: sources.id,
      title: sources.title,
    })
    .from(claimEvidence)
    .innerJoin(
      sourceSections,
      and(
        eq(sourceSections.sourceVersionId, claimEvidence.sourceVersionId),
        eq(sourceSections.anchor, claimEvidence.sectionAnchor),
      ),
    )
    .innerJoin(sourceVersions, eq(sourceVersions.id, sourceSections.sourceVersionId))
    .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
    .where(
      and(
        evidenceInDuo(duoId),
        eq(claimEvidence.kind, "documentation"),
        eq(sources.duoId, duoId),
        eq(sourceVersions.duoId, duoId),
      ),
    );
  return rows;
}
