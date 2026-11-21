import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_API_VERSION, uuidv7, type DuoSseEvent } from "@geo-coach/shared";
import { createTestDb, type TestDbHandle } from "../db/test-db.js";
import { duos, duoMemberships, players } from "../db/schema.js";
import {
  createAuthSession,
  isDevLoginEnabled,
  issueApiToken,
  revokeApiToken,
  verifyApiToken,
  verifyAuthSession,
} from "../auth/index.js";
import { duoEventBus } from "../events/bus.js";
import { handleCompanionRequest } from "../companion-api/handler.js";

describe("Seam 3: Scoped auth, Companion API compatibility, and per-Duo SSE", () => {
  let handle: TestDbHandle;
  let duoId: string;
  let mikoId: string;

  beforeEach(async () => {
    handle = await createTestDb();
    duoId = uuidv7();
    mikoId = uuidv7();
    await handle.db.insert(duos).values({
      id: duoId,
      name: "Road to Champ",
      geoguessrTeamId: "gg_team_duo",
      hotwords: ["Plovdiv", "Bollards"],
    });
    await handle.db.insert(players).values({
      id: mikoId,
      discordId: "discord_miko",
      displayName: "Miko",
      geoguessrUserId: "gg_p1",
      geoguessrName: "MikoGeo",
    });
    await handle.db.insert(duoMemberships).values({ duoId, playerId: mikoId });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("isolates companion and mcp bearer token scopes and enforces revocation/expiry", async () => {
    const comp = await issueApiToken(handle.db, mikoId, "companion", "My PC", 30);
    const mcp = await issueApiToken(handle.db, mikoId, "mcp", "Claude Desktop", 30);

    expect((await verifyApiToken(handle.db, comp.rawToken, "companion"))?.player.id).toBe(mikoId);
    expect(await verifyApiToken(handle.db, comp.rawToken, "mcp")).toBeNull();
    expect((await verifyApiToken(handle.db, mcp.rawToken, "mcp"))?.player.id).toBe(mikoId);
    expect(await verifyApiToken(handle.db, mcp.rawToken, "companion")).toBeNull();

    await revokeApiToken(handle.db, mikoId, comp.id);
    expect(await verifyApiToken(handle.db, comp.rawToken, "companion")).toBeNull();

    // Expired token
    const expired = await issueApiToken(handle.db, mikoId, "mcp", "Old", -1);
    expect(await verifyApiToken(handle.db, expired.rawToken, "mcp")).toBeNull();
  });

  it("creates/verifies DB auth sessions and fails closed for dev login outside development", async () => {
    const { rawSessionToken } = await createAuthSession(handle.db, mikoId);
    const verified = await verifyAuthSession(handle.db, rawSessionToken);
    expect(verified?.player.id).toBe(mikoId);

    expect(isDevLoginEnabled("development")).toBe(true);
    expect(isDevLoginEnabled("production")).toBe(false);
    expect(isDevLoginEnabled(undefined)).toBe(false);
  });

  it("rejects unsupported API versions with 426 and handles Companion lifecycle with SSE broadcasts", async () => {
    const comp = await issueApiToken(handle.db, mikoId, "companion", "PC", 30);
    const events: DuoSseEvent[] = [];
    const unsub = duoEventBus.subscribe(duoId, (e) => events.push(e));

    try {
      // Unsupported API version -> 426 Upgrade Required
      const tooOld = await handleCompanionRequest(
        handle.db,
        new Request("http://localhost/api/companion/bootstrap", {
          headers: {
            Authorization: `Bearer ${comp.rawToken}`,
            "X-GeoCoach-Api-Version": "99",
          },
        }),
        "bootstrap",
      );
      expect(tooOld.status).toBe(426);

      // Bootstrap returns Duo list + hotwords + serverTimeMs
      const bootRes = await handleCompanionRequest(
        handle.db,
        new Request("http://localhost/api/companion/bootstrap", {
          headers: {
            Authorization: `Bearer ${comp.rawToken}`,
            "X-GeoCoach-Api-Version": String(CURRENT_API_VERSION),
          },
        }),
        "bootstrap",
      );
      expect(bootRes.status).toBe(200);
      const bootJson = await bootRes.json();
      expect(bootJson.duos).toHaveLength(1);
      expect(bootJson.duos[0].hotwords).toEqual(["Plovdiv", "Bollards"]);

      // Heartbeat broadcasts live status on per-Duo SSE bus
      const hbRes = await handleCompanionRequest(
        handle.db,
        new Request("http://localhost/api/companion/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${comp.rawToken}`,
            "X-GeoCoach-Api-Version": String(CURRENT_API_VERSION),
          },
          body: JSON.stringify({
            duoId,
            recordingId: null,
            recording: true,
            uploadOk: true,
            pendingChunks: 0,
            transcriptionLagSec: 1.2,
            companionVersion: "0.1.0",
            geoguessrAuthOk: true,
          }),
        }),
        "heartbeat",
      );
      expect(hbRes.status).toBe(200);
      expect(events.some((e) => e.type === "heartbeat" && e.recording === true)).toBe(true);
    } finally {
      unsub();
    }
  });
});
