import { expect, test, type Page } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #89: the Clue lens on a focused Round. A finished clues run says two Clues in Game 1's Round 1 (answer Spain), and
// Claims link them to countries; the lens fills countries from those links, one Clue alone or several combined.
const s = seed();
const duo = `/duos/${s.duoId}`;
const game1 = s.games[0]!;
const round1 = game1.rounds.find((r) => r.roundNumber === 1)!;
const round2 = game1.rounds.find((r) => r.roundNumber === 2)!;
const round3 = game1.rounds.find((r) => r.roundNumber === 3)!;

const ids = {
  run: crypto.randomUUID(),
  yellow: crypto.randomUUID(),
  truck: crypto.randomUUID(),
  // c1, c3 verified (a Player's ✓); c2, c4 speculated.
  c1: crypto.randomUUID(),
  c2: crypto.randomUUID(),
  c3: crypto.randomUUID(),
  c4: crypto.randomUUID(),
  // A verified Claim linking the truck to one Region, Galicia (#92); added by its own test, last.
  galicia: crypto.randomUUID(),
  rcYellow: crypto.randomUUID(),
  rcTruck: crypto.randomUUID(),
  // #93: a second run over Game 1's Round 3 only, where the yellow line is seen and red-top bollards are not.
  run3: crypto.randomUUID(),
  bollard: crypto.randomUUID(),
  c5: crypto.randomUUID(),
  c6: crypto.randomUUID(),
  rc3Yellow: crypto.randomUUID(),
  rc3Bollard: crypto.randomUUID(),
};

test.beforeAll(async () => {
  await withSql(async (sql) => {
    const [u1, u2] = await sql<{ id: string }[]>`SELECT u.id FROM utterances u WHERE u.duo_id = ${s.duoId} ORDER BY u.started_at LIMIT 2`;
    await sql`INSERT INTO processing_runs (id, duo_id, session_id, started_by_player_id, purpose, agent, model, prompt_version, range_start, range_end, status, started_at, finished_at)
      VALUES (${ids.run}, ${s.duoId}, ${s.sessionId}, ${s.mikoId}, 'clues', 'claude', 'e2e', 'clues-v1', '2026-11-20T19:00:00Z', '2026-11-20T19:01:50Z', 'finished', now(), now())`;
    await sql`INSERT INTO clues (id, duo_id, family, name, origin) VALUES
      (${ids.yellow}, ${s.duoId}, 'Road lines', 'Yellow/orange centre line', 'seed'),
      (${ids.truck}, ${s.duoId}, 'Google car', 'Pickup truck', 'seed')`;
    await sql`INSERT INTO claims (id, duo_id, text, countries, clues_prompt_version, clues_tagged_at) VALUES
      (${ids.c1}, ${s.duoId}, 'E2E: only Spain has yellow centre lines, never France.', '["ES"]', 'clue-tag-v1', now()),
      (${ids.c2}, ${s.duoId}, 'E2E: Italy has yellow centre lines.', '["IT"]', 'clue-tag-v1', now()),
      (${ids.c3}, ${s.duoId}, 'E2E: Portugal coverage is a pickup truck, Morocco sometimes.', '["PT","MA"]', 'clue-tag-v1', now()),
      (${ids.c4}, ${s.duoId}, 'E2E: Spain never has truck coverage.', '["ES"]', 'clue-tag-v1', now())`;
    await sql`INSERT INTO claim_evidence (id, claim_id, duo_id, kind, direction, player_id) VALUES
      (${crypto.randomUUID()}, ${ids.c1}, ${s.duoId}, 'player', 'for', ${s.mikoId}),
      (${crypto.randomUUID()}, ${ids.c3}, ${s.duoId}, 'player', 'for', ${s.mikoId})`;
    await sql`INSERT INTO claim_clues (claim_id, clue_id, duo_id, country, prevalence) VALUES
      (${ids.c1}, ${ids.yellow}, ${s.duoId}, 'ES', 'typical'),
      (${ids.c1}, ${ids.yellow}, ${s.duoId}, 'FR', 'lacks'),
      (${ids.c2}, ${ids.yellow}, ${s.duoId}, 'IT', 'typical'),
      (${ids.c3}, ${ids.truck}, ${s.duoId}, 'PT', 'typical'),
      (${ids.c3}, ${ids.truck}, ${s.duoId}, 'MA', 'some'),
      (${ids.c4}, ${ids.truck}, ${s.duoId}, 'ES', 'lacks')`;
    await sql`INSERT INTO round_clues (id, duo_id, run_id, round_id, clue_id) VALUES
      (${ids.rcYellow}, ${s.duoId}, ${ids.run}, ${round1.id}, ${ids.yellow}),
      (${ids.rcTruck}, ${s.duoId}, ${ids.run}, ${round1.id}, ${ids.truck})`;
    await sql`INSERT INTO round_clue_utterances (round_clue_id, utterance_id) VALUES (${ids.rcYellow}, ${u1!.id}), (${ids.rcTruck}, ${u2!.id})`;

    // Round 3 (#93): c5 verified (Portugal typical), c6 speculated (Italy typical), so only Portugal reads unlikely.
    const [u3] = await sql<{ id: string }[]>`SELECT u.id FROM utterances u WHERE u.duo_id = ${s.duoId} AND u.text = 'Madrid for sure'`;
    await sql`INSERT INTO processing_runs (id, duo_id, session_id, started_by_player_id, purpose, agent, model, prompt_version, range_start, range_end, status, started_at, finished_at)
      VALUES (${ids.run3}, ${s.duoId}, ${s.sessionId}, ${s.mikoId}, 'clues', 'claude', 'e2e', 'clues-v2', '2026-11-20T19:02:50Z', '2026-11-20T19:03:50Z', 'finished', now(), now())`;
    await sql`INSERT INTO clues (id, duo_id, family, name, origin) VALUES (${ids.bollard}, ${s.duoId}, 'Bollards', 'Red-top bollard', 'seed')`;
    await sql`INSERT INTO claims (id, duo_id, text, countries, clues_prompt_version, clues_tagged_at) VALUES
      (${ids.c5}, ${s.duoId}, 'E2E: Portugal has red-top bollards.', '["PT"]', 'clue-tag-v1', now()),
      (${ids.c6}, ${s.duoId}, 'E2E: Italy has red-top bollards.', '["IT"]', 'clue-tag-v1', now())`;
    await sql`INSERT INTO claim_evidence (id, claim_id, duo_id, kind, direction, player_id) VALUES
      (${crypto.randomUUID()}, ${ids.c5}, ${s.duoId}, 'player', 'for', ${s.mikoId})`;
    await sql`INSERT INTO claim_clues (claim_id, clue_id, duo_id, country, prevalence) VALUES
      (${ids.c5}, ${ids.bollard}, ${s.duoId}, 'PT', 'typical'),
      (${ids.c6}, ${ids.bollard}, ${s.duoId}, 'IT', 'typical')`;
    await sql`INSERT INTO round_clues (id, duo_id, run_id, round_id, clue_id, polarity) VALUES
      (${ids.rc3Yellow}, ${s.duoId}, ${ids.run3}, ${round3.id}, ${ids.yellow}, 'seen'),
      (${ids.rc3Bollard}, ${s.duoId}, ${ids.run3}, ${round3.id}, ${ids.bollard}, 'not_seen')`;
    await sql`INSERT INTO round_clue_utterances (round_clue_id, utterance_id) VALUES (${ids.rc3Yellow}, ${u3!.id}), (${ids.rc3Bollard}, ${u3!.id})`;
  });
});

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`DELETE FROM processing_runs WHERE id = ANY(${[ids.run, ids.run3]})`;
    await sql`DELETE FROM claims WHERE id = ANY(${[ids.c1, ids.c2, ids.c3, ids.c4, ids.c5, ids.c6, ids.galicia]})`;
    await sql`DELETE FROM clues WHERE id = ANY(${[ids.yellow, ids.truck, ids.bollard]})`;
  });
});

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
  await page.addInitScript((k) => localStorage.setItem(k, "0"), `recall:v1:${s.mikoId}:${s.duoId}`);
});

const counts = (page: Page) => page.getByTestId("clue-legend-count").allTextContents();

/** Clicks the map at a point, once the shared map draws (dev builds expose the Mapbox instance). */
async function clickMapAt(page: Page, lng: number, lat: number) {
  await expect(page.getByTestId("shared-map")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await page.waitForFunction(() => {
    const m = (window as unknown as { __sharedMapbox?: { loaded(): boolean; isMoving(): boolean } }).__sharedMapbox;
    return m?.loaded() && !m.isMoving();
  });
  const xy = await page.evaluate(([x, y]) => {
    const m = (window as unknown as { __sharedMapbox: { project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__sharedMapbox;
    const p = m.project([x!, y!]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lng, lat]);
  await page.mouse.click(xy.x, xy.y);
}

test("a Round's Clue lens: switch to it, solo one Clue, combine two, and open a country popup", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${duo}/games/${game1.id}/rounds/1`);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  const card = page.getByTestId("clue-lens");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("lens-outcome")).toHaveAttribute("aria-pressed", "true");

  // Switch lens: a view param (ADR 0007), and the card lists the Round's Clues with the speech they rest on.
  await page.getByTestId("lens-clues").click();
  await expect(page).toHaveURL(/[?&]lens=clues/);
  await expect(page.getByTestId("lens-clues")).toHaveAttribute("aria-pressed", "true");
  const clues = page.getByTestId("clue-lens-clue");
  await expect(clues).toHaveCount(2);
  await expect(clues.first()).toContainText("Yellow/orange centre line");
  await expect(clues.first()).toContainText("You go Spain");
  // Every Clue by default: ruled out FR · typical ES, PT · unlikely none · in some areas IT (speculated), MA.
  await expect.poll(() => counts(page)).toEqual(["1", "2", "0", "2"]);
  await expect(page.getByTestId("clue-lens-not-seen")).toHaveCount(0);
  await expect(page.getByTestId("clue-lens-answer")).toContainText("typical there");
  await expect(page.getByTestId("shared-map-legend")).toHaveCount(0);

  // Solo the truck: PT typical, MA in some areas; Spain's lacks is speculated, so never rules it out.
  await clues.nth(1).getByTestId("clue-lens-solo").click();
  await expect(clues.nth(0)).toHaveAttribute("data-shown", "false");
  await expect.poll(() => counts(page)).toEqual(["0", "1", "0", "1"]);
  await expect(page.getByTestId("clue-lens-answer")).toContainText("neutral");

  // Tick the yellow line back in: combined, each country takes its strongest fill.
  await clues.nth(0).getByTestId("clue-lens-combine").check();
  await expect.poll(() => counts(page)).toEqual(["1", "2", "0", "2"]);

  // The answer country opens a popup with every shown Claim that links it.
  await clickMapAt(page, -0.88, 41.65);
  const popup = page.getByTestId("country-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Spain");
  await expect(page.getByTestId("clue-popup-fill")).toContainText("Typical there");
  const rows = page.getByTestId("clue-popup-claim");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("typical · Yellow/orange centre line · verified");
  await expect(rows.nth(1)).toContainText("lacks · Pickup truck · speculated");
});

test("a Clue not seen this Round: listed under Not seen, shown alone, and its countries read unlikely (#93)", async ({ page }) => {
  await page.goto(`${duo}/games/${game1.id}/rounds/3?lens=clues`);
  await expect(page.getByTestId("lens-clues")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lens-clues")).toHaveText("Clues (2)");
  const notSeen = page.getByTestId("clue-lens-not-seen");
  await expect(notSeen).toContainText("Not seen");
  const row = notSeen.getByTestId("clue-lens-clue");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Red-top bollard");
  await expect(row).toContainText("Madrid for sure");
  await expect(row).toHaveAttribute("data-polarity", "not_seen");

  // Combined: ruled out FR · typical ES · unlikely PT (verified typical, not seen) · in some areas IT (speculated).
  const unlikely = page.locator('[data-testid="clue-legend-entry"][data-fill="unlikely"]');
  await expect(unlikely).toContainText("Unlikely: typical there, not seen this Round");
  await expect.poll(() => counts(page)).toEqual(["1", "1", "1", "1"]);

  // Alone: only Portugal reads unlikely; Italy's speculated Claim says nothing for a Clue not seen.
  await row.getByTestId("clue-lens-solo").click();
  await expect(row).toHaveAttribute("data-shown", "true");
  await expect(page.locator('[data-testid="clue-lens-clue"][data-polarity="seen"]')).toHaveAttribute("data-shown", "false");
  await expect.poll(() => counts(page)).toEqual(["0", "0", "1", "0"]);
  await expect(unlikely.getByTestId("clue-legend-count")).toHaveText("1");
});

test("with no Clues said, the lens is unavailable", async ({ page }) => {
  await page.goto(`${duo}/games/${game1.id}/rounds/${round2.roundNumber}?lens=clues`);
  await expect(page.getByTestId("clue-lens-none")).toHaveText("No Clues said this Round");
  await expect(page.getByTestId("lens-clues")).toBeDisabled();
  await expect(page.getByTestId("lens-outcome")).toHaveAttribute("aria-pressed", "true");
});

test("under Recall the lens stays hidden until Reveal", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, "1"), `recall:v1:${s.mikoId}:${s.duoId}`);
  await page.goto(`${duo}/games/${game1.id}/rounds/1?lens=clues`);
  await expect(page.getByTestId("debrief-reveal")).toBeVisible();
  await expect(page.getByTestId("clue-lens")).toHaveCount(0);
  await page.getByTestId("debrief-reveal").click();
  await expect(page.getByTestId("clue-lens-clue")).toHaveCount(2);
});

/** The Clue lens's Region layer (#92) as drawn: the filled Region at a point, if any, and its fill colour. */
async function regionFillAt(page: Page, lng: number, lat: number) {
  return page.evaluate(([x, y]) => {
    type M = {
      project(p: [number, number]): { x: number; y: number };
      queryRenderedFeatures(p: { x: number; y: number }, o: { layers: string[] }): Array<{ properties: { code: string } }>;
      getPaintProperty(layer: string, prop: string): unknown;
    };
    const m = (window as unknown as { __sharedMapbox: M }).__sharedMapbox;
    const code = m.queryRenderedFeatures(m.project([x!, y!]), { layers: ["clue-regions"] })[0]?.properties.code ?? null;
    const paint = m.getPaintProperty("clue-regions", "fill-color");
    const at = code && Array.isArray(paint) ? paint.indexOf(code) : -1;
    return { code, color: at >= 0 ? ((paint as unknown[])[at + 1] as string) : null };
  }, [lng, lat]);
}

test("a Clue with a Region link shades its country Region by Region, and the popup names the Region", async ({ page }) => {
  test.setTimeout(60_000);
  await withSql(async (sql) => {
    await sql`INSERT INTO claims (id, duo_id, text, countries, regions, clues_prompt_version, clues_tagged_at)
      VALUES (${ids.galicia}, ${s.duoId}, 'E2E: Galicia often has pickup truck coverage.', '["ES"]', '[{"country":"ES","name":"Galicia"}]', 'clue-tag-v2', now())`;
    await sql`INSERT INTO claim_evidence (id, claim_id, duo_id, kind, direction, player_id) VALUES (${crypto.randomUUID()}, ${ids.galicia}, ${s.duoId}, 'player', 'for', ${s.mikoId})`;
    await sql`INSERT INTO claim_clues (claim_id, clue_id, duo_id, country, region_code, prevalence) VALUES (${ids.galicia}, ${ids.truck}, ${s.duoId}, 'ES', 'ES-GA', 'some')`;
  });
  await page.goto(`${duo}/games/${game1.id}/rounds/1?lens=clues`);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  const clues = page.getByTestId("clue-lens-clue");
  await clues.nth(1).getByTestId("clue-lens-solo").click();
  // The truck alone: PT typical; MA, and now Spain through Galicia, in some areas.
  await expect.poll(() => counts(page)).toEqual(["0", "1", "0", "2"]);
  await expect(page.getByTestId("clue-lens-answer")).toContainText("in some areas");

  // Spain is drawn by its Regions: Galicia in some areas, Madrid neutral.
  await clickMapAt(page, -3.7, 40.42);
  await expect.poll(() => regionFillAt(page, -7.9, 42.75), { timeout: 15_000 }).toEqual({ code: "ES-GA", color: "#93c5fd" });
  expect((await regionFillAt(page, -3.7, 40.42)).code).toBeNull();

  // Spain's popup lists the Region link with its Region.
  await clickMapAt(page, -7.9, 42.75);
  await expect(page.getByTestId("country-popup")).toContainText("Spain");
  const region = page.getByTestId("clue-popup-claim").filter({ has: page.getByTestId("clue-popup-region") });
  await expect(region).toHaveCount(1);
  await expect(region).toContainText("in some areas · Pickup truck · in Galicia · verified");
  await expect(region).toContainText("Galicia often has pickup truck coverage");
});
