import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../../db/test-db.js";
import { claimEvidence, duos, duoMemberships, players } from "../../db/schema.js";
import { deriveClaims, insertClaim, setPlayerEvidence } from "../../services/index.js";
import { mcpDeleteClaims, mcpEditClaims } from "../workflow.js";

describe("knowledge bank: editing and deleting Claims", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let otherDuoId: string;
  let mikoId: string;

  async function claim(text: string, over: { duo?: string; countries?: string[] } = {}) {
    return insertClaim(handle.db, {
      duoId: over.duo ?? duoId,
      runId: null,
      createdByPlayerId: mikoId,
      text,
      countries: over.countries ?? ["AT"],
      regions: [],
      topics: ["poles"],
    });
  }

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    otherDuoId = uuidv7();
    mikoId = uuidv7();
    await handle.db.insert(duos).values([
      { id: duoId, name: "Road to Champ", geoguessrTeamId: "gg_team_duo" },
      { id: otherDuoId, name: "Other Duo", geoguessrTeamId: "gg_team_other" },
    ]);
    await handle.db.insert(players).values([
      { id: mikoId, discordId: "d_miko", displayName: "Miko", geoguessrUserId: "gg_p1" },
    ]);
    await handle.db.insert(duoMemberships).values([{ duoId, playerId: mikoId }]);
  });

  afterEach(async () => {
    await handle.close();
  });

  describe("edit_claims", () => {
    it("changes wording, countries and topics and keeps the Evidence", async () => {
      const id = await claim("Austria has only wooden utility poles.");
      await handle.db.insert(claimEvidence).values({
        id: uuidv7(),
        claimId: id,
        duoId,
        kind: "player",
        direction: "for",
        playerId: mikoId,
      });

      // Reword a Claim a Player confirmed: needs force.
      const refused = await mcpEditClaims(handle.db, mikoId, {
        items: [{ claimId: id, text: "Austria mostly has wooden utility poles." }],
      });
      expect(refused.savedCount).toBe(0);
      expect(refused.errors[0]!.message).toMatch(/force/);

      // Topics and countries don't change what was vouched for.
      const metaOnly = await mcpEditClaims(handle.db, mikoId, {
        items: [{ claimId: id, countries: ["AT", "DE"], topics: ["Poles", "country-confusion"] }],
      });
      expect(metaOnly.saved).toEqual([{ index: 0, claimId: id, changed: ["countries", "topics"] }]);

      const forced = await mcpEditClaims(handle.db, mikoId, {
        items: [{ claimId: id, text: "Austria mostly has wooden utility poles.", force: true }],
      });
      expect(forced.saved[0]!.changed).toEqual(["text"]);

      const [c] = await deriveClaims(handle.db, duoId);
      expect(c!.text).toBe("Austria mostly has wooden utility poles.");
      expect(c!.countries).toEqual(["AT", "DE"]);
      expect(c!.topics).toEqual(["poles", "country-confusion"]);
      expect(c!.evidence).toHaveLength(1);
      expect(c!.status).toBe("verified");
    });

    it("rewords an unconfirmed Claim without force", async () => {
      const id = await claim("Greece has only wooden utility poles.", { countries: ["GR"] });
      const res = await mcpEditClaims(handle.db, mikoId, {
        items: [{ claimId: id, text: "Greece mostly has wooden utility poles." }],
      });
      expect(res.savedCount).toBe(1);
      const [c] = await deriveClaims(handle.db, duoId);
      expect(c!.text).toBe("Greece mostly has wooden utility poles.");
    });

    it("reports bad items and saves the rest", async () => {
      const good = await claim("Good claim.");
      const foreign = await claim("Someone else's claim.", { duo: otherDuoId });
      const res = await mcpEditClaims(handle.db, mikoId, {
        items: [
          { claimId: good, text: "Better claim." },
          { claimId: foreign, text: "Hijacked." },
          { claimId: uuidv7() },
          { claimId: good, regions: [{ country: "FR", name: "Bretagne" }] },
        ],
      });
      expect(res.savedCount).toBe(1);
      expect(res.errors.map((e) => e.index)).toEqual([1, 2, 3]);
      expect(res.errors[0]!.message).toMatch(/Unknown or other Duo/);
      expect(res.errors[1]!.message).toMatch(/at least one of/);
      expect(res.errors[2]!.message).toMatch(/not in countries/);
      const claims = await deriveClaims(handle.db, otherDuoId);
      expect(claims[0]!.text).toBe("Someone else's claim.");
    });
  });

  describe("delete_claims", () => {
    it("deletes unconfirmed Claims and keeps ones a Player confirmed", async () => {
      const junk = await claim("=01a2099b-c763-7449-9e16-00d04c453097");
      const confirmed = await claim("A Player confirmed this.");
      await setPlayerEvidence(handle.db, mikoId, confirmed, "for");
      const foreign = await claim("Other Duo's claim.", { duo: otherDuoId });

      const res = await mcpDeleteClaims(handle.db, mikoId, { claimIds: [junk, confirmed, foreign] });
      expect(res.deletedCount).toBe(1);
      expect(res.deleted[0]).toMatchObject({ claimId: junk, evidenceRemoved: 0 });
      expect(res.kept.map((k) => k.claimId)).toEqual([confirmed, foreign]);
      expect(res.kept[0]!.reason).toMatch(/force/);
      expect(res.kept[1]!.reason).toMatch(/Unknown or other Duo/);

      expect((await deriveClaims(handle.db, duoId)).map((c) => c.id)).toEqual([confirmed]);
      expect(await deriveClaims(handle.db, otherDuoId)).toHaveLength(1);
    });

    it("force-deletes a confirmed Claim along with its Evidence", async () => {
      const id = await claim("A Player confirmed this.");
      await setPlayerEvidence(handle.db, mikoId, id, "for");

      const res = await mcpDeleteClaims(handle.db, mikoId, { claimIds: [id], force: true });
      expect(res.deleted).toEqual([
        { claimId: id, text: "A Player confirmed this.", evidenceRemoved: 1, learningsUnlinked: 0 },
      ]);
      expect(await deriveClaims(handle.db, duoId)).toEqual([]);
      expect(await handle.db.select().from(claimEvidence).where(eq(claimEvidence.claimId, id))).toEqual([]);
    });
  });
});
