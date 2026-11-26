import { expect, test, type Page } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #82: the Game and Round pages are the Session page's debrief (F, #79) scoped to one Game or one Round, plus an
// HP-over-Rounds strip (Game) and a Claims and Evidence tab (Round).
const s = seed();
const duo = `/duos/${s.duoId}`;
const game1 = s.games[0]!;
const shown = game1.rounds.filter((r) => r.roundNumber > 0).sort((a, b) => a.roundNumber - b.roundNumber);
const roundOf = (n: number) => game1.rounds.find((r) => r.roundNumber === n)!;

async function hydrated(page: Page) {
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

/** The Round ids of the shared map's answer pins, read off the live Mapbox source (dev builds expose it). */
async function answerRoundIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Source = { serialize(): { data: { features: Array<{ properties: { roundId: string } }> } } };
    const m = (window as unknown as { __sharedMapbox?: { getSource(id: string): Source | undefined } }).__sharedMapbox;
    return m?.getSource("answers")?.serialize().data.features.map((f) => f.properties.roundId) ?? [];
  });
}

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
  await page.addInitScript((k) => localStorage.setItem(k, "0"), `recall:v1:${s.mikoId}:${s.duoId}`);
});

test("a Game page shows only that Game: its Rounds on the map, in the bar, and in the HP strip", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${duo}/games/${game1.id}`);
  await hydrated(page);
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game \d+ · (Win|Loss|–)/);
  await expect(page.getByTestId("round-tile")).toHaveCount(shown.length);
  await expect(page.getByTestId("hp-point")).toHaveCount(shown.length);
  await expect(page.getByTestId("shared-map")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect.poll(async () => (await answerRoundIds(page)).sort()).toEqual(shown.map((r) => r.id).sort());
  // The back control goes to the Game's Session.
  await expect(page.getByTestId("games-back")).toHaveAttribute("href", new RegExp(`/sessions/${s.sessionId}$`));
});

test("the HP strip lines up with the Round tiles; hovering a point lights its Round, clicking focuses it", async ({ page }) => {
  await page.goto(`${duo}/games/${game1.id}`);
  await hydrated(page);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const r2 = roundOf(2);
  const point = page.locator(`[data-testid="hp-point"][data-round-id="${r2.id}"]`);
  const tile = page.locator(`[data-testid="round-tile"][data-round-id="${r2.id}"]`);
  const [p, t] = [await point.boundingBox(), await tile.boundingBox()];
  expect(Math.abs(p!.x + p!.width / 2 - (t!.x + t!.width / 2))).toBeLessThan(2);

  await point.hover();
  await expect(page.getByTestId("debrief")).toHaveAttribute("data-hover-round", r2.id);
  await point.click();
  await expect(page).toHaveURL(new RegExp(`round=${r2.id}`));
  await expect(page.getByTestId("scope-title")).toHaveText(/· Round 2$/);
  await expect(page.getByTestId("debrief-panel")).toBeVisible();
});

test("a Round page shows that Round focused, as its Session page does", async ({ page }) => {
  const r = roundOf(1);
  await page.goto(`${duo}/sessions/${s.sessionId}?round=${r.id}`);
  await expect(page.getByTestId("round-transcript")).toBeVisible();
  const title = await page.getByTestId("scope-title").textContent();
  const lines = await page.getByTestId("transcript-line").count();

  await page.goto(`${duo}/games/${game1.id}/rounds/1`);
  await expect(page.getByTestId("scope-title")).toHaveText(title!);
  await expect(page.getByTestId("round-transcript")).toBeVisible();
  await expect(page.getByTestId("transcript-line")).toHaveCount(lines);
  await expect(page.locator("body")).not.toContainText(/\bvs\b(?! Opponents)/);
  // The Outcome lens legend (#86): two plain fills and the violet outline, no Learnings, no stripes.
  await expect(page.getByTestId("lens-legend-entry")).toHaveText(["Answer", "Our wrong guess", "Said while guessing, not guessed"]);
  await expect(page.getByTestId("shared-map-legend")).not.toContainText(/Learnings|Striped/);
});

test("the Round page's Claims and Evidence tab lists the citing Claims with their Evidence", async ({ page }) => {
  await page.goto(`${duo}/games/${game1.id}/rounds/2?tab=claims`);
  const claims = page.getByTestId("round-claims");
  await expect(claims).toContainText("Citing Claims (1)");
  await expect(claims).toContainText("Spanish bollards have a red band.");
  await expect(claims.locator(`a[href*="/knowledge/sources/${s.sourceId}"]`).first()).toBeVisible();
});

test("stepping from a Round page goes to the next Round's page, and Back returns", async ({ page }) => {
  await page.goto(`${duo}/games/${game1.id}/rounds/1`);
  await hydrated(page);
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`/games/${game1.id}/rounds/2$`));
  await expect(page.getByTestId("scope-title")).toHaveText(/· Round 2$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/games/${game1.id}/rounds/1$`));
  await expect(page.getByTestId("scope-title")).toHaveText(/· Round 1$/);
  // Esc leaves the Round for its Game page.
  await hydrated(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/games/${game1.id}$`));
});

test("with Recall on, neither page shows the answer before Reveal", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, "1"), `recall:v1:${s.mikoId}:${s.duoId}`);
  for (const url of [`${duo}/games/${game1.id}?round=${roundOf(1).id}`, `${duo}/games/${game1.id}/rounds/1`]) {
    await page.goto(url);
    await hydrated(page);
    await expect(page.getByTestId("debrief-reveal")).toBeVisible();
    await expect(page.getByTestId("round-end-reveal")).toBeVisible();
    await expect(page.getByTestId("round-end-guess")).toHaveCount(0);
    await expect(page.getByTestId("shared-map")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect.poll(() => answerRoundIds(page)).toEqual([]);
  }
});
