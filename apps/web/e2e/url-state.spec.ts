import { expect, test, type Page } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #73: every view state that changes what's on screen is in the URL. Filters replace the history entry, focus
// changes push one; a reload, Back and a signed-out deep link all rebuild the same view. Ids anchor Rounds,
// Learnings and sections. The e2e server has no Mapbox token, so the Map view is driven by its cards and toolbar.
const s = seed();
const duo = `/duos/${s.duoId}`;
const stats = `${duo}/stats`;
const [game1] = s.games;
const roundOf = (n: number) => game1!.rounds.find((r) => r.roundNumber === n)!;

async function ready(page: Page) {
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

const filterBar = (page: Page) => page.locator("form").filter({ hasText: "Smoothing" });
const smoothingSelect = (page: Page) => filterBar(page).locator("label", { hasText: "Smoothing" }).locator("select");
const selectedRank = (page: Page) => page.locator('#rankings tbody tr[aria-selected="true"]');
const params = (page: Page) => new URL(page.url()).searchParams;
const historyLength = (page: Page) => page.evaluate(() => history.length);

test("Stats: a Rankings country, a Round, Show all Rounds and another Round survive reload; Back steps through them", async ({ page }) => {
  await login(page, s.soraId);
  await page.goto(`${stats}?smooth=light`);
  await ready(page);

  // A filter change replaces the entry: no history added.
  const before = await historyLength(page);
  await smoothingSelect(page).selectOption("heavy");
  await expect(page).toHaveURL(/smooth=heavy/);
  expect(await historyLength(page)).toBe(before);

  // Select a country (a Rankings row), then a Round, then Show all, then another Round of that Game.
  await page.locator("#rankings tbody tr").first().locator("td").first().click();
  await expect(page).toHaveURL(/[?&]rank=[A-Z]{2}/);
  const rank = params(page).get("rank")!;
  await expect(selectedRank(page)).toHaveCount(1);

  const first = roundOf(2);
  await page.locator(`[data-testid="best-guess"][data-round-id="${first.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`round=${first.id}`));
  await page.getByTestId("round-card-show-game").click();
  await expect(page).toHaveURL(/allRounds=1/);
  await expect(page.getByTestId("round-card-show-game")).toHaveText("Hide the other Rounds");
  const other = page.locator(`[data-testid="round-card-game-round"]:not([data-round-id="${first.id}"])`).first();
  const otherId = (await other.getAttribute("data-round-id"))!;
  await other.click();
  await expect(page).toHaveURL(new RegExp(`round=${otherId}`));
  expect(await historyLength(page)).toBe(before + 4);

  // Reload: the same view.
  await page.reload();
  await ready(page);
  expect(params(page).get("rank")).toBe(rank);
  await expect(selectedRank(page)).toHaveCount(1);
  await expect(smoothingSelect(page)).toHaveValue("heavy");
  await expect(page.getByTestId("round-card-show-game")).toHaveText("Hide the other Rounds");
  const otherNumber = game1!.rounds.find((r) => r.id === otherId)!.roundNumber;
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `${duo}/games/${game1!.id}/rounds/${otherNumber}`);

  // Back undoes the focus changes in reverse; the filter stays.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`round=${first.id}.*allRounds=1`));
  await expect(page.getByTestId("round-card-show-game")).toHaveText("Hide the other Rounds");
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `${duo}/games/${game1!.id}/rounds/2`);
  await page.goBack();
  await expect(page).not.toHaveURL(/allRounds/);
  await expect(page.getByTestId("round-card-show-game")).toHaveText(/^Show all \d+ Rounds of this Game$/);
  await page.goBack();
  await expect(page).not.toHaveURL(/round=/);
  await expect(page.getByTestId("round-card-show-game")).toHaveCount(0);
  await expect(selectedRank(page)).toHaveCount(1);
  await page.goBack();
  await expect(page).not.toHaveURL(/rank=/);
  await expect(selectedRank(page)).toHaveCount(0);
  await expect(smoothingSelect(page)).toHaveValue("heavy");
});

test("Stats: a Map view country focus is in the URL; leaving it pushes, Back restores it", async ({ page }) => {
  await login(page, s.soraId);
  await page.goto(stats);
  await ready(page);
  await page.locator("#rankings tbody tr").first().locator("td").first().click();
  await expect(page).toHaveURL(/rank=/);
  const code = params(page).get("rank")!;

  await page.goto(`${stats}?focus=${code}`);
  await ready(page);
  const world = page.getByTitle("Back to the world (Esc)");
  await expect(world).toBeVisible();
  await world.click();
  await expect(page).not.toHaveURL(/focus=/);
  await expect(world).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`focus=${code}`));
  await expect(world).toBeVisible();
});

test("a signed-out Stats URL returns to the same view after sign-in", async ({ page }) => {
  const r = roundOf(2);
  await page.goto(`${stats}?smooth=heavy&round=${r.id}&allRounds=1`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.locator("form[action='/auth/dev']").filter({ has: page.locator(`input[value="${s.soraId}"]`) }).locator("button").click();
  await expect(page).toHaveURL(new RegExp(`/stats\\?smooth=heavy&round=${r.id}&allRounds=1$`));
  await ready(page);
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `${duo}/games/${game1!.id}/rounds/2`);
  await expect(page.getByTestId("round-card-show-game")).toHaveText("Hide the other Rounds");
  await expect(smoothingSelect(page)).toHaveValue("heavy");
});

test("anchors scroll to and highlight Rounds, Learnings and sections on Game, Round and Review pages", async ({ page }) => {
  await login(page, s.soraId);
  const r = roundOf(2);

  await page.goto(`${duo}/games/${game1!.id}#round-${r.id}`);
  await expect(page.locator(`#round-${r.id}`)).toHaveAttribute("data-anchored", "");
  await expect(page.locator(`#round-${r.id}`)).toBeInViewport();

  // A section anchor opens its drawer.
  await page.goto(`${duo}/games/${game1!.id}#runs`);
  await expect(page.getByTestId("game-runs")).toHaveAttribute("open", "");

  await page.goto(`${duo}/games/${game1!.id}/rounds/2#claims`);
  await expect(page.getByTestId("round-claims")).toHaveAttribute("open", "");
  await expect(page.getByTestId("round-claims")).toHaveAttribute("data-anchored", "");

  const learning = s.learningIds[0]!;
  await page.goto(`${duo}/review#learning-${learning}`);
  const row = page.locator(`[data-learning-row="${learning}"]`);
  await expect(row).toHaveAttribute("data-selected", "1");
  await expect(row).toHaveAttribute("data-anchored", "");
});

test("drawers and tabs are in the URL, replacing the history entry", async ({ page }) => {
  await login(page, s.soraId);
  await page.goto(`${duo}/games/${game1!.id}`);
  await ready(page);
  const before = await historyLength(page);
  await page.getByTestId("game-runs").locator("summary").click();
  await expect(page).toHaveURL(/open=runs/);
  await page.getByTestId("round-learnings").locator("summary").click();
  await expect(page).toHaveURL(/open=runs&open=learnings/);
  expect(await historyLength(page)).toBe(before);
  await page.reload();
  await expect(page.getByTestId("game-runs")).toHaveAttribute("open", "");
  await expect(page.getByTestId("round-learnings")).toHaveAttribute("open", "");
  await page.getByTestId("game-runs").locator("summary").click();
  await expect(page).toHaveURL(/\?open=learnings$/);
});

test("unknown or malformed params are ignored without an error page", async ({ page }) => {
  await login(page, s.soraId);
  const bad = await page.goto(`${stats}?focus=zz&region=nope&round=not-a-uuid&allRounds=yes&rank=!!&smooth=bogus&x=1#round-123`);
  expect(bad?.status()).toBe(200);
  await ready(page);
  await expect(page.getByTestId("round-card-link")).toHaveCount(0);
  await expect(page.getByTitle("Back to the world (Esc)")).toHaveCount(0);
  await expect(selectedRank(page)).toHaveCount(0);

  // A well-formed Round id the Duo doesn't have opens nothing either.
  expect((await page.goto(`${stats}?round=00000000-0000-4000-8000-000000000000&allRounds=1`))?.status()).toBe(200);
  await expect(page.getByTestId("round-card-link")).toHaveCount(0);

  expect((await page.goto(`${duo}/games/${game1!.id}?open=%00&open=zzz#learning-bad`))?.status()).toBe(200);
  expect((await page.goto(`${duo}/review?tab=bogus#%E0%A4%A`))?.status()).toBe(200);
  await expect(page.getByTestId("learning-select").first()).toBeVisible();
});
