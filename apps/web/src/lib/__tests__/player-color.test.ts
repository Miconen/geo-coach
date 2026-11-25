import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LENS_COLORS, OPPONENT_COLOR, PLAYER_PALETTE, resolvePlayerColors } from "../player-color.js";

const hexOf = (key: string) => PLAYER_PALETTE.find((c) => c.key === key)!.hex;

describe("resolvePlayerColors", () => {
  it("draws each Player's own choice", () => {
    expect(resolvePlayerColors([{ id: "a", color: "teal" }, { id: "b", color: "brown" }], "a")).toEqual({
      a: hexOf("teal"),
      b: hexOf("brown"),
    });
  });

  it("gives Players with no choice distinct defaults", () => {
    const colors = resolvePlayerColors([{ id: "a", color: null }, { id: "b", color: null }], "a");
    expect(colors.a).not.toBe(colors.b);
    // Whoever views, the defaults are the same (they don't depend on the viewer).
    expect(resolvePlayerColors([{ id: "b", color: null }, { id: "a", color: null }], "b")).toEqual(colors);
  });

  it("never gives a default the partner's chosen colour", () => {
    const colors = resolvePlayerColors([{ id: "a", color: null }, { id: "b", color: "blue" }]);
    expect(colors.b).toBe(hexOf("blue"));
    expect(colors.a).not.toBe(hexOf("blue"));
  });

  it("draws two Players with the same choice in different colours, the viewer keeping theirs", () => {
    const players = [{ id: "a", color: "pink" }, { id: "b", color: "pink" }];
    const forA = resolvePlayerColors(players, "a");
    const forB = resolvePlayerColors(players, "b");
    expect(forA.a).toBe(hexOf("pink"));
    expect(forA.b).not.toBe(forA.a);
    expect(forB.b).toBe(hexOf("pink"));
    expect(forB.a).not.toBe(forB.b);
    const noViewer = resolvePlayerColors(players);
    expect(noViewer.a).not.toBe(noViewer.b);
  });

  it("treats an unknown stored value as no choice", () => {
    const colors = resolvePlayerColors([{ id: "a", color: "#2563eb" }, { id: "b", color: null }]);
    expect(new Set(Object.values(colors)).size).toBe(2);
    for (const c of Object.values(colors)) expect(PLAYER_PALETTE.map((p) => p.hex)).toContain(c);
  });
});

// sRGB → relative luminance, contrast ratio and CIELAB (D65), as in WCAG 2 and CIE76.
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** color-mix(in srgb, hex, #fff pct), as playerInk renders it. */
function lighten(hex: string, pct: number) {
  return `#${channels(hex)
    .map((c) => Math.round((c * (1 - pct) + pct) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
function lab(hex: string) {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as const;
}
const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// Every theme's page and card backgrounds, with how much it lightens speaker colours.
const themesCss = readFileSync(createRequire(import.meta.url).resolve("@geo-coach/shared/themes.css"), "utf8");
const themes = [...themesCss.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)].map(([, name, body]) => {
  const v = (prop: string) => body!.match(new RegExp(`--${prop}:\\s*([^;]+);`))?.[1]?.trim();
  return { name: name!, backgrounds: [v("bg")!, v("surface")!], lighten: parseFloat(v("speaker-lighten") ?? "0") / 100 };
});

describe("the Player palette", () => {
  it("finds every theme", () => {
    expect(themes.length).toBeGreaterThanOrEqual(6);
    for (const t of themes) for (const bg of t.backgrounds) expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each([...PLAYER_PALETTE.map((c): [string, string] => [c.label, c.hex]), ["Opponent", OPPONENT_COLOR] as [string, string]])(
    "%s reads as text on every theme background (WCAG AA, 4.5:1)",
    (_label, hex) => {
      for (const t of themes) {
        for (const bg of t.backgrounds) expect(contrast(lighten(hex, t.lighten), bg), `${t.name} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each([...PLAYER_PALETTE.map((c): [string, string] => [c.label, c.hex]), ["Opponent", OPPONENT_COLOR] as [string, string]])(
    "%s carries a white initial on an avatar pin",
    (_label, hex) => expect(contrast(hex, "#ffffff")).toBeGreaterThanOrEqual(4.5),
  );

  it.each(PLAYER_PALETTE.map((c): [string, string] => [c.label, c.hex]))("%s stays clear of every lens colour", (_label, hex) => {
    for (const [lens, lensHex] of Object.entries(LENS_COLORS)) {
      expect(deltaE(hex, lensHex), lens).toBeGreaterThanOrEqual(45);
    }
  });

  it("has colours distinct from each other", () => {
    const hexes = PLAYER_PALETTE.map((c) => c.hex);
    for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) expect(deltaE(hexes[i]!, hexes[j]!)).toBeGreaterThan(15);
  });
});
