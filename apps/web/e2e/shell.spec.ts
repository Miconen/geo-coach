import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 1b-shell: Duo routes, the chrome, redirects (X1), preload off (X4) and deep links.
const s = seed();
const review = `/duos/${s.duoId}/review`;
const stats = `/duos/${s.duoId}/stats`;

test("a non-member gets 404 from the Duo pages and their __data.json", async ({ page }) => {
  await login(page, s.outsiderId);
  expect((await page.goto(review))!.status()).toBe(404);
  expect((await page.goto(stats))!.status()).toBe(404);
  const data = await page.request.get(`${review}/__data.json`);
  const body = await data.text();
  expect(data.status() === 404 || body.includes('"status":404')).toBe(true);
  expect(body).not.toContain("E2E Duo");
});

test("losing membership mid-visit turns the next in-Duo navigation into a 404", async ({ page }) => {
  await login(page, s.soraId);
  await page.goto(review);
  await expect(page.getByTestId("breadcrumb")).toContainText("E2E Duo");
  await page.waitForLoadState("networkidle");
  await withSql((sql) => sql`DELETE FROM duo_memberships WHERE player_id = ${s.soraId} AND duo_id = ${s.duoId}`);
  try {
    await page.getByRole("navigation", { name: "Duo" }).getByRole("link", { name: "Stats" }).click();
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText("E2E Duo")).toHaveCount(0);
  } finally {
    await withSql((sql) => sql`INSERT INTO duo_memberships (duo_id, player_id) VALUES (${s.duoId}, ${s.soraId}) ON CONFLICT DO NOTHING`);
  }
});

test("Settings returns to the last Duo, and hovering links never fetches __data.json", async ({ page }) => {
  await login(page, s.mikoId);
  await page.goto(stats);
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const dataRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("__data.json")) dataRequests.push(req.url());
  });
  const nav = page.getByRole("navigation", { name: "Duo" });
  await nav.getByRole("link", { name: "Review" }).hover();
  await nav.getByRole("link", { name: "Settings" }).hover();
  await page.waitForTimeout(300);
  expect(dataRequests).toEqual([]);
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: /Back to Workbench/ }).click();
  await expect(page).toHaveURL(new RegExp(`${review}$`));
  await expect(page.getByRole("heading", { name: "Learnings" })).toBeVisible();
});

test("legacy URLs redirect with their params", async ({ page }) => {
  await login(page, s.mikoId);
  const learning = s.learningIds[0]!;
  await page.goto(`/?duo=${s.duoId}&learning=${learning}`);
  await expect(page).toHaveURL(`${review}?learning=${learning}`);
  await page.goto(`/stats?duo=${s.duoId}&country=ES`);
  await expect(page).toHaveURL(`${stats}?country=ES`);
  expect((await page.goto(`/stats?duo=${s.otherDuoId}`))!.status()).toBe(404);
  await page.goto("/stats");
  await expect(page).toHaveURL(new RegExp(`${stats}$`));
});

test("a signed-out Duo URL keeps its path and params through sign-in", async ({ page }) => {
  await page.goto(`${stats}?country=ES`);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`${stats}?country=ES`);
  await page.locator("form[action='/auth/dev']").filter({ has: page.locator(`input[value="${s.mikoId}"]`) }).locator("button").click();
  await expect(page).toHaveURL(`${stats}?country=ES`);
});

test("?learning= pins a Learning, and a missing one says so", async ({ page }) => {
  await login(page, s.mikoId);
  const learning = s.learningIds[1]!;
  await page.goto(links(`?learning=${learning}`));
  await expect(page.getByTestId("active-learning")).toHaveAttribute("data-learning-id", learning);
  await page.goto(links(`?learning=00000000-0000-4000-8000-000000000000`));
  await expect(page.getByTestId("learning-missing")).toBeVisible();
});

test("?run= on Review opens the run, and the chrome's pending-work API answers", async ({ page }) => {
  await login(page, s.mikoId);
  await page.goto(links(`?run=${s.runId}#run-${s.runId}`));
  await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
  const res = await page.request.get(`/api/duos/${s.duoId}/pending-work`);
  expect(res.status()).toBe(200);
  expect(Array.isArray(((await res.json()) as { ranges: unknown }).ranges)).toBe(true);
});

function links(q: string) {
  return `${review}${q}`;
}
