import { describe, expect, it } from "vitest";
import { DUO_SECTIONS, duoSection } from "../duo-sections.js";

describe("Duo top nav (#75)", () => {
  it("reads Home · Sessions · Games · Review · Knowledge · Stats", () => {
    expect(DUO_SECTIONS.map((s) => s.label)).toEqual(["Home", "Sessions", "Games", "Review", "Knowledge", "Stats"]);
  });

  it.each([
    ["/duos/[duoId=uuid]", "home"],
    ["/duos/[duoId=uuid]/sessions", "sessions"],
    ["/duos/[duoId=uuid]/sessions/[sessionId=uuid]", "sessions"],
    ["/duos/[duoId=uuid]/games", "games"],
    ["/duos/[duoId=uuid]/games/[gameId=uuid]", "games"],
    ["/duos/[duoId=uuid]/games/[gameId=uuid]/rounds/[n=roundnumber]", "games"],
    ["/duos/[duoId=uuid]/review", "review"],
    ["/duos/[duoId=uuid]/knowledge", "knowledge"],
    ["/duos/[duoId=uuid]/knowledge/sources/[sourceId=uuid]", "knowledge"],
    ["/duos/[duoId=uuid]/stats", "stats"],
  ])("%s highlights %s", (routeId, key) => {
    expect(duoSection(routeId)?.key).toBe(key);
  });

  it("highlights nothing outside the Duo or on an unknown segment", () => {
    expect(duoSection("/settings")).toBeNull();
    expect(duoSection(null)).toBeNull();
    expect(duoSection("/duos/[duoId=uuid]/homework")).toBeNull();
    expect(duoSection("/duos/[duoId=uuid]x")).toBeNull();
  });
});
