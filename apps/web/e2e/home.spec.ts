import { expect, test, type Page } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #84: Duo Home is lookup first, on the shared map. The seed plays Spain only, and the Duo always guessed it, so
// "Wrong lately" is empty here; the loader's unit tests cover which Rounds count as mistakes.
const s = seed();
const home = `/duos/${s.duoId}`;
const recallKey = `recall:v1:${s.mikoId}:${s.duoId}`;

/** Hydrated, with the event stream open (as url-state.spec waits): a Back before hydration is the browser's alone. */
async function ready(page: Page) {
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
});

test("a country prefix lists matches, Enter picks one, and the pick is a pushed, reloadable URL", async ({ page }) => {
  await page.goto(home);
  await ready(page);
  await expect(page.getByTestId("home-latest-session")).toHaveAttribute("href", `/duos/${s.duoId}/sessions/${s.session2Id}`);
  await expect(page.getByTestId("home-wrong-lately")).toContainText("Nothing missed");
  await expect(page.getByTestId("home-study")).toContainText("Nothing to study");

  const search = page.getByTestId("home-search");
  await search.fill("sp");
  await expect(page.getByTestId("home-search-results").getByRole("button")).toHaveText([/Spain/]);
  await search.fill("zz");
  await expect(page.getByTestId("home-search-results")).toHaveCount(0);
  await search.fill("Sp");
  await search.press("Enter");

  await expect(page).toHaveURL(new RegExp(`${home}\\?look=ES$`));
  const dossier = page.getByTestId("home-dossier");
  await expect(dossier).toHaveAttribute("data-code", "ES");
  await expect(page.getByTestId("home-panel")).toContainText("Split Spain and Portugal when unsure.");
  await expect(page.getByTestId("home-dossier-review")).toHaveAttribute("href", `/duos/${s.duoId}/review?country=ES`);
  await expect(page.getByTestId("shared-map-header")).toContainText("Spain ·");

  await page.reload();
  await ready(page);
  await expect(page.getByTestId("home-dossier")).toHaveAttribute("data-code", "ES");

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  await expect(page.getByTestId("home-dossier")).toHaveCount(0);
  await expect(page.getByTestId("home-latest-session")).toBeVisible();
});

test("picking, clearing and Back step through history without rerunning the load", async ({ page }) => {
  await page.goto(home);
  await ready(page);
  let loads = 0;
  page.on("request", (r) => {
    if (r.url().includes("__data.json")) loads += 1;
  });
  await page.getByTestId("home-search").fill("es");
  await page.getByTestId("home-search-results").getByRole("button").first().click();
  await expect(page.getByTestId("home-dossier")).toBeVisible();
  await page.getByRole("button", { name: "Clear Spain" }).click();
  await expect(page.getByTestId("home-dossier")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  await page.goBack();
  await expect(page.getByTestId("home-dossier")).toHaveAttribute("data-code", "ES");
  await page.goBack();
  await expect(page.getByTestId("home-dossier")).toHaveCount(0);
  expect(loads).toBe(0);
});

test("with Recall on, the map hides answers until Reveal; the dossier stays readable", async ({ page }) => {
  await page.goto(home);
  await page.evaluate((k) => localStorage.setItem(k, "1"), recallKey);
  await page.goto(`${home}?look=ES`);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.getByTestId("home-panel")).toContainText("Split Spain and Portugal when unsure.");
  const reveal = page.getByTestId("shared-map-reveal");
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(reveal).toHaveCount(0);
});

test("hovering the rating sparkline reads out that Game's rating and date", async ({ page }) => {
  await page.goto(home);
  const chart = page.getByTestId("home-rating-chart");
  test.skip((await chart.count()) === 0, "the seed has fewer than two rated Games");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await expect(page.getByTestId("home-rating-date")).toHaveText(/\d{1,2} [A-Z][a-z]{2} \d{2}/);
  await expect(page.getByTestId("home-rating-value")).toHaveText(/^[\d,]+$/);
});
