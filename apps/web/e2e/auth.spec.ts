import { expect, test } from "@playwright/test";
import { login, seed } from "./helpers.js";

// #56 1a-security: deep links survive sign-in as a validated next; non-members get 404 from /api/duos/*.
const s = seed();

test("a signed-out deep link returns to itself after the development sign-in", async ({ page }) => {
  await page.goto(`/?duo=${s.duoId}&run=${s.runId}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.locator("form[action='/auth/dev']").filter({ has: page.locator(`input[value="${s.mikoId}"]`) }).locator("button").click();
  await expect(page).toHaveURL(new RegExp(`run=${s.runId}`));
  await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
});

test("an off-site next falls back to home", async ({ page }) => {
  const res = await page.request.post("/auth/dev", {
    form: { playerId: s.mikoId, next: "//evil.example/x" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/");
});

test("a non-member gets 404 from Duo APIs, a signed-out request 401", async ({ page }) => {
  expect((await page.request.get(`/api/duos/${s.duoId}/workbench`)).status()).toBe(401);
  await login(page, s.outsiderId);
  expect((await page.request.get(`/api/duos/${s.duoId}/workbench`)).status()).toBe(404);
  expect((await page.request.get(`/api/duos/not-a-uuid/workbench`)).status()).toBe(404);
});
