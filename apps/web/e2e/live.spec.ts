import { expect, test } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 1b-live(i): the shared stream catches up on open, and a revoked session clears the Duo's data.
const s = seed();
const review = `/duos/${s.duoId}/review`;

test("a run finishing between SSR and subscribe reaches the badge and Review on open", async ({ page }) => {
  await login(page, s.mikoId);
  const pendingCount = async () =>
    ((await (await page.request.get(`/api/duos/${s.duoId}/pending-work`)).json()) as {
      ranges: { purpose: string; count: number }[];
    }).ranges
      .filter((r) => r.purpose === "extract")
      .reduce((n, r) => n + r.count, 0);

  await withSql((sql) => sql`UPDATE processing_runs SET status = 'open' WHERE id = ${s.runId}`);
  try {
    const before = await pendingCount();
    expect(before).toBeGreaterThan(0);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/duos/*/events", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(review);
    await expect(page.getByTestId("pending-work")).toContainText(`${before} range`);
    // The run finishes after the page rendered, before the stream is subscribed: no event will ever say so.
    await withSql((sql) => sql`UPDATE processing_runs SET status = 'finished' WHERE id = ${s.runId}`);
    const after = await pendingCount();
    expect(after).toBe(before - 1);
    release();
    await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
    if (after === 0) await expect(page.getByTestId("pending-work")).toHaveCount(0);
    else await expect(page.getByTestId("pending-work")).toContainText(`${after} range`);
  } finally {
    await withSql((sql) => sql`UPDATE processing_runs SET status = 'finished' WHERE id = ${s.runId}`);
  }
});

test("logging out in another tab clears this tab's Duo data", async ({ page, context }) => {
  await login(page, s.mikoId);
  await page.goto(review);
  await expect(page.getByRole("navigation", { name: "Duo" })).toHaveAttribute("data-stream", "open");
  const other = await context.newPage();
  const res = await other.request.post("/auth/logout", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await expect(page.getByTestId("duo-revoked")).toContainText("You were signed out");
  await expect(page.getByText("E2E Duo")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Learnings" })).toHaveCount(0);
});

test("losing membership while the stream is open clears the Duo's data", async ({ page }) => {
  await login(page, s.soraId);
  await page.goto(review);
  const nav = page.getByRole("navigation", { name: "Duo" });
  await expect(nav).toHaveAttribute("data-stream", "open");
  await withSql((sql) => sql`DELETE FROM duo_memberships WHERE player_id = ${s.soraId} AND duo_id = ${s.duoId}`);
  try {
    // No periodic revocation check (S): the next refresh answering 404 runs the probe (here after starring).
    await page.getByTestId("learning-select").first().click();
    await page.keyboard.press("s");
    await expect(page.getByTestId("duo-revoked")).toContainText("no longer have access");
  } finally {
    await withSql(
      (sql) =>
        sql`INSERT INTO duo_memberships (duo_id, player_id) VALUES (${s.duoId}, ${s.soraId}) ON CONFLICT DO NOTHING`,
    );
  }
});
