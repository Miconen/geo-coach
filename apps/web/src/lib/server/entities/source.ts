import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDb } from "../db/index.js";
import { sourceImages, sourceSections, sources, sourceVersions } from "../db/schema.js";
import type { SourceKind } from "@geo-coach/shared";
import { links } from "../../links.js";
import { parseExcerpt, type ExcerptBlock } from "../../source-excerpt.js";

/**
 * The Source route (#56 3a, X6): the Source and its version must both be this Duo's (version Duo id checked, not
 * only the parent's). ?v= missing means the current version; ?section= picks one excerpt, else the section list.
 */
export interface SourceView {
  source: { id: string; title: string; url: string | null; kind: SourceKind };
  version: { versionNo: number; createdAt: string; current: boolean };
  latestVersionNo: number;
  sections: Array<{ anchor: string; heading: string; level: number }>;
  excerpt: { anchor: string; heading: string; blocks: ExcerptBlock[] } | null;
  /** A ?section= was given but names no section of this version. */
  sectionMissing: boolean;
}

export async function loadSourceView(
  db: AppDb,
  duoId: string,
  sourceId: string,
  versionNo: number | null,
  section: string | null,
): Promise<SourceView | null> {
  const [source] = await db
    .select({ id: sources.id, title: sources.title, url: sources.url, kind: sources.kind })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.duoId, duoId)))
    .limit(1);
  if (!source) return null;
  const versions = await db
    .select({ id: sourceVersions.id, versionNo: sourceVersions.versionNo, createdAt: sourceVersions.createdAt })
    .from(sourceVersions)
    .where(and(eq(sourceVersions.sourceId, sourceId), eq(sourceVersions.duoId, duoId)))
    .orderBy(desc(sourceVersions.versionNo));
  const version = versionNo === null ? versions[0] : versions.find((v) => v.versionNo === versionNo);
  if (!version) return null;

  const sections = await db
    .select({ anchor: sourceSections.anchor, heading: sourceSections.heading, level: sourceSections.level, body: sourceSections.body })
    .from(sourceSections)
    .where(eq(sourceSections.sourceVersionId, version.id))
    .orderBy(asc(sourceSections.ordinal));
  const picked = section === null ? undefined : sections.find((s) => s.anchor === section);
  let excerpt: SourceView["excerpt"] = null;
  if (picked) {
    const images = await db
      .select({ id: sourceImages.id, name: sourceImages.name })
      .from(sourceImages)
      .where(and(eq(sourceImages.sourceVersionId, version.id), eq(sourceImages.duoId, duoId)));
    const byName = new Map(images.map((i) => [i.name, i.id]));
    excerpt = {
      anchor: picked.anchor,
      heading: picked.heading,
      blocks: parseExcerpt(picked.body, (name) => {
        const id = byName.get(name);
        return id ? links.sourceImage(id) : null;
      }),
    };
  }
  return {
    source,
    version: { versionNo: version.versionNo, createdAt: version.createdAt.toISOString(), current: version.id === versions[0]!.id },
    latestVersionNo: versions[0]!.versionNo,
    sections: sections.map(({ anchor, heading, level }) => ({ anchor, heading, level })),
    excerpt,
    sectionMissing: section !== null && !picked,
  };
}
