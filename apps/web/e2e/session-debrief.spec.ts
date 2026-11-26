import { expect, test, type Page } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #79: the Session page is the debrief hub on the shared map. Drill Games → a Game's Rounds → a Round, with every
// focus step in the URL; Back walks back, a reload restores, and the map is never rebuilt.
const s = seed();
const session = `/duos/${s.duoId}/sessions/${s.sessionId}`;

async function hydrated(page: Page) {
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
});

test("drills from the Games into a Round, in the URL, and Back walks out", async ({ page }) => {
  await page.goto(session);
  await hydrated(page);
  const games = page.getByTestId("game-tile");
  await expect(games.first()).toBeVisible();
  const n = await games.count();
  await expect(page.getByTestId("scope-title")).toHaveText(`${n} Game${n === 1 ? "" : "s"} tonight`);

  await games.first().click();
  await expect(page).toHaveURL(/\?game=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game 1 · /);
  const tiles = page.getByTestId("round-tile");
  await expect(tiles.first()).toBeVisible();
  // The Rounds slide in one after another: let them land.
  await page.waitForFunction(() => document.getAnimations().length === 0);

  await tiles.first().click();
  await expect(page).toHaveURL(/&round=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game 1 · Round \d+$/);
  await expect(page.getByTestId("round-transcript")).toBeVisible();
  await expect(page.getByTestId("round-over")).toBeVisible();

  // A reload restores the focus.
  await page.reload();
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game 1 · Round \d+$/);
  await hydrated(page);

  // j steps to the next Round.
  const before = page.url();
  await page.keyboard.press("j");
  await expect(page).not.toHaveURL(before);

  await page.goBack();
  await expect(page).toHaveURL(before);
  await page.goBack();
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game 1 · (Win|Loss|–)/);
  await page.getByTestId("games-back").click();
  await expect(page.getByTestId("game-tile").first()).toBeVisible();
});

test("after a reload, Back reaches the cold-loaded first view", async ({ page }) => {
  await page.goto(session);
  await hydrated(page);
  const first = await page.getByTestId("scope-title").textContent();
  await page.getByTestId("game-tile").first().click();
  await expect(page).toHaveURL(/\?game=/);
  await page.reload();
  await expect(page.getByTestId("scope-title")).toHaveText(/^Game 1 · /);
  await hydrated(page);
  await page.goBack();
  await expect(page.getByTestId("scope-title")).toHaveText(first!);
  await expect(page.getByTestId("game-tile").first()).toBeVisible();
});

test("Esc steps out one level; the drawer replaces the history entry", async ({ page }) => {
  await page.goto(session);
  await hydrated(page);
  await page.getByTestId("game-tile").first().click();
  await page.getByTestId("round-tile").first().click();
  await expect(page.getByTestId("debrief-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("debrief-panel")).toHaveCount(0);
  await expect(page.getByTestId("round-tile").first()).toBeVisible();

  const length = await page.evaluate(() => history.length);
  await page.getByTestId("chip-learnings").click();
  await expect(page.getByTestId("drawer-learnings")).toBeVisible();
  await expect(page).toHaveURL(/drawer=learnings/);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test("a Round anchor focuses that Round instead of scrolling", async ({ page }) => {
  const round = s.games[0]!.rounds.find((r) => r.roundNumber === 1)!;
  await page.goto(`${session}#round-${round.id}`);
  await expect(page).toHaveURL(new RegExp(`round=${round.id}`));
  await expect(page.getByTestId("scope-title")).toHaveText(/· Round 1$/);
});

test("unknown selection params are ignored", async ({ page }) => {
  const res = await page.goto(`${session}?game=nope&round=${crypto.randomUUID()}&country=12&drawer=zzz`);
  expect(res!.status()).toBe(200);
  await expect(page.getByTestId("scope-title")).toHaveText(/Games? tonight$/);
});

test("no Opponent team name appears on the page", async ({ page }) => {
  await page.goto(session);
  await hydrated(page);
  await page.getByTestId("game-tile").first().click();
  await page.getByTestId("round-tile").first().click();
  await expect(page.getByTestId("debrief-panel")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bvs\b/);
});

test("the shared map survives Session → Games → Session", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(session);
  const map = page.getByTestId("shared-map");
  await expect(map).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await page.getByTestId("section-games").click();
  await expect(page).toHaveURL(/\/games$/);
  await page.goBack();
  await expect(page.getByTestId("game-tile").first()).toBeVisible();
  await expect(map).toHaveAttribute("data-map-instances", "1");
});

// #83: the Countdown band and the Round-end reveal line in the transcript panel.
const recallKey = `recall:v1:${s.mikoId}:${s.duoId}`;

test("a Round's transcript opens the Countdown band on the first guess and ends on the Round-end line", async ({ page }) => {
  const round = s.games[0]!.rounds.find((r) => r.roundNumber === 1)!;
  await page.addInitScript((k) => localStorage.setItem(k, "0"), recallKey);
  await page.goto(`${session}?round=${round.id}`);
  const band = page.getByTestId("countdown-band");
  await expect(band).toBeVisible();
  // The seed's timer starts 20 s before guessing ends.
  const opener = band.getByTestId("transcript-line").first();
  await expect(opener.getByTestId("countdown-opener")).toContainText(/guessed ⚡/);
  await expect(opener.getByTestId("countdown-length")).toHaveText("Countdown 20s");
  const end = page.getByTestId("round-over");
  await expect(end.getByTestId("round-end-guess").first()).toBeVisible();
  await expect(end.getByTestId("round-end-hp")).toContainText(/HP us [\d,]+ → [\d,]+/);
  await expect(end.getByTestId("round-end-hp")).toContainText(/them [\d,]+ → [\d,]+/);
});

test("with Recall on, the Round-end line hides guesses, scores and HP; revealing there reveals the map too", async ({ page }) => {
  const round = s.games[0]!.rounds.find((r) => r.roundNumber === 1)!;
  await page.addInitScript((k) => localStorage.setItem(k, "1"), recallKey);
  await page.goto(`${session}?round=${round.id}`);
  await hydrated(page);
  const end = page.getByTestId("round-over");
  await expect(end.getByTestId("round-end-reveal")).toBeVisible();
  await expect(end.getByTestId("round-end-guess")).toHaveCount(0);
  await expect(page.getByTestId("debrief-reveal")).toBeVisible();
  await end.getByTestId("round-end-reveal").click();
  await expect(end.getByTestId("round-end-guess").first()).toBeVisible();
  await expect(page.getByTestId("debrief-reveal")).toBeHidden();
});
