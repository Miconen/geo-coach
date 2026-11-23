import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { duos, duoMemberships, learnings, players } from "../../db/schema.js";
import {
  addSourceImage,
  addSourceVersion,
  insertClaim,
  insertEvidence,
  setPlayerEvidence,
} from "../../services/index.js";
import { buildWorkbenchData } from "../view-model.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("workbench knowledge bank view (#48)", () => {
  let handle: TestDbHandle;
  let imagesDir: string;
  let duoId: string;
  let mikoId: string;
  let soraId: string;

  beforeEach(async () => {
    imagesDir = await mkdtemp(path.join(tmpdir(), "geo-coach-wb-images-"));
    process.env.SOURCE_IMAGES_DIR = imagesDir;
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    soraId = uuidv7();
    await handle.db.insert(duos).values({ id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" });
    await handle.db.insert(players).values([
      { id: mikoId, discordId: "d_miko", displayName: "Miko" },
      { id: soraId, discordId: "d_sora", displayName: "Sora" },
    ]);
    await handle.db.insert(duoMemberships).values([
      { duoId, playerId: mikoId },
      { duoId, playerId: soraId },
    ]);
  });

  afterEach(async () => {
    await handle.close();
    await rm(imagesDir, { recursive: true, force: true });
    delete process.env.SOURCE_IMAGES_DIR;
  });

  it("shows Claims with derived status, resolved Evidence, linked Learnings and Sources", async () => {
    const source = await addSourceVersion(handle.db, mikoId, {
      duoId,
      title: "Plonkit: Bulgaria",
      url: "https://www.plonkit.net/bulgaria",
      kind: "web",
      markdown: "# Bulgaria\n## Bollards\nYellow tops.\n![b](b.png)",
    });
    const image = await addSourceImage(handle.db, mikoId, {
      sourceVersionId: source.sourceVersionId,
      name: "b.png",
      mimeType: "image/png",
      base64: PNG_1PX,
    });
    const bollards = await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Bulgarian bollards have yellow tops.",
      countries: ["BG"],
      regions: [],
      topics: ["bollards"],
    });
    await insertEvidence(handle.db, bollards, duoId, null, [
      {
        kind: "documentation",
        direction: "for",
        sourceVersionId: source.sourceVersionId,
        sectionAnchor: "bollards",
        imageIds: [image.imageId],
      },
    ]);
    const truck = await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Bulgaria might have truck coverage.",
      countries: ["BG"],
      regions: [],
      topics: ["coverage"],
    });
    const learningId = uuidv7();
    await handle.db.insert(learnings).values({
      id: learningId,
      duoId,
      authorPlayerId: mikoId,
      kind: "clue",
      origin: "manual",
      text: "Yellow-top bollards point to Bulgaria.",
      countries: ["BG"],
      claimId: bollards,
    });

    const wb = await buildWorkbenchData(handle.db, duoId, mikoId);
    const bollardsView = wb.claimsById[bollards]!;
    expect(bollardsView.status).toBe("verified");
    expect(bollardsView.evidence[0]!.source).toEqual({
      sourceId: source.sourceId,
      title: "Plonkit: Bulgaria",
      versionNo: 1,
      anchor: "bollards",
      heading: "Bollards",
    });
    expect(bollardsView.imageUrls).toEqual([`/api/sources/images/${image.imageId}`]);
    expect(bollardsView.learningIds).toEqual([learningId]);
    expect(wb.claimsById[truck]!.status).toBe("speculated");
    expect(wb.learnings.find((l) => l.id === learningId)!.claimId).toBe(bollards);
    expect(wb.countryDossiers.find((d) => d.code === "BG")!.claimCount).toBe(2);
    expect(wb.sources).toMatchObject([
      { id: source.sourceId, title: "Plonkit: Bulgaria", latestVersionNo: 1, sectionCount: 2, imageCount: 1 },
    ]);
  });

  it("updates status for both Players when either adds or withdraws their ✓/✗", async () => {
    const claimId = await insertClaim(handle.db, {
      duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text: "Bulgaria might have truck coverage.",
      countries: ["BG"],
      regions: [],
      topics: [],
    });
    const view = async (viewer: string) => (await buildWorkbenchData(handle.db, duoId, viewer)).claimsById[claimId]!;

    await setPlayerEvidence(handle.db, mikoId, claimId, "for");
    expect((await view(mikoId)).viewerDirection).toBe("for");
    expect((await view(soraId)).viewerDirection).toBeNull();
    expect((await view(soraId)).status).toBe("verified");

    await setPlayerEvidence(handle.db, soraId, claimId, "against");
    expect((await view(mikoId)).status).toBe("disputed");
    expect((await view(soraId)).viewerDirection).toBe("against");

    // Sora withdrawing leaves Miko's ✓ in place
    await setPlayerEvidence(handle.db, soraId, claimId, null);
    const after = await view(mikoId);
    expect(after.status).toBe("verified");
    expect(after.evidence).toMatchObject([{ kind: "player", playerId: mikoId, direction: "for" }]);
  });
});
