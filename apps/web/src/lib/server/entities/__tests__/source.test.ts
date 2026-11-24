import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { sourceImages, sourceSections, sources, sourceVersions } from "../../db/schema.js";
import { seedSessionFixture, type SessionFixture } from "../../workbench/__tests__/session-fixture.js";
import { loadSourceView } from "../index.js";
import { parseExcerpt } from "../../../source-excerpt.js";

// #56 3a: the Source route's X6 checks (Source and version Duo ids) and excerpt rendering.

describe("parseExcerpt", () => {
  const resolve = (name: string) => (name === "bollard.png" ? "/img/1" : null);

  it("keeps paragraphs and fenced code only, as plain text", () => {
    const blocks = parseExcerpt("First line\nsecond <b>line</b>\n\n```\ncode **here**\n```\n- a list item", resolve);
    expect(blocks).toEqual([
      { kind: "p", parts: [{ text: "First line\nsecond <b>line</b>" }] },
      { kind: "code", text: "code **here**" },
      { kind: "p", parts: [{ text: "- a list item" }] },
    ]);
  });

  it("resolves image names through the caller; unresolved names and URLs render as alt text", () => {
    const [p] = parseExcerpt('See ![A bollard](bollard.png "Spain") and ![Gone](missing.png) and ![Remote](https://x/y.png)', resolve);
    expect(p).toEqual({
      kind: "p",
      parts: [
        { text: "See " },
        { img: { src: "/img/1", alt: "A bollard", title: "Spain" } },
        { text: " and " },
        { text: "Gone" },
        { text: " and " },
        { text: "Remote" },
      ],
    });
    expect(parseExcerpt("![Angle](<bollard.png>)", resolve)[0]).toEqual({ kind: "p", parts: [{ img: { src: "/img/1", alt: "Angle", title: null } }] });
  });
});

describe("loadSourceView", () => {
  let handle: TestDbHandle;
  let a: SessionFixture;
  let b: SessionFixture;
  let sourceId: string;
  let v1: string;
  let v2: string;

  beforeEach(async () => {
    handle = await createTestDb();
    a = await seedSessionFixture(handle);
    b = await seedSessionFixture(handle, { tag: "other", teamId: "team_other" });
    sourceId = uuidv7();
    v1 = uuidv7();
    v2 = uuidv7();
    await handle.db.insert(sources).values({ id: sourceId, duoId: a.duoId, title: "Plonkit Spain", kind: "web" });
    await handle.db.insert(sourceVersions).values([
      { id: v1, sourceId, duoId: a.duoId, versionNo: 1, markdown: "# Bollards\nOld" },
      { id: v2, sourceId, duoId: a.duoId, versionNo: 2, markdown: "# Bollards\nNew ![B](b.png)" },
    ]);
    await handle.db.insert(sourceSections).values([
      { sourceVersionId: v1, anchor: "bollards", ordinal: 0, heading: "Bollards", level: 1, body: "Old" },
      { sourceVersionId: v2, anchor: "bollards", ordinal: 0, heading: "Bollards", level: 1, body: "New ![B](b.png) ![F](f.png)" },
    ]);
    const img = { mimeType: "image/png", byteSize: 1, sha256: "x", storageKey: "k" };
    await handle.db.insert(sourceImages).values([
      { id: uuidv7(), sourceVersionId: v2, duoId: a.duoId, name: "b.png", ...img },
      // Same version, another Duo's row: never resolved.
      { id: uuidv7(), sourceVersionId: v2, duoId: b.duoId, name: "f.png", ...img },
    ]);
  });
  afterEach(async () => {
    await handle.close();
  });

  it("defaults to the current version and renders one excerpt with Duo-scoped images", async () => {
    const view = (await loadSourceView(handle.db, a.duoId, sourceId, null, "bollards"))!;
    expect(view.version).toMatchObject({ versionNo: 2, current: true });
    expect(view.excerpt!.blocks).toEqual([
      { kind: "p", parts: [{ text: "New " }, { img: { src: expect.stringMatching(/^\/api\/sources\/images\/.+\?r=2$/), alt: "B", title: null } }, { text: " " }, { text: "F" }] },
    ]);
    const old = (await loadSourceView(handle.db, a.duoId, sourceId, 1, "bollards"))!;
    expect(old.version).toMatchObject({ versionNo: 1, current: false });
    expect(old.latestVersionNo).toBe(2);
  });

  it("an unknown or missing section shows the list; an unknown version is null", async () => {
    expect(await loadSourceView(handle.db, a.duoId, sourceId, null, null)).toMatchObject({ excerpt: null, sectionMissing: false });
    expect(await loadSourceView(handle.db, a.duoId, sourceId, null, "nope")).toMatchObject({ excerpt: null, sectionMissing: true });
    expect(await loadSourceView(handle.db, a.duoId, sourceId, 3, null)).toBeNull();
  });

  it("X6: another Duo's Source, or a version stored under another Duo, is never shown", async () => {
    expect(await loadSourceView(handle.db, b.duoId, sourceId, null, null)).toBeNull();
    const v3 = uuidv7();
    await handle.db.insert(sourceVersions).values({ id: v3, sourceId, duoId: b.duoId, versionNo: 3, markdown: "x" });
    expect(await loadSourceView(handle.db, a.duoId, sourceId, 3, null)).toBeNull();
    // The mismatched version is not the current one either.
    expect((await loadSourceView(handle.db, a.duoId, sourceId, null, null))!.version.versionNo).toBe(2);
  });
});
