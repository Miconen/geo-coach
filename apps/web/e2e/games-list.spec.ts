import { expect, test, type Page } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #81: the Games list is compact Game rows grouped by Session on the shared map (#78).
const s = seed();
const games = `/duos/${s.duoId}/games`;

/** The shared map's answer pins, read off the live Mapbox source (dev builds expose the instance). */
async function answerPins(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as { __sharedMapbox?: { getSource(id: string): { serialize(): { data: { features: unknown[] } } } | undefined } })
      .__sharedMapbox;
    return m?.getSource("answers")?.serialize().data.features.length ?? -1;
  });
}

async function mapReady(page: Page) {
  await expect(page.getByTestId("shared-map")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
  await page.goto("/settings");
  await page.evaluate(([k]) => localStorage.setItem(k!, "0"), [`recall:v1:${s.mikoId}:${s.duoId}`]);
});

test("one row per Game under its group header, numbered in play order, with no Opponent names", async ({ page }) => {
  await page.goto(games);
  const rows = page.getByTestId("games-index-row");
  await expect(rows).toHaveCount(s.games.length);
  for (const group of await page.getByTestId("games-group").all()) {
    const header = group.getByTestId("games-group-header");
    await expect(header).toBeVisible();
    const numbers = await group.getByTestId("games-index-row").allInnerTexts();
    numbers.forEach((text, i) => expect(text).toContain(`Game ${i + 1}`));
    if (await header.getByRole("link").count()) await expect(header.getByRole("link")).toHaveAttribute("href", /\/sessions\/[0-9a-f-]{36}$/);
    else await expect(header).toContainText("not recorded");
  }
  await expect(rows.first()).toHaveAttribute("href", /\/games\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("games-list")).not.toContainText("Opponents");
  await expect(page.getByTestId("games-list")).not.toContainText("vs ");
  await expect(page.getByTestId("shared-map-header")).toContainText(`${s.games.length} Games`);
});

test("hovering a row lights that Game; leaving the column restores the view", async ({ page }) => {
  await page.goto(games);
  await mapReady(page);
  await expect.poll(() => answerPins(page)).toBeGreaterThan(0);
  const row = page.getByTestId("games-index-row").first();
  await row.hover();
  const guesses = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __sharedMapbox?: { getSource(id: string): { serialize(): { data: { features: unknown[] } } } | undefined } })
        .__sharedMapbox;
      return m?.getSource("guesses")?.serialize().data.features.length ?? -1;
    });
  await expect.poll(guesses).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect.poll(guesses).toBe(0);
});

test("Recall hides answer pins until Reveal", async ({ page }) => {
  await page.evaluate(([k]) => localStorage.setItem(k!, "1"), [`recall:v1:${s.mikoId}:${s.duoId}`]);
  await page.goto(games);
  await mapReady(page);
  await expect(page.getByTestId("shared-map-reveal")).toBeVisible();
  await expect.poll(() => answerPins(page)).toBe(0);
  await page.getByTestId("shared-map-reveal").click();
  await expect.poll(() => answerPins(page)).toBeGreaterThan(0);
});

test("Games → Game → Back keeps the same map", async ({ page }) => {
  await page.goto(games);
  await mapReady(page);
  await page.getByTestId("games-index-row").first().click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
  await page.goBack();
  await expect(page.getByTestId("games-index-row").first()).toBeVisible();
  await expect(page.getByTestId("shared-map")).toHaveAttribute("data-map-instances", "1");
});
