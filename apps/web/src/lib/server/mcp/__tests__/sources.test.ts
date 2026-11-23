import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, players } from "../../db/schema.js";
import {
  MAX_SOURCE_IMAGE_BYTES,
  deriveClaims,
  listSources,
  readSourceImageForPlayer,
  splitMarkdownSections,
} from "../../services/index.js";
import {
  mcpAddClaims,
  mcpAddSource,
  mcpAddSourceImage,
  mcpGetInstructions,
  mcpListSources,
} from "../workflow.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_STUB = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");

const BULGARIA_V1 = `Bulgaria is in south-east Europe.

# Bulgaria

## Bollards
Bulgarian bollards have a yellow top with a red reflector.

![Yellow-top bollard](bg-bollard.png)

## Coverage
Bulgaria has Gen 3 and Gen 4 coverage.

![Gen 4 car](bg-car.jpg) and [a link](https://example.com/page.png)

\`\`\`
# not a heading
\`\`\`

## Coverage
A second coverage note.
`;

describe("knowledge bank: Sources and ingestion (#47)", () => {
  let handle: TestDbHandle;
  let imagesDir: string;
  let duoId: string;
  let otherDuoId: string;
  let mikoId: string;
  let outsiderId: string;

  beforeEach(async () => {
    imagesDir = await mkdtemp(path.join(tmpdir(), "geo-coach-images-"));
    process.env.SOURCE_IMAGES_DIR = imagesDir;
    handle = await createTestDb();
    duoId = uuidv7();
    otherDuoId = uuidv7();
    mikoId = uuidv7();
    outsiderId = uuidv7();
    await handle.db.insert(duos).values([
      { id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" },
      { id: otherDuoId, name: "Other Duo", geoguessrTeamId: "gg_team_other" },
    ]);
    await handle.db.insert(players).values([
      { id: mikoId, discordId: "d_miko", displayName: "Miko" },
      { id: outsiderId, discordId: "d_out", displayName: "Outsider" },
    ]);
    await handle.db.insert(duoMemberships).values([
      { duoId, playerId: mikoId },
      { duoId: otherDuoId, playerId: outsiderId },
    ]);
  });

  afterEach(async () => {
    await handle.close();
    await rm(imagesDir, { recursive: true, force: true });
    delete process.env.SOURCE_IMAGES_DIR;
  });

  it("serves the ingest-v2 instructions", async () => {
    const res = await mcpGetInstructions("ingest");
    expect(res.promptVersion).toBe("ingest-v2");
    expect(res.instructions).toContain("list_sources");
    expect(res.instructions).toContain("add_source_image");
  });

  it("splits markdown into stable, addressable sections", () => {
    const sections = splitMarkdownSections(BULGARIA_V1);
    expect(sections.map((s) => s.anchor)).toEqual(["intro", "bulgaria", "bollards", "coverage", "coverage-2"]);
    expect(sections[2]!.body).toContain("yellow top");
    // A heading inside fenced code stays in its section's body
    expect(sections[3]!.body).toContain("# not a heading");
    expect(splitMarkdownSections("## Bollards & Poles\nx")[0]!.anchor).toBe("bollards-poles");
    expect(splitMarkdownSections("## Ålesund çà\nx")[0]!.anchor).toBe("alesund-ca");
  });

  it("ingests a document with two images and backs Claims with Documentation Evidence, end to end", async () => {
    const v1 = await mcpAddSource(handle.db, mikoId, {
      title: "Plonkit: Bulgaria",
      url: "https://www.plonkit.net/bulgaria",
      kind: "web",
      markdown: BULGARIA_V1,
    });
    expect(v1.versionNo).toBe(1);
    expect(v1.imagesToUpload).toEqual(["bg-bollard.png", "bg-car.jpg"]);
    expect(v1.claimsToRecheck).toEqual([]);

    const png = await mcpAddSourceImage(handle.db, mikoId, {
      sourceVersionId: v1.sourceVersionId,
      name: "bg-bollard.png",
      mimeType: "image/png",
      base64: PNG_1PX,
    });
    expect(png.referencedInMarkdown).toBe(true);
    await mcpAddSourceImage(handle.db, mikoId, {
      sourceVersionId: v1.sourceVersionId,
      name: "bg-car.jpg",
      mimeType: "image/jpeg",
      base64: JPEG_STUB,
    });

    const res = await mcpAddClaims(handle.db, mikoId, {
      items: [
        {
          text: "Bulgarian bollards have a yellow top with a red reflector.",
          countries: ["BG"],
          topics: ["bollards"],
          evidence: [
            { kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "bollards", images: ["bg-bollard.png"] },
          ],
        },
        {
          text: "Bulgaria has truck coverage.",
          countries: ["BG"],
          evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "coverage", direction: "against" }],
        },
        {
          text: "Missing section",
          countries: ["BG"],
          evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "plates" }],
        },
        {
          text: "Missing image",
          countries: ["BG"],
          evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "bollards", images: ["nope.png"] }],
        },
        {
          text: "Round without a run",
          countries: ["BG"],
          evidence: [{ kind: "round", roundId: uuidv7() }],
        },
      ],
    });
    expect(res.savedCount).toBe(2);
    expect(res.errors.map((e) => e.index)).toEqual([2, 3, 4]);
    expect(res.errors[0]!.message).toMatch(/Section "plates" isn't in version 1/);
    expect(res.errors[1]!.message).toMatch(/call add_source_image first/);

    const claims = await deriveClaims(handle.db, duoId);
    const bollards = claims.find((c) => c.text.startsWith("Bulgarian bollards"))!;
    expect(bollards.status).toBe("verified");
    expect(bollards.runId).toBeNull();
    expect(bollards.imageIds).toEqual([png.imageId]);
    expect(bollards.evidence).toMatchObject([
      { kind: "documentation", direction: "for", sourceVersionId: v1.sourceVersionId, sectionAnchor: "bollards" },
    ]);
    expect(claims.find((c) => c.text.includes("truck"))!.status).toBe("disproved");

    // Another Duo can't cite this Source
    const foreign = await mcpAddClaims(handle.db, outsiderId, {
      items: [{ text: "x", evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "bollards" }] }],
    });
    expect(foreign.errors[0]!.message).toMatch(/other Duo's sourceVersionId/);
  });

  it("re-ingests as version 2, flags Claims on changed sections, and keeps version 1 Evidence resolving", async () => {
    const v1 = await mcpAddSource(handle.db, mikoId, { title: "Plonkit: Bulgaria", kind: "web", markdown: BULGARIA_V1 });
    const { saved } = await mcpAddClaims(handle.db, mikoId, {
      items: [
        { text: "Bulgarian bollards have yellow tops.", countries: ["BG"], evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "bollards" }] },
        { text: "Bulgaria has Gen 3 coverage.", countries: ["BG"], evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "coverage" }] },
      ],
    });

    const v2Markdown = BULGARIA_V1.replace("Gen 3 and Gen 4", "Gen 4 only");
    const v2 = await mcpAddSource(handle.db, mikoId, {
      sourceId: v1.sourceId,
      title: "Plonkit: Bulgaria (2026)",
      kind: "web",
      markdown: v2Markdown,
    });
    expect(v2.sourceId).toBe(v1.sourceId);
    expect(v2.versionNo).toBe(2);
    expect(v2.claimsToRecheck).toEqual([
      { claimId: saved[1]!.claimId, text: "Bulgaria has Gen 3 coverage.", cited: { versionNo: 1, section: "coverage" }, change: "changed" },
    ]);

    // Version 1 Evidence still points at version 1, whose section is still stored
    const coverage = (await deriveClaims(handle.db, duoId)).find((c) => c.id === saved[1]!.claimId)!;
    expect(coverage.evidence[0]!.sourceVersionId).toBe(v1.sourceVersionId);
    expect(coverage.status).toBe("verified");
    const recite = await mcpAddClaims(handle.db, mikoId, {
      items: [{ claimId: coverage.id, evidence: [{ kind: "documentation", sourceVersionId: v1.sourceVersionId, section: "coverage" }] }],
    });
    expect(recite.saved[0]!.evidenceAdded).toBe(0);

    // Once re-checked against version 2, a third version with the same section flags nothing
    await mcpAddClaims(handle.db, mikoId, {
      items: [{ claimId: coverage.id, evidence: [{ kind: "documentation", sourceVersionId: v2.sourceVersionId, section: "coverage", direction: "against" }] }],
    });
    const v3 = await mcpAddSource(handle.db, mikoId, { sourceId: v1.sourceId, title: "Plonkit: Bulgaria", kind: "web", markdown: v2Markdown });
    expect(v3.claimsToRecheck).toEqual([]);

    // list_sources finds it by title or URL so an agent can pass its id as sourceId
    const listed = await mcpListSources(handle.db, mikoId, { query: "plonkit: bulgaria" });
    expect(listed.sources.map((x) => x.id)).toEqual([v1.sourceId]);
    expect(listed.sources[0]!.versions.map((x) => [x.versionNo, x.sourceVersionId])).toEqual([
      [1, v1.sourceVersionId],
      [2, v2.sourceVersionId],
      [3, v3.sourceVersionId],
    ]);
    expect((await mcpListSources(handle.db, mikoId, { query: "nope" })).total).toBe(0);
    expect((await mcpListSources(handle.db, outsiderId, {})).total).toBe(0);

    const [source] = await listSources(handle.db, duoId);
    expect(source!.title).toBe("Plonkit: Bulgaria");
    expect(source!.versions.map((v) => v.versionNo)).toEqual([1, 2, 3]);
    expect(source!.versions[0]!.sectionCount).toBe(5);
  });

  it("rejects oversized and non-image uploads with a clear error", async () => {
    const { sourceVersionId } = await mcpAddSource(handle.db, mikoId, { title: "Guide", kind: "pdf", markdown: "# Guide\nx" });
    const upload = (mimeType: string, base64: string) =>
      mcpAddSourceImage(handle.db, mikoId, { sourceVersionId, name: "img", mimeType, base64 });

    await expect(upload("text/plain", Buffer.from("hello").toString("base64"))).rejects.toThrow(/Unsupported image type "text\/plain"/);
    await expect(upload("image/svg+xml", Buffer.from("<svg/>").toString("base64"))).rejects.toThrow(/Unsupported image type/);
    await expect(upload("image/png", Buffer.from("<html>not a png</html>").toString("base64"))).rejects.toThrow(/not a valid image\/png file/);
    await expect(upload("image/png", JPEG_STUB)).rejects.toThrow(/not a valid image\/png file/);
    await expect(upload("image/png", "not base64!!")).rejects.toThrow(/not valid base64/);
    const big = Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1024);
    Buffer.from(PNG_1PX, "base64").copy(big);
    await expect(upload("image/png", big.toString("base64"))).rejects.toThrow(/the limit is 2048 KiB/);
    // Outsiders can't upload to this Duo's Source
    await expect(
      mcpAddSourceImage(handle.db, outsiderId, { sourceVersionId, name: "img", mimeType: "image/png", base64: PNG_1PX }),
    ).rejects.toThrow();
  });

  it("serves images only to Players of the owning Duo", async () => {
    const { sourceVersionId } = await mcpAddSource(handle.db, mikoId, { title: "Guide", kind: "other", markdown: "# Guide\n![x](a.png)" });
    const { imageId } = await mcpAddSourceImage(handle.db, mikoId, {
      sourceVersionId,
      name: "a.png",
      mimeType: "image/png",
      base64: PNG_1PX,
    });

    const image = await readSourceImageForPlayer(handle.db, mikoId, imageId);
    expect(image.mimeType).toBe("image/png");
    expect(image.bytes.equals(Buffer.from(PNG_1PX, "base64"))).toBe(true);
    await expect(readSourceImageForPlayer(handle.db, outsiderId, imageId)).rejects.toThrow(/Image not found/);
    await expect(readSourceImageForPlayer(handle.db, mikoId, uuidv7())).rejects.toThrow(/Image not found/);
  });
});
