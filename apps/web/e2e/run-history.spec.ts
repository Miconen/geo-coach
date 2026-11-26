import { expect, test } from "@playwright/test";
import { login, openSessionDetails, seed } from "./helpers.js";

// #56 0b: run history in the existing pane, ?run= deep links (X2) and Session selection.
const s = seed();

test.beforeEach(async ({ page }) => {
  await login(page, s.mikoId);
});

test("a ?run= deep link opens its Session with the run pinned", async ({ page }) => {
  await page.goto(`/?duo=${s.duoId}&run=${s.runId}#run-${s.runId}`);
  const row = page.locator(`#run-${s.runId}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("run-status")).toHaveText("finished");
  await expect(row.getByTestId("run-counts")).toContainText("Learnings: 2 current of 2 surviving");
});

test("a bare ?run= resolves its owning Duo and Session; / drops a bad ?run=, Review says it is gone", async ({ page }) => {
  await page.goto(`/?run=${s.run2Id}`);
  await expect(page).toHaveURL(new RegExp(`/duos/${s.duoId}/sessions/${s.session2Id}\\?run=${s.run2Id}`));
  await expect(page.locator(`#run-${s.run2Id}`)).toBeVisible();
  // At the root a malformed or unresolvable ?run= is dropped, never a 404 (X1).
  for (const q of ["run=not-a-uuid", `run=${s.otherRunId}`, `duo=${s.otherDuoId}&run=${s.otherRunId}`]) {
    const res = await page.goto(`/?${q}`);
    expect(res!.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/duos/${s.duoId}/review$`));
  }
  // On Review, from 2a(ii), a malformed, missing or cross-Duo ?run= says "no longer exists" (X2), not 404.
  const review = `/duos/${s.duoId}/review`;
  for (const bad of ["not-a-uuid", s.otherRunId]) {
    expect((await page.goto(`${review}?run=${bad}`))!.status()).toBe(200);
    await expect(page.getByTestId("run-missing")).toBeVisible();
  }
  // Another Duo's Review is still a 404 for a non-member.
  expect((await page.goto(`/duos/${s.otherDuoId}/review?run=${s.runId}`))!.status()).toBe(404);
});

test("Review's Session links open Session pages; rapid switches show the last Session's rows", async ({ page }) => {
  await page.goto(`/duos/${s.duoId}/review`);
  await page.waitForLoadState("networkidle");
  const one = page.locator(`[data-testid="session-link"][data-session-id="${s.sessionId}"]`);
  const two = page.locator(`[data-testid="session-link"][data-session-id="${s.session2Id}"]`);
  for (const [link, id] of [[two, s.session2Id], [one, s.sessionId]] as const) {
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${id}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/review$/);
  }
  await two.click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${s.session2Id}$`));
  await openSessionDetails(page);
  const timeline = page.getByTestId("run-timeline");
  await expect(timeline.locator(`[data-run-id="${s.run2Id}"]`)).toBeVisible();
  await expect(timeline.locator(`[data-run-id="${s.runId}"]`)).toHaveCount(0);
  await expect(timeline.locator("[data-selected=\"1\"]")).toHaveCount(0);
});

test("4 retired /workbench; Review's /review takes no Session params", async ({ page }) => {
  expect((await page.request.get(`/api/duos/${s.duoId}/workbench`)).status()).toBe(404);
  const res = await page.request.get(`/api/duos/${s.duoId}/review?sessionId=nope&run=${s.run2Id}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { duo: { id: string } };
  expect(body.duo.id).toBe(s.duoId);
});
