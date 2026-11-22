import { describe, expect, it } from "vitest";
import { COLLAPSE_AFTER, describeValue, startsCollapsed } from "../json-tree.js";

describe("describeValue", () => {
  it("shows primitives as JSON-ish leaves", () => {
    expect(describeValue("a", "R1")).toEqual({ kind: "leaf", type: "string", text: '"R1"' });
    expect(describeValue("a", 42)).toEqual({ kind: "leaf", type: "number", text: "42" });
    expect(describeValue("a", false)).toEqual({ kind: "leaf", type: "boolean", text: "false" });
    expect(describeValue("a", null)).toEqual({ kind: "leaf", type: "null", text: "null" });
    expect(describeValue("a", undefined)).toEqual({ kind: "leaf", type: "undefined", text: "undefined" });
    expect(describeValue("a", 10n)).toEqual({ kind: "leaf", type: "bigint", text: "10n" });
  });

  it("shows functions by the prop name they were passed as", () => {
    expect(describeValue("onSelectUtterance", () => {})).toEqual({ kind: "function", text: "ƒ onSelectUtterance" });
  });

  it("shows Dates and ISO strings as-is", () => {
    expect(describeValue("at", new Date("2026-11-22T09:00:00.000Z"))).toMatchObject({
      type: "date",
      text: "2026-11-22T09:00:00.000Z",
    });
    expect(describeValue("at", new Date("nope"))).toMatchObject({ type: "date", text: "Invalid Date" });
    expect(describeValue("at", "2026-11-22T09:00:00.000Z")).toMatchObject({ text: '"2026-11-22T09:00:00.000Z"' });
  });

  it("lists array, object, Set and Map entries", () => {
    expect(describeValue("xs", ["a", "b"])).toEqual({
      kind: "array",
      summary: "Array(2)",
      entries: [
        ["0", "a"],
        ["1", "b"],
      ],
    });
    expect(describeValue("o", { id: "g1" })).toEqual({ kind: "object", summary: "{1 key}", entries: [["id", "g1"]] });
    expect(describeValue("s", new Set([7]))).toEqual({ kind: "array", summary: "Set(1)", entries: [["0", 7]] });
    expect(describeValue("m", new Map([[1, "x"]]))).toEqual({ kind: "object", summary: "Map(1)", entries: [["1", "x"]] });
  });

  it("marks references back to an ancestor as circular", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(describeValue("self", o, [o])).toEqual({ kind: "circular", text: "[Circular]" });
  });
});

describe("startsCollapsed", () => {
  it("collapses only long arrays and objects", () => {
    const short = Array.from({ length: COLLAPSE_AFTER }, (_, i) => i);
    const long = [...short, 99];
    expect(startsCollapsed(describeValue("xs", short))).toBe(false);
    expect(startsCollapsed(describeValue("xs", long))).toBe(true);
    expect(startsCollapsed(describeValue("o", Object.fromEntries(long.map((i) => [`k${i}`, i]))))).toBe(true);
    expect(startsCollapsed(describeValue("s", "long string".repeat(100)))).toBe(false);
  });
});
