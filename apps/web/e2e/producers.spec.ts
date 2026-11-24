import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 2a(i): producers reach an open Review without a reconnect, and worker status follows the 15 s poll.
const s = seed();
const review = `/duos/${s.duoId}/review`;
const claimAsWorker = (request: import("@playwright/test").APIRequestContext) =>
  request.post("/api/processor", {
    headers: { Authorization: "Bearer e2e-processor-secret" },
    data: { action: "claim", model: "e2e" },
  });

test("offset override and delete-speech events reach an open Review, with documented fields only", async ({ page }) => {
  await login(page, s.mikoId);
  await page.goto(review);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  await page.waitForLoadState("networkidle");

  const refresh = page.waitForRequest((r) => r.url().includes(`/api/duos/${s.duoId}/review`));
  const offset = await page.request.post(`/api/recordings/${s.recordingId}/offset-override`, {
    data: { manualOffsetOverrideMs: 0 },
  });
  expect(offset.status()).toBe(200);
  expect(Object.keys(await offset.json()).sort()).toEqual(["effectiveOffsetMs", "isCalibrated"]);
  await refresh;

  const refresh2 = page.waitForRequest((r) => r.url().includes(`/api/duos/${s.duoId}/review`));
  const del = await page.request.post(`/api/recordings/${s.recordingId}/delete-speech`, {
    data: { duoId: s.duoId, startUtc: "2000-01-01T00:00:00.000Z", endUtc: "2000-01-01T00:00:01.000Z" },
  });
  expect(del.status()).toBe(200);
  expect(Object.keys(await del.json()).sort()).toEqual(["deletedLearningCount", "deletedUtteranceCount"]);
  await refresh2;
  await withSql((sql) => sql`UPDATE recordings SET manual_offset_override_ms = NULL WHERE id = ${s.recordingId}`);
});

test("worker status follows the poll: an idle poll enables Process, silence disables it, a 503 at once", async ({ page }) => {
  await withSql((sql) => sql`UPDATE processing_runs SET status = 'open' WHERE id = ${s.runId}`);
  try {
    await page.clock.install();
    await login(page, s.mikoId);
    // The server's online window is 3 s in e2e; start offline.
    await page.waitForTimeout(3_500);
    await page.goto(`${review}?run=${s.runId}`);
    const action = page.getByTestId("work-range-action").first();
    await expect(action).toHaveText(/Worker offline/);
    await expect(action).toBeDisabled();

    // An idle worker poll, no event and no reload: enabled within one 15 s interval.
    expect((await claimAsWorker(page.request)).status()).toBe(200);
    await page.clock.fastForward(15_000);
    await expect(action).toBeEnabled();

    // A silent worker: disabled within one interval.
    await page.waitForTimeout(3_500);
    await page.clock.fastForward(15_000);
    await expect(action).toBeDisabled();

    // Online again, then silent before the next poll: the enqueue's 503 refetches at once.
    await claimAsWorker(page.request);
    await page.clock.fastForward(15_000);
    await expect(action).toBeEnabled();
    await page.waitForTimeout(3_500);
    await action.click();
    await expect(action).toHaveText(/Worker offline/);
    await expect(action).toBeDisabled();
  } finally {
    await withSql((sql) => sql`UPDATE processing_runs SET status = 'finished' WHERE id = ${s.runId}`);
  }
});
