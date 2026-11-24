import { expect, test, type Page } from "@playwright/test";
import { login, seed, withSql } from "./helpers.js";

// #56 1b-live(ii): Recall persists per Player and Duo, masks before first paint, and select is split from reveal.
const s = seed();
const review = `/duos/${s.duoId}/review`;
const LEARNING = "Split Spain and Portugal when unsure.";
const OTHER_LEARNING = "Toledo region has dry hills.";
const SPEECH = "You go Spain, I'll go Portugal";

const visible = (page: Page, text: string) => page.getByText(text, { exact: false }).filter({ visible: true });

async function setStoredRecall(page: Page, playerId: string, duoId: string, on: boolean) {
  await page.goto("/settings");
  await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [`recall:v1:${playerId}:${duoId}`, on ? "1" : "0"]);
}

test("a cold tab with Recall on is masked at first paint, before any script runs", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, true);
  await page.route("**/*", (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));
  await page.goto(review);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(page.locator('[data-answer="learning-text"]').first()).toBeAttached();
  await expect(visible(page, LEARNING)).toHaveCount(0);
  await expect(visible(page, OTHER_LEARNING)).toHaveCount(0);
  await expect(page.getByTestId("learning-reveal").first()).toBeVisible();
});

test("hydrated, Recall stays on across reloads and the toggle writes the preference", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, false);
  await page.goto(review);
  await expect(visible(page, LEARNING).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Recall OFF/ }).click();
  await expect(visible(page, LEARNING)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /Recall ON/ })).toBeVisible();
  await expect(visible(page, LEARNING)).toHaveCount(0);
});

test("two Players of one Duo in the same tab keep their own preference", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, true);
  await page.goto(review);
  await expect(visible(page, LEARNING)).toHaveCount(0);
  await page.request.post("/auth/logout", { maxRedirects: 0 });
  await login(page, s.soraId);
  await page.goto(review);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "off");
  await expect(visible(page, LEARNING).first()).toBeVisible();
  await page.request.post("/auth/logout", { maxRedirects: 0 });
  await login(page, s.mikoId);
  await page.goto(review);
  await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
  await expect(visible(page, LEARNING)).toHaveCount(0);
});

test("the first paint after a client-side Duo switch already uses the new Duo's preference", async ({ page }) => {
  await withSql((sql) => sql`INSERT INTO duo_memberships (duo_id, player_id) VALUES (${s.otherDuoId}, ${s.mikoId}) ON CONFLICT DO NOTHING`);
  try {
    await login(page, s.mikoId);
    await setStoredRecall(page, s.mikoId, s.otherDuoId, false);
    await setStoredRecall(page, s.mikoId, s.duoId, true);
    await page.goto(`/duos/${s.otherDuoId}/review`);
    await expect(page.locator("html")).toHaveAttribute("data-recall", "off");
    await page.waitForLoadState("networkidle");
    await page.evaluate((text) => {
      (window as unknown as { __leak: boolean }).__leak = false;
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[data-answer="learning-text"]')) {
          const shown = (el as HTMLElement).innerText.includes(text);
          if (shown) (window as unknown as { __leak: boolean }).__leak = true;
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, LEARNING);
    await page.locator(`nav[aria-label="Duo"] select:has(option[value="${s.duoId}"])`).selectOption(s.duoId);
    await expect(page).toHaveURL(new RegExp(review));
    await expect(page.locator('[data-answer="learning-text"]').first()).toBeAttached();
    await expect(page.locator("html")).toHaveAttribute("data-recall", "on");
    await expect(visible(page, LEARNING)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __leak: boolean }).__leak)).toBe(false);
  } finally {
    await withSql((sql) => sql`DELETE FROM duo_memberships WHERE duo_id = ${s.otherDuoId} AND player_id = ${s.mikoId}`);
  }
});

test("a cold ?country= link is masked when hydrated, before any reveal", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, true);
  await page.goto(`${review}?country=ES`);
  await expect(page.getByRole("button", { name: /Recall ON/ })).toBeVisible();
  await expect(page.locator("[data-learning-row]")).toHaveCount(2);
  await expect(visible(page, LEARNING)).toHaveCount(0);
  await expect(visible(page, OTHER_LEARNING)).toHaveCount(0);
  await expect(visible(page, "hedging")).toHaveCount(0);
});

test("a cold legacy ?run= with Recall on keeps the Session's speech behind a reveal", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, true);
  await page.goto(`/?run=${s.runId}`);
  await expect(page.locator(`#run-${s.runId}`)).toBeVisible();
  await expect(visible(page, SPEECH)).toHaveCount(0);
  await page.getByTestId("session-reveal").click();
  await expect(visible(page, SPEECH).first()).toBeVisible();
  // Learnings elsewhere stay masked: the Session reveal is its own.
  await expect(visible(page, LEARNING)).toHaveCount(0);
});

test("Enter and Space on a masked row's select control select without revealing", async ({ page }) => {
  await login(page, s.mikoId);
  await setStoredRecall(page, s.mikoId, s.duoId, true);
  await page.goto(review);
  await page.waitForLoadState("networkidle");
  const rows = page.locator("[data-learning-row]");
  const second = rows.nth(1);
  await second.getByTestId("learning-select").focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("data-selected", "1");
  await page.keyboard.press(" ");
  await expect(second).toHaveAttribute("data-selected", "1");
  await expect(second.locator(".recall-mask-content").first()).toBeHidden();
  // Space with nothing focused reveals the selected item only.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(" ");
  await expect(second.getByTestId("learning-reveal")).toHaveCount(0);
  await expect(second.locator('[data-answer="learning-text"]')).not.toHaveText("");
  await expect(rows.nth(0).getByTestId("learning-reveal")).toBeVisible();
  // The Reveal button reveals its own row.
  await rows.nth(0).getByTestId("learning-reveal").click();
  await expect(rows.nth(0)).toHaveAttribute("data-selected", "1");
  await expect(rows.nth(0).getByTestId("learning-reveal")).toHaveCount(0);
});
