import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entityHref, links } from "../links.js";

const D = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";

describe("links", () => {
  it("builds the Duo entry point", () => {
    expect(links.duo(D)).toBe(`/duos/${D}`);
  });

  it("builds Review with only the params given, and a run anchor", () => {
    expect(links.review(D)).toBe(`/duos/${D}/review`);
    expect(links.review(D, { learning: "L1" })).toBe(`/duos/${D}/review?learning=L1`);
    expect(links.review(D, { run: R })).toBe(`/duos/${D}/review?run=${R}#run-${R}`);
    expect(links.review(D, { country: "ES", learning: null })).toBe(`/duos/${D}/review?country=ES`);
  });

  it("builds Stats from an object or URLSearchParams, keeping repeated params", () => {
    expect(links.stats(D)).toBe(`/duos/${D}/stats`);
    expect(links.stats(D, { country: "ES" })).toBe(`/duos/${D}/stats?country=ES`);
    expect(links.stats(D, new URLSearchParams("country=ES&country=PT&map=World"))).toBe(
      `/duos/${D}/stats?country=ES&country=PT&map=World`,
    );
  });

  it("builds Settings and login", () => {
    expect(links.settings()).toBe("/settings");
    expect(links.login()).toBe("/login");
    expect(links.login("/")).toBe("/login");
    expect(links.login(`/duos/${D}/stats?country=ES`)).toBe(`/login?next=${encodeURIComponent(`/duos/${D}/stats?country=ES`)}`);
  });

  it("links only entities whose page has shipped", () => {
    expect(entityHref({ kind: "learning", duoId: D, id: "L1" })).toBe(links.review(D, { learning: "L1" }));
    expect(entityHref({ kind: "run", duoId: D, id: R })).toBe(links.review(D, { run: R }));
    expect(entityHref({ kind: "country", duoId: D, id: "ES" })).toBe(links.stats(D, { country: "ES" }));
    for (const kind of ["game", "round", "session", "claim", "source"] as const) {
      expect(entityHref({ kind, duoId: D, id: "x" })).toBeNull();
    }
  });
});

describe("preload is off for Duo routes (X4)", () => {
  const root = join(__dirname, "../../");
  it("app.html disables data preloading", () => {
    expect(readFileSync(join(root, "app.html"), "utf8")).toContain('data-sveltekit-preload-data="off"');
  });

  it("no Duo route calls preloadData or opts back into preloading", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(svelte|ts)$/.test(name)) files.push(p);
      }
    };
    walk(join(root, "routes/duos"));
    walk(join(root, "lib/components"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/preloadData|preload-data="(hover|tap|eager)"/);
    }
  });
});
