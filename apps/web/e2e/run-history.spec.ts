import { expect, test } from "@playwright/test";
import { login, seed } from "./helpers.js";

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

test("a bare ?run= resolves its owning Duo, and malformed or foreign runs are 404", async ({ page }) => {
  await page.goto(`/?run=${s.run2Id}`);
  await expect(page.locator(`#run-${s.run2Id}`)).toBeVisible();
  expect((await page.goto(`/?run=not-a-uuid`))!.status()).toBe(404);
  expect((await page.goto(`/?run=${s.otherRunId}`))!.status()).toBe(404);
  expect((await page.goto(`/?duo=${s.otherDuoId}&run=${s.runId}`))!.status()).toBe(404);
});

test("selecting a Session fetches its history; rapid switches show the last Session's rows", async ({ page }) => {
  await page.goto(`/?duo=${s.duoId}&run=${s.runId}`);
  await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
  await page.waitForLoadState("networkidle");
  const one = page.locator(`[data-testid="session-button"][data-session-id="${s.sessionId}"]`);
  const two = page.locator(`[data-testid="session-button"][data-session-id="${s.session2Id}"]`);
  await two.click();
  await one.click();
  await two.click();
  const timeline = page.getByTestId("run-timeline");
  await expect(timeline.locator(`[data-run-id="${s.run2Id}"]`)).toBeVisible();
  await expect(timeline.locator(`[data-run-id="${s.runId}"]`)).toHaveCount(0);
  // The pin was cleared by the switch.
  await expect(timeline.locator("[data-selected=\"1\"]")).toHaveCount(0);
  await one.click();
  await expect(timeline.locator(`[data-run-id="${s.runId}"]`)).toBeVisible();
  await expect(timeline.locator(`[data-run-id="${s.run2Id}"]`)).toHaveCount(0);
});

test("the workbench refresh validates ?sessionId= and drops a foreign ?run= with 200", async ({ page }) => {
  const api = (q: string) => page.request.get(`/api/duos/${s.duoId}/workbench${q}`);
  expect((await api("?sessionId=nope")).status()).toBe(400);
  expect((await api(`?sessionId=${s.otherDuoId}`)).status()).toBe(404);
  const res = await api(`?sessionId=${s.sessionId}&run=${s.run2Id}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { runTimeline: { pinMissing: boolean; sessionId: string } };
  expect(body.runTimeline).toMatchObject({ pinMissing: true, sessionId: s.sessionId });
});
