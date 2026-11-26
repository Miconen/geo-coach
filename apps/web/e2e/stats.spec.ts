import { expect, test, type Page } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 2b: Stats URL state (ADR 0007), Round-card links, Back and reload, country links and live refresh.
const s = seed();
const stats = `/duos/${s.duoId}/stats`;
const [game1, game2] = s.games;
const roundOf = (g: typeof game1, n: number) => g!.rounds.find((r) => r.roundNumber === n)!;

async function openStats(page: Page, query = "") {
  await page.goto(`${stats}${query}`);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");
}

const filterBar = (page: Page) => page.locator("form").filter({ hasText: "Smoothing" });

test.beforeEach(async ({ page }) => {
  await login(page, s.soraId);
});

test("filter, smoothing and Effects controls keep each other's URL params", async ({ page }) => {
  await openStats(page);
  await filterBar(page).locator('input[type="date"]').first().fill("2026-11-01");
  await expect(page).toHaveURL(/from=2026-11-01/);
  await filterBar(page).locator("label", { hasText: "Smoothing" }).locator("select").selectOption("heavy");
  await expect(page).toHaveURL(/smooth=heavy/);
  const effects = page.locator("#effects select").last();
  await effects.selectOption("mode");
  await expect(page).toHaveURL(/effBy=mode/);
  // Before 2b, each control rebuilt its query from page.url, which a shallow replaceState leaves stale.
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBe("2026-11-01");
  expect(url.searchParams.get("smooth")).toBe("heavy");
  expect(url.searchParams.get("effBy")).toBe("mode");
  // A reload rebuilds the same view from the address bar.
  await page.reload();
  await expect(filterBar(page).locator('input[type="date"]').first()).toHaveValue("2026-11-01");
  await expect(filterBar(page).locator("label", { hasText: "Smoothing" }).locator("select")).toHaveValue("heavy");
});

test("a Stats Round card links its Round page without a map token; Back restores selection, filters and scroll", async ({ page }) => {
  await openStats(page, "?smooth=light");
  const g1r2 = roundOf(game1, 2);
  const g2r2 = roundOf(game2, 2);
  // Round -> Round: the second card replaces the first.
  await page.locator(`[data-testid="best-guess"][data-round-id="${g1r2.id}"]`).click();
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `/duos/${s.duoId}/games/${game1!.id}/rounds/2`);
  await page.locator(`[data-testid="best-guess"][data-round-id="${g2r2.id}"]`).click();
  const link = page.getByTestId("round-card-link");
  await expect(link).toHaveAttribute("href", `/duos/${s.duoId}/games/${game2!.id}/rounds/2`);
  await page.waitForTimeout(800); // the smooth scroll to the map settles
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(100);
  await page.evaluate(() => ((window as unknown as { __spa: number }).__spa = 1));

  // A dispatched click: Playwright would scroll the card clear of the sticky filter bar first.
  await link.dispatchEvent("click");
  await expect(page).toHaveURL(new RegExp(`/games/${game2!.id}/rounds/2$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Round 2");
  expect(await page.evaluate(() => (window as unknown as { __spa?: number }).__spa)).toBe(1);

  // The open Round is a focus in the URL (#73).
  const statsWithRound = new RegExp(`/stats\\?smooth=light&round=${g2r2.id}$`);
  await page.goBack();
  await expect(page).toHaveURL(statsWithRound);
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `/duos/${s.duoId}/games/${game2!.id}/rounds/2`);
  await expect(filterBar(page).locator("label", { hasText: "Smoothing" }).locator("select")).toHaveValue("light");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore - 80);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrollBefore + 80);

  // Round -> Back -> reload keeps the address bar and the selection.
  await page.getByTestId("round-card-link").click();
  await expect(page).toHaveURL(new RegExp(`/rounds/2$`));
  await page.goBack();
  await expect(page).toHaveURL(statsWithRound);
  await page.reload();
  await expect(page).toHaveURL(statsWithRound);
  await expect(filterBar(page).locator("label", { hasText: "Smoothing" }).locator("select")).toHaveValue("light");
  await expect(page.getByTestId("round-card-link")).toHaveAttribute("href", `/duos/${s.duoId}/games/${game2!.id}/rounds/2`);
});

test("traversal from a Stats Round card: a stored Round 0 stays plain text", async ({ page }) => {
  await openStats(page);
  const zero = roundOf(game2, 0);
  await page.locator(`[data-testid="best-guess"][data-round-id="${zero.id}"]`).click();
  await expect(page.getByTestId("round-card-plain")).toHaveText("Round 0");
  await expect(page.getByTestId("round-card-link")).toHaveCount(0);
  // A positive Round's card link reaches the Round page, whose chips go on to its Game and Session.
  await page.locator(`[data-testid="best-guess"][data-round-id="${roundOf(game1, 2).id}"]`).click();
  await page.getByTestId("round-card-link").click();
  await expect(page).toHaveURL(new RegExp(`/games/${game1!.id}/rounds/2$`));
  await page.getByTestId("back-link").click();
  await expect(page).toHaveURL(new RegExp(`/games/${game1!.id}$`));
});

test("with Recall on, a Round reached from a Stats card is masked when hydrated and at first paint", async ({ page }) => {
  await openStats(page);
  await page.evaluate(([k]) => localStorage.setItem(k!, "1"), [`recall:v1:${s.soraId}:${s.duoId}`]);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-testid="best-guess"][data-round-id="${roundOf(game1, 2).id}"]`).click();
  await page.getByTestId("round-card-link").click();
  await expect(page).toHaveURL(new RegExp(`/rounds/2$`));
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await page.getByTestId("round-speech").locator("summary").click();
  await expect(page.getByTestId("round-reveal")).toBeVisible();
  await expect(page.getByTestId("round-utterances")).toBeHidden();
  // A cold load of the same Round, before any script runs.
  const url = page.url();
  await page.route("**/*", (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.getByTestId("round-utterances")).toBeHidden();
});

test("a Rankings Learnings count links Review by country through the router, leaving the row unselected", async ({ page }) => {
  await openStats(page);
  const cell = page.getByTestId("country-learnings").first();
  const row = page.locator("#rankings tbody tr", { has: cell });
  await expect(row).toHaveAttribute("aria-selected", "false");
  await page.evaluate(() => ((window as unknown as { __spa: number }).__spa = 1));
  await cell.click();
  await expect(page).toHaveURL(new RegExp(`/duos/${s.duoId}/review\\?country=[A-Z]{2}$`));
  expect(await page.evaluate(() => (window as unknown as { __spa?: number }).__spa)).toBe(1);
  await page.goBack();
  await expect(page.locator('#rankings tbody tr[aria-selected="true"]')).toHaveCount(0);
});

test("offset and chunk-only events never rebuild Stats; delete-speech removing a Learning does", async ({ page }) => {
  await openStats(page);
  let statsRequests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/duos/${s.duoId}/stats`) statsRequests++;
  });
  await login(page, s.mikoId); // the Recording is Miko's: only its owner may delete its speech
  await openStats(page);
  statsRequests = 0;

  const offset = await page.request.post(`/api/recordings/${s.recordingId}/offset-override`, { data: { manualOffsetOverrideMs: 0 } });
  expect(offset.status()).toBe(200);
  const empty = await page.request.post(`/api/recordings/${s.recordingId}/delete-speech`, {
    data: { duoId: s.duoId, startUtc: "2001-01-01T00:00:00.000Z", endUtc: "2001-01-01T00:00:01.000Z" },
  });
  expect(((await empty.json()) as { deletedLearningCount: number }).deletedLearningCount).toBe(0);
  await page.waitForTimeout(1200);
  expect(statsRequests).toBe(0);

  // A throwaway utterance and the Learning citing only it: deleting that speech deletes the Learning.
  const utteranceId = crypto.randomUUID();
  const learningId = crypto.randomUUID();
  await withSql(async (sql) => {
    await sql`INSERT INTO utterances (id, transcript_version_id, recording_id, duo_id, player_id, chunk_no, text,
        start_sample_ms, end_sample_ms, started_at, ended_at)
      SELECT ${utteranceId}, transcript_version_id, recording_id, duo_id, player_id, 999, 'Throwaway', 0, 1000,
        '2002-01-01T00:00:00Z', '2002-01-01T00:00:01Z'
      FROM utterances WHERE recording_id = ${s.recordingId} LIMIT 1`;
    await sql`INSERT INTO learnings (id, duo_id, kind, origin, text) VALUES (${learningId}, ${s.duoId}, 'clue', 'manual', 'Throwaway')`;
    await sql`INSERT INTO learning_utterances (learning_id, utterance_id) VALUES (${learningId}, ${utteranceId})`;
  });
  const rebuilt = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/duos/${s.duoId}/stats`);
  const del = await page.request.post(`/api/recordings/${s.recordingId}/delete-speech`, {
    data: { duoId: s.duoId, startUtc: "2002-01-01T00:00:00.000Z", endUtc: "2002-01-01T00:00:01.000Z" },
  });
  expect(((await del.json()) as { deletedLearningCount: number }).deletedLearningCount).toBe(1);
  await rebuilt;
  // The refresh endpoint is Duo-guarded like the page.
  expect((await page.request.get(`/api/duos/${s.otherDuoId}/stats`)).status()).toBe(404);
});
