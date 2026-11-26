import { describe, expect, it } from "vitest";
import { nextViewHref, readEnumParam, readListParam, readParam, setListParam, setParam } from "../view-url.js";
import { parseAnchor, anchor } from "../anchors.js";

const U = "22222222-2222-4222-8222-222222222222";
const here = { pathname: "/duos/x/stats", search: "?from=2026-11-01&smooth=light", hash: "#map-view" };

describe("nextViewHref (#73)", () => {
  it("applies the mutation to the live query and keeps the anchor", () => {
    expect(nextViewHref(here, (p) => p.set("round", U))).toBe(`/duos/x/stats?from=2026-11-01&smooth=light&round=${U}#map-view`);
  });

  it("replaces or drops the anchor when asked", () => {
    expect(nextViewHref(here, () => {}, "round-1")).toBe("/duos/x/stats?from=2026-11-01&smooth=light#round-1");
    expect(nextViewHref(here, () => {}, "#x")).toBe("/duos/x/stats?from=2026-11-01&smooth=light#x");
    expect(nextViewHref(here, () => {}, null)).toBe("/duos/x/stats?from=2026-11-01&smooth=light");
  });

  it("drops the ? when the query empties", () => {
    expect(nextViewHref({ pathname: "/a", search: "?x=1", hash: "" }, (p) => p.delete("x"))).toBe("/a");
  });
});

describe("param helpers", () => {
  it("sets, clears and writes booleans as 1", () => {
    const p = new URLSearchParams("a=1&b=2");
    setParam(p, "a", null);
    setParam(p, "b", "");
    setParam(p, "c", true);
    setParam(p, "d", false);
    setParam(p, "e", "x");
    expect(p.toString()).toBe("c=1&e=x");
  });

  it("replaces list params in order", () => {
    const p = new URLSearchParams("r=a&x=1&r=b");
    setListParam(p, "r", ["c", "d"]);
    expect(p.getAll("r")).toEqual(["c", "d"]);
    setListParam(p, "r", []);
    expect(p.has("r")).toBe(false);
  });

  it("ignores malformed values instead of failing", () => {
    const p = new URLSearchParams("tab=bogus&n=abc&r=A&r=bad!&r=A&r=B");
    expect(readEnumParam(p, "tab", ["game", "provenance"] as const)).toBeNull();
    expect(readEnumParam(new URLSearchParams("tab=game"), "tab", ["game", "provenance"] as const)).toBe("game");
    expect(readParam(p, "n", (v) => /^\d+$/.test(v))).toBeNull();
    expect(readParam(p, "missing", () => true)).toBeNull();
    expect(readListParam(p, "r", (v) => /^[A-Z]$/.test(v))).toEqual(["A", "B"]);
  });
});

describe("anchors (#73)", () => {
  it("builds one id per entity kind", () => {
    expect(anchor.round(U)).toBe(`round-${U}`);
    expect(anchor.learning(U)).toBe(`learning-${U}`);
    expect(anchor.run(U)).toBe(`run-${U}`);
  });

  it("parses entity and section anchors, with or without #", () => {
    expect(parseAnchor(`#round-${U}`)).toEqual({ kind: "round", id: U });
    expect(parseAnchor(`learning-${U.toUpperCase()}`)).toEqual({ kind: "learning", id: U });
    expect(parseAnchor("#map-view")).toEqual({ kind: "section", id: "map-view" });
  });

  it("ignores empty and malformed anchors", () => {
    expect(parseAnchor("")).toBeNull();
    expect(parseAnchor("#")).toBeNull();
    expect(parseAnchor("#%E0%A4%A")).toBeNull();
    expect(parseAnchor("#<script>")).toBeNull();
    // A malformed entity id still reads as a section name, which simply matches no element.
    expect(parseAnchor("#round-123")).toEqual({ kind: "section", id: "round-123" });
  });
});
